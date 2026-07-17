# 第五版本地托管 Runner 发布设计

## 1. 设计目的

本文定义 ExamForge 第五版正式镜像的本地托管 Runner 发布边界。该方案替代“GitHub 托管 Runner 直接跨境推送广州 TCR”的执行路径，但不替代 GitHub 质量门禁、TCR 制品仓库或北京生产服务器的 digest 部署模型。

本设计解决以下已经取得证据的问题：

- GitHub 托管 Runner 向广州 TCR 推送 API 镜像时，单次发布超过 60 分钟仍无法证明传输持续前进。
- GitHub Actions 对进行中的 `docker push` 不提供可下载的实时 job 日志，无法区分慢上传与无进展挂起。
- API 与 Worker 镜像分别约为 982 MB 和 980 MB，其中完整根 `node_modules` 复制层约为 499 MB，容器内目录约为 477 MB。
- 北京生产服务器只有 4 核、约 4 GB 内存，并承载其他服务，不适合作为镜像构建节点。

## 2. 核心决策

1. GitHub 继续作为源码真相源、质量门禁和发布审计入口。
2. 正式镜像构建、职责探针、SBOM、漏洞扫描和 TCR 推送迁移到用户本地 WSL 中的 GitHub self-hosted runner。
3. 本地 Runner 与开发仓库位于同一台电脑，但使用独立程序目录和独立工作目录；正式构建只读取 GitHub 检出的精确提交，并显式使用本机 Docker Engine 内置的 `default` Buildx builder，不读取开发仓库的未提交内容。
4. 广州 TCR 继续作为正式制品仓库。生产服务器只按 release manifest 中的 digest 拉取镜像，不接收本地 `docker save` 归档，也不从源码构建。
5. 镜像发布与生产部署继续分离。本地 Runner 不持有北京服务器 SSH 私钥或生产环境 secrets；服务器写入仍需单独授权和维护窗口确认。
6. API 与 Worker 必须先完成部署依赖瘦身，再重新执行正式 TCR 发布。延长全局超时只能作为兜底，不能替代可观察、有限时的单镜像推送。

## 3. 组件关系

```text
源码与控制流：
本地开发仓库 --git push--> GitHub --精确 SHA checkout--> 本地托管 Runner

正式镜像流：
本地托管 Runner --build/scan/push--> 广州 TCR --digest pull--> 北京生产服务器

生产变更流：
本地运维入口 --人工确认 + SSH/SCP--> 北京生产服务器
```

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| 本地开发仓库 | 编写、测试、提交和推送代码 | 直接作为正式构建上下文、把未提交文件带入镜像 |
| GitHub | 保存提交与 workflow、运行质量门禁、调度 Runner、保存发布报告 | 向中国境内传输正式镜像大层 |
| 本地托管 Runner | 检出精确 SHA、构建、探测、扫描、推送并生成清单 | 修改生产服务器、读取生产数据库或环境文件 |
| 广州 TCR | 保存提交 SHA tag、registry digest 和可回滚镜像 | 保存源码、Compose、生产 secrets 或数据库数据 |
| 北京生产服务器 | 校验清单、拉取 digest、迁移、启动、健康检查和回滚 | 克隆 GitHub、运行 `npm ci` 或现场构建镜像 |

## 4. 本地 Runner 边界

### 4.1 运行位置

Runner 运行在当前 Linux/WSL 环境中，复用已经能够构建 linux/amd64 镜像的 Docker 引擎。Windows 侧现有 SSH 配置继续只用于人工控制的服务器预检和部署，不注入 Runner job。

建议目录边界如下：

```text
/home/liangjiaqi/projects/ExamForge/        # 开发仓库
/home/liangjiaqi/actions-runner/            # Runner 程序
/home/liangjiaqi/actions-runner/_work/      # GitHub 管理的独立检出目录
```

Runner 仅在正式发布时手动启动。未启动时，带 `examforge-release` 标签的 job 保持排队，不允许回退到 GitHub 托管 Runner。

### 4.2 构建隔离

- workflow 必须从 GitHub 检出目标完整 SHA，并在构建前验证 `HEAD == GITHUB_SHA`。
- `actions/checkout` 不复用开发仓库，不读取开发目录中的 `.env`、未提交文件或本地补丁。
- workflow 在构建前选择并校验 Docker Engine 内置的 `default` Buildx builder，要求 driver 为 `docker`、状态为 `running` 且包含 `linux/amd64`。构建可以复用内容寻址的基础层，但不得通过 `--cache-from` 或本地业务镜像作为发布输入；所有正式构建命令显式指定 `--builder default`。
- 若 Runner 通过宿主机 HTTP(S) 代理访问外网，只把当前进程继承的 `HTTP_PROXY`、`HTTPS_PROXY`、`http_proxy`、`https_proxy` 作为 BuildKit 预定义 build arg 传入构建，不写入最终镜像层，也不修改全局 Docker CLI 或 daemon 配置。
- Runner 工作目录只保存本次检出和临时发布 bundle。成功上传 artifact 后删除临时 bundle；Docker 层缓存按受控策略保留。
- Runner 使用 Docker 权限，等同于对本机 Docker daemon 的高权限访问。因此只允许受信任的 `main` 提交和手动发布 workflow 使用该标签。

### 4.3 注册参数与执行状态

本地代码和镜像验证通过后，Runner 固定使用下列参数。用户已于 2026-07-15 确认下载和注册；Linux x64 Runner `2.335.1` 已按 GitHub 官方 SHA-256 校验后安装，并已完成仓库级注册：

| 参数 | 值 |
| --- | --- |
| 注册范围 | `https://github.com/steven123397/ExamForge` 仓库级 Runner |
| 程序目录 | `/home/liangjiaqi/actions-runner` |
| 工作目录 | `/home/liangjiaqi/actions-runner/_work`，注册参数为 `--work _work` |
| Runner 名称 | `examforge-release-wsl-x64` |
| 默认标签 | `self-hosted`、`linux`、`x64` |
| 自定义标签 | `examforge-release` |
| 启动方式 | 发布时在前台手动运行 `./run.sh`，不安装 systemd 服务 |

安装和后续升级从 GitHub 仓库的 New self-hosted runner 页面取得当时推荐的 Linux x64 包、SHA-256 和一小时有效的注册 token，不在仓库或 shell 历史中保存 token。注册命令参数固定为：

```bash
./config.sh \
  --url https://github.com/steven123397/ExamForge \
  --token "$RUNNER_REGISTRATION_TOKEN" \
  --name examforge-release-wsl-x64 \
  --labels examforge-release \
  --work _work \
  --unattended
```

workflow 不再调用 `docker/setup-buildx-action`，也不创建需要从 Docker Hub bootstrap 的 `docker-container` builder。Runner 宿主机必须已有可用的 Docker CLI、daemon 和 Buildx 插件；job 只执行 `docker buildx use default` 与只读 `inspect` 合同检查，镜像构建显式指定 `--builder default`。这样仍由本机 Engine 执行 linux/amd64 构建，但发布启动不再依赖额外的远端 BuildKit 镜像拉取。

## 5. GitHub 工作流拆分

### 5.1 质量 job

质量 job 继续运行在 GitHub 托管 `ubuntu-24.04`：

- 校验手动输入、目标分支和完整提交。
- 执行依赖审计、安装脚本门禁、单元/集成测试、类型检查、scheduler/OpenAPI 检查和生产构建。
- 生成生产依赖审计 artifact，供发布 job 下载。
- 不登录 TCR，不构建或推送正式镜像。

### 5.2 发布 job

发布 job 使用标签：

```yaml
runs-on: [self-hosted, linux, x64, examforge-release]
```

它只在质量 job 成功后执行：

1. 检出与质量 job 相同的完整 SHA。
2. 下载依赖审计 artifact。
3. 构建四个 linux/amd64 镜像，并执行职责隔离探针。
4. 生成四份 SPDX SBOM 和四份 Trivy 报告。
5. HIGH/CRITICAL 门禁全部通过后登录 TCR。
6. 按 API、scheduler、Web、Worker 顺序逐个推送，每个镜像成功后立即读取并远程验证 registry digest。
7. 四个镜像全部成功后才生成并校验 release manifest。
8. 将 manifest、审计、SBOM 和扫描报告上传为 GitHub artifact。

发布 job 不执行 SSH、SCP、远程 Compose、nginx 或 Certbot 命令。

## 6. 镜像瘦身

### 6.1 当前证据

| 镜像 | 当前大小 | 主要可控大层 |
| --- | ---: | --- |
| API | 约 982 MB | 根 `node_modules` 复制层约 499 MB |
| Worker | 约 980 MB | 根 `node_modules` 复制层约 499 MB |
| Web | 约 449 MB | Next standalone 约 65 MB，其他主要为基础镜像 |
| scheduler | 约 448 MB | Python 虚拟环境约 200 MB，其他主要为基础镜像 |

上述大小为本地 Docker 的未压缩镜像口径。现有日志不能证明首次 TCR 发布中未完成的层就是 `node_modules`，但该层是 API/Worker 最明确的可控体积来源。

### 6.2 收敛目标

- API 与 Worker 不再复制整个 monorepo 根 `node_modules`，分别生成与自身运行入口匹配的最小生产依赖树。
- API 与 Worker 的未压缩镜像分别不超过 700 MB，并记录优化前后层级差异。
- Web 继续使用 Next standalone；scheduler 继续使用锁定的 uv 虚拟环境。本轮不为追求极小体积切换 distroless 或 Alpine，避免扩大 native 依赖和运维风险。
- 四个镜像仍保持非 root、只读根文件系统适配、OCI 来源标签和职责隔离探针。

### 6.3 本地收敛证据

2026-07-14 的本地重建采用与优化前相同的 `docker image ls` 未压缩大小口径：

| 镜像 | 优化前 | 优化后 | 运行时 `node_modules` |
| --- | ---: | ---: | ---: |
| API | 约 982 MB | 417 MB | 42 MB |
| Worker | 约 980 MB | 414 MB | 40 MB |

API 与 Worker 现在分别执行 `npm ci --omit=dev --workspace <目标> --include-workspace-root=false`，运行镜像从独立 `production-dependencies` 阶段复制依赖，不再复制构建阶段的完整 monorepo 根依赖树。镜像探针按 `docker image ls` 的十进制 MB 口径强制 700 MB 上限，并拒绝 Next、Playwright、TypeScript、tsx 及越界服务依赖。

两个镜像均完成运行时内部包导入、非 root、linux/amd64、OCI source/revision、职责隔离和体积探针；固定 Syft 生成 SPDX 2.3 SBOM，固定 Trivy 0.72.0 扫描 HIGH/CRITICAL 为 0。首次 self-hosted 运行暴露 `docker-container` BuildKit 未继承 WSL 代理的问题，临时专用 builder 曾完成 API 冷拉取与职责探针并支撑 `f769725` 正式发布；后续运行又证明 `docker-container` bootstrap 自身会强制远端 pull，无法作为稳定启动前提。当前实现改用本机 Engine 内置 builder，本地真实 `scratch` 镜像在 2 秒内完成构建和加载；该证据只验证 builder 路径，不替代四镜像正式 TCR 推送和完整 manifest。

## 7. 构建、推送可观察性与失败语义

- 每个镜像的构建和推送分别记录开始时间、镜像名、尝试次数、结束状态与独立日志，不把四次构建或四次 `docker push` 隐藏在无边界等待中。
- 单镜像每次构建和每次推送上限均为 30 分钟，各最多重试 1 次。超时后当前发布失败，不继续后续镜像，也不生成正式 release manifest。
- Runner 的四组 `HTTP_PROXY`、`HTTPS_PROXY`、`http_proxy`、`https_proxy` 作为 BuildKit 预定义 build arg 显式传入构建步骤；不写入最终镜像层，也不修改 Docker daemon 全局配置。
- Debian 运行时安全更新统一由 `scripts/release/upgrade-debian.sh` 执行：构建时把官方签名源切换到清华 Debian 镜像，每次 `apt-get update` / `upgrade` 最长 120 秒、最多 3 次，并逐次输出状态。镜像站只提供传输，APT 继续验证 Debian Release 签名和包哈希；失败仍终止镜像构建，不使用 `--allow-unauthenticated`、`--fix-missing` 或忽略索引错误。
- job 总上限为 120 分钟，仅作为最终保护；不得以继续增加总超时替代根因分析。
- TCR 中可能保留已上传但未进入正式 manifest 的 SHA tag。部署入口只接受完整、已验证的 manifest，因此部分推送不能进入生产。
- 同一 SHA 重跑时允许 registry 复用已上传层，但仍必须重新读取四个远程 digest、生成清单并上传完整报告。
- GitHub artifact 上传失败时，发布视为失败；已推送镜像不得部署，重跑同一 SHA 重新组装证据。
- 正式 bundle 第一次上传失败时保留本地目录，等待 5 秒后以同名 artifact 和 `overwrite` 最多重试 1 次；第二次仍失败才进入失败诊断与清理。失败诊断 artifact 不能替代正式 release artifact。

## 8. 凭据与安全

- TCR 密码继续由 GitHub secret 注入，仅在发布 job 登录步骤可见；日志不得输出密码或 Docker 配置内容。
- TCR 凭据只授予 `examforge` 命名空间需要的推送权限，生产服务器使用独立只读凭据。
- Runner 不保存生产 `.env`、Cookie、数据库密码、演示账号密码、COS 密钥或服务器 SSH 私钥。
- workflow 只允许 `workflow_dispatch`、`main`、明确 `confirm_publish=true` 和固定 Action SHA。
- 发布结束后执行 `docker logout`，删除临时凭据文件和发布工作目录；缓存只保留非 secret 的构建层。
- 不允许 fork PR、未受信任分支或普通 `pull_request` job 使用本地 Runner。

## 9. TCR 与生产部署

TCR 不是临时中转，而是正式制品单一来源。每次成功发布至少形成以下四个引用：

```text
ccr.ccs.tencentyun.com/examforge/api@sha256:...
ccr.ccs.tencentyun.com/examforge/scheduler@sha256:...
ccr.ccs.tencentyun.com/examforge/web@sha256:...
ccr.ccs.tencentyun.com/examforge/worker@sha256:...
```

首次 B 方案正式发布对应提交 `f7697252a931b3da871272355fec3ebcab0e3842`，工作流 `29357107371` 取得以下远程 digest：

```text
ccr.ccs.tencentyun.com/examforge/api@sha256:a09acaad2046d134869e2f2e6cb11bf9a1ca3336d362191d65d75151438073c0
ccr.ccs.tencentyun.com/examforge/scheduler@sha256:b9bc72a5f416adaab5218f242be9257ffeb2fda5889366303eb3ccf5d6d80fad
ccr.ccs.tencentyun.com/examforge/web@sha256:ae735a3b2fba49549cdc9f311e0b83a01011036f4166ab1e2390a7f6d1c5b36b
ccr.ccs.tencentyun.com/examforge/worker@sha256:a346a2d0904cd08cf19e2b68c82679fe15dff79abecc5aa76552660b615c982f
```

生产服务器只使用 manifest 中的 digest。首次部署前先执行只读 manifest 检查和镜像拉取验证；正式目录、环境文件、Compose、nginx、证书和数据迁移仍按第六阶段任务 7 的独立授权执行。

本地电脑关机后，服务器仍可从 TCR 拉取已经发布的当前或上一版本。回滚不依赖开发仓库或本地 Runner 在线。

## 10. 实施范围

本设计实施时允许修改：

- `.github/workflows/release-images.yml`
- `apps/api/Dockerfile`
- `apps/worker/Dockerfile`
- 发布合同测试与必要的镜像探针
- Runner 安装和启动说明
- 第五版第六阶段计划、状态和验证记录

本设计不授权：

- 在北京服务器安装 Runner 或构建镜像。
- 让 Runner 自动部署生产环境。
- 修改其他项目的 Docker、代理、镜像或 TCR 命名空间。
- 在备案通过和维护窗口最终确认前创建正式目录、签发证书或切换流量。

## 11. 验收标准

1. 本地 Runner 使用独立检出目录，构建前证明目标 SHA 与 GitHub 发布 SHA 一致。
2. GitHub 托管 job 只执行质量门禁，本地 Runner job 才能访问 TCR 推送凭据。
3. API 与 Worker 不再包含完整根 `node_modules` 层，未压缩镜像分别不超过 700 MB。
4. 四个镜像完成职责探针、SBOM 和 HIGH/CRITICAL 漏洞门禁。
5. 每个 TCR 镜像取得可远程读取的 registry digest，四者与 release manifest 完全一致。
6. 发布失败时不生成可部署 manifest，且不会触发服务器写入。
7. 北京服务器使用独立只读凭据验证四个 digest 可拉取，不访问 GitHub，不构建源码。
8. 发布清单、SBOM、扫描报告和失败日志不包含 secret-like 字段。

## 12. 当前状态

截至 2026-07-17，用户已确认采用本地托管 Runner 的 B 方案，并保留广州 TCR。API/Worker 最小生产依赖树和 700 MB 门禁已在本地验证，工作流已拆分为 GitHub 托管质量 job 与四标签 self-hosted 发布 job，单镜像构建和推送均具备 30 分钟上限、最多 1 次重试、状态日志与远程 digest 校验合同。Runner `2.335.1` 已安装到独立目录并完成仓库级注册，不安装系统服务；提交 `f769725` 的工作流 `29357107371` 已完整成功并生成正式 artifact `examforge-release-f7697252a931b3da871272355fec3ebcab0e3842`，证明 B 方案的职责隔离与凭据清理边界成立。

CR-028 修复提交后的工作流 `29482599323` 在首个 API 构建中连续 17 分钟没有新增字节、日志或子阶段证据，因而主动取消。逐镜像构建边界与 systemd 稳定路径随后以 `11ab909` 提交并推送；工作流 `29557441559` 的 GitHub 质量 job 成功，但 self-hosted job 在 `docker/setup-buildx-action` 的远端 BuildKit bootstrap 阶段连续 8 分钟无进展后取消，尚未开始任何业务镜像构建。独立 60 秒探针证明即使本机已有完整 `moby/buildkit` 镜像，`docker-container` 驱动仍会强制执行远端 pull；当前本地修复因此移除该 Action 和 bootstrap 脚本，改为显式使用已验证的 Docker Engine `default` builder。发布合同保持 `18 passed`，完整部署合同保持 `37 passed`；新正式运行完成前，CR-028 仍没有新 release 证据。

Engine builder 修复以 `a8ae2f2` 提交并推送后，工作流 `29558412245` 已证明质量 job、Engine builder 校验、审计下载和精确 SHA 校验通过；API 与 scheduler 均在首次尝试构建并通过职责探针。Web 第一次在下载 `sed` 安全更新时遇到代理 `502`，第二次在 Debian `InRelease` 遇到同类错误，故有界构建步骤失败；SBOM、Trivy、TCR 登录、推送和 manifest 全部跳过，失败诊断 artifact 与清理成功。对照探针显示相同容器经清华 Debian 镜像下载 9.3 MB 索引约 4 秒，而官方 CDN 连续 120 秒超时；当前本地 helper 已把镜像选择、单次 120 秒和最多 3 次重试纳入日志合同。API、scheduler、Web、Worker 随后均在首次尝试完成真实 linux/amd64 构建和职责探针，apt 更新分别输出成功状态；发布专项现为 `19 passed`，完整部署合同为 `38 passed`。该修复仍需新正式运行验证。

apt 修复以 `b9a2274` 提交并推送后，工作流 `29560455791` 的质量门禁、四镜像首次构建/探针、SBOM、Trivy HIGH/CRITICAL 门禁、TCR 登录、四次推送、远程 digest 读取和 manifest 校验均成功；正式 bundle 在 `CreateArtifact` 阶段因一次 `ECONNRESET` 上传失败，随后失败诊断 artifact 上传成功。由于正式 release artifact 缺失，本轮四个 TCR tag 与已校验 manifest 仍不得部署。当前本地 workflow 已为正式 artifact 增加 5 秒后最多 1 次同名覆盖重试；发布专项和完整部署合同数量不变，该边界仍需重新运行证明。

北京服务器随后使用独立 `ubuntu` 凭据按 release manifest 拉取四个应用和两个基础镜像的固定 digest，不访问 GitHub、不构建源码；仅回环可见的内部部署完成迁移、业务 smoke、备份恢复和 150 场基准后已停止。四个应用容器中的 OCI revision 均为 `f7697252a931b3da871272355fec3ebcab0e3842`，服务器没有使用本地 image ID 或部分 tag 作为发布依据。Runner 仍未持有服务器 SSH 私钥或生产 secrets，GitHub workflow 也未自动连接服务器。第六阶段任务 3 和 Runner 发布边界已经完成验证；备案、nginx/HTTPS、正式域名 E2E、Scheduler 冷恢复缺口 CR-028 与跨版本回滚属于部署验收后续，不改变本设计的职责隔离结论。
