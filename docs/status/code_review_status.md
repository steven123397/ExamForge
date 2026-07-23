# ExamForge 代码审查与问题状态

## 1. 文档定位

本文档是 ExamForge 的代码审查结果和存留问题状态文档。它记录开发过程中发现但尚未解决的问题、风险、技术债和审查结论。

`docs/status/project_status.md` 只描述项目开发进度、已实现内容、验证结果和下一步；本文档专门维护“问题是否存在、是否已解决、解决证据是什么”。

## 2. 状态规则

问题状态使用：

- `待解决`：问题仍存在，需要后续处理。
- `已解决`：问题已有修复提交或明确证据证明不再存在。
- `暂缓`：问题确认存在，但当前阶段不处理，需要说明暂缓原因和重新评估条件。

`## 3. 问题明细` 只保留 `待解决` 或 `暂缓` 的问题。问题解决后，从问题明细中移除完整条目，在 `## 4. 已解决问题索引` 保留编号和题目，并将解决过程与验证证据写入 `## 5. 审查记录`。

## 3. 问题明细

### CR-036：生产 Redis 只依赖 Compose 内部网络，未启用 AUTH

- 状态：暂缓
- 严重级别：P3 低优先级
- 所属模块：生产 Compose 安全纵深
- 发现来源：第五版 Grok Build 独立审查及主线产品裁决
- 位置：`compose.production.yml`
- 问题描述：Redis 没有宿主端口且只加入 `backend.internal` 网络，但服务本身未设置访问口令，API、Publisher 和 Worker 使用无密码 `redis://redis:6379/0`。当前以网络隔离为主边界，缺少容器网络内部的第二层认证。
- 影响：若同网络容器被攻陷或未来错误接入新服务，攻击者可读写 BullMQ 队列与 Pub/Sub 通知。PostgreSQL 仍是业务事实和审计单一来源，现有幂等/CAS 可限制直接数据破坏，因此不提升为第五版公开上线阻塞项。
- 建议处理：后续通过独立 secret 为 Redis 配置 AUTH，并同步 API、Publisher、Worker、健康检查、预检和故障演练；不得把口令硬编码到 Compose 或仓库。
- 验证方式：无凭据连接必须失败，三类合法客户端和健康检查可用，Redis 重启/丢失后的 PostgreSQL 补偿与单一运行合同继续通过。
- 解决记录：未解决。
- 本轮处置：暂缓。第五版继续以 internal network、无宿主端口、非 root、只读根文件系统和 PostgreSQL 事实源作为主防线；当 Compose 网络新增服务、网络边界改变、迁移到多租户环境或进入第六版安全加固时重新评估。

### CR-003：Docker daemon 拉取镜像依赖当前 WSL 到 Windows 代理

- 状态：暂缓
- 严重级别：P3 低优先级
- 所属模块：本地部署环境
- 发现来源：`docs/status/project_status.md`
- 位置：本机 Docker systemd 配置；`docker-compose.yml`
- 问题描述：Docker daemon 依赖当前 WSL 到 Windows 代理 `http://172.22.112.1:7897` 拉取 Docker Hub 镜像。
- 影响：如果 Windows 代理端口或地址变化，重新拉取镜像可能失败；已存在的 `postgres:16-alpine` 镜像和容器不受影响。
- 建议处理：代理变化时同步更新 Docker systemd 代理配置并重启 `docker.service`；部署文档中保留环境依赖说明。
- 验证方式：执行 `docker compose pull` 或重新创建 PostgreSQL 容器并确认健康检查通过。
- 解决记录：未解决。
- 本轮处置：暂缓。2026-07-12 `docker info` 显示 daemon 的 HTTP/HTTPS 代理仍为 `http://172.22.112.1:7897`，且没有 Docker Hub 镜像源；`docker pull postgres:16-alpine` 通过该路径从 Docker Hub 拉取新 digest `sha256:57c72fd...` 成功，说明代理当前可用。未经用户单独授权不修改 machine-level systemd/Windows 代理；代理地址变化、Docker Hub 拉取失败或迁移到独立服务器时重新评估。

## 4. 已解决问题索引

- CR-001：本机默认 Python 环境不满足调度器要求
- CR-002：Next 依赖链存在 npm audit moderate 公告
- CR-004：SQL 迁移文件缺少正式迁移执行器和迁移状态表
- CR-005：权限体系仍是请求头轻量护栏，不是真实认证授权
- CR-006：异步排考作业为 API 进程内状态，不具备持久化和多实例能力
- CR-010：Web 角色切换没有覆盖多数变更请求，缺失请求头会被 API 当作管理员
- CR-011：草稿校验错误处理空 `allowed_slot_ids`，会阻断合法的不限时段考试
- CR-012：PostgreSQL 草稿锁定状态只保存在进程内，重启后会丢失
- CR-013：数据库 schema 缺少外键和关键唯一约束，持久化数据一致性主要依赖应用自律
- CR-009：Web 运营台主组件体量过大，存在后续维护风险
- CR-014：已发布排考 CSV 导出未鉴权且没有下载审计
- CR-015：Web 运营台仍把 Query 数据大量镜像到本地状态
- CR-016：异步排考作业缺少启动恢复和超时失败语义
- CR-017：迁移完整性测试仍断言已废弃的草稿唯一约束
- CR-018：API 排考入口没有接收 `fixed_assignments`
- CR-019：PostgreSQL `getReferenceData()` 仍从 JSONB 读取教师不可用与考试学生组
- CR-020：不可行或不完整排考可以被发布为正式方案
- CR-021：内部运营读取接口绕过 Bearer 鉴权
- CR-022：连续考试与连续监考把跨日相邻序号误判为连续场次
- CR-023：跨资源时段引用校验缺失导致仓储语义分裂并泄露 SQL 错误
- CR-024：草稿建议请求竞态可能把旧考试建议应用到错误选择上下文
- CR-025：运营历史子查询失败会被吞掉并显示成空数据
- CR-026：发布、回滚、废弃和删除等高影响操作没有确认步骤
- CR-027：草稿矩阵 ARIA 网格语义和异步错误播报不完整
- CR-028：生产 Scheduler 冷恢复时间超过作业自动重试窗口
- CR-029：教师和学生会话可读取全量运营、草稿、审计与导出数据
- CR-030：同毫秒运行、审计与作业列表以随机 UUID 排序，无法表达创建顺序
- CR-031：运行发布缺少事务串行化与并发冲突语义
- CR-032：登录接口缺少失败限流与临时锁定
- CR-033：生产本地账户缺少受控密码轮换与旧会话吊销入口
- CR-034：匿名已发布课表响应暴露完整内部求解结果
- CR-035：草稿调整建议在截断前物化完整组合空间
- CR-008：Python 调度器尚未独立 FastAPI 服务化
- CR-007：排考进度仍使用轮询，没有 WebSocket 或 SSE 实时推送

## 5. 审查记录

- 2026-07-23：CR-035 完成本地整改。先用 30 名教师、15 个教室、20 个时段和 150 个考试任务构造 130,500 个理论组合空间；旧实现的最窄红灯仍耗时约 13,183 ms，并在过程内产生约 97 MiB 堆增量。随后将 `buildDraftAdjustmentSuggestions()` 改为先按房间要求、时段、学生群体、房间与教师占用剪枝，再惰性生成教师组合；主路径拿到 8 条候选即停止，只对保留候选执行完整草稿校验。为保留无可直接应用方案时的冲突说明，增加最多 256 条候选的有界诊断回退，并继续维护既有稳定排序和前 8 条响应。修复后同一主路径测量为约 9 ms；高基数诊断回退约 44 ms。新增 3 条定向回归覆盖稳定前 8 条、冲突说明和回退预算；完整 API 为 `114 passed`，迁移为 `10 passed`，迁移检查确认 19 个迁移及约束完整，可丢弃 PostgreSQL 16 为 `32 passed`，仓库级类型检查、生产构建和 `git diff --check` 通过。临时数据库容器和端口已清理，未触发 Runner、TCR、服务器写入或公开 release。CR-035 已从问题明细移入本索引；当前遗留问题为 P3 2 项，无待解决 P0/P1/P2，仍不生成正式制品或公开上线。

- 2026-07-23：CR-030 完成本地整改。先冻结同一时间创建 10 条运行、审计和作业记录，分别在内存与可丢弃 PostgreSQL 16 环境验证跨页列表、dashboard 最新运行和审计顺序会因随机 UUID 排序而失配；迁移合同也先验证三个表不存在严格的顺序列。随后新增 `0018_creation_sequences.sql`，为 `schedule_runs`、`audit_events` 和 `schedule_jobs` 分别增加 `GENERATED ALWAYS AS IDENTITY` 的 `created_sequence` 与唯一约束；内存仓储使用同语义计数器，PostgreSQL 列表、分页和最新运行统一按该键倒序。既有记录会获得稳定的表内顺序，但该键非无间隙、不可跨表比较，也不能恢复旧同毫秒记录的原始相对顺序。完整 API 回归为 `111 passed`，可丢弃 PostgreSQL 16 集成为 `32 passed`，迁移测试为 `10 passed`，迁移检查确认 19 个迁移及新增约束完整，仓库级类型检查、生产构建和 `git diff --check` 通过。临时数据库容器和端口已清理，未触发 Runner、TCR、服务器写入或公开 release。CR-030 已从问题明细移入本索引；当前遗留问题为 P2 1 项、P3 2 项，仍不生成正式制品或公开上线。

- 2026-07-23：CR-034 完成本地整改。先以匿名课表和通知端点仍直接返回内部结构的最窄合同测试取得红灯；随后新增严格、版本化的 public DTO，并在服务层投影 `GET /api/published-schedule` 与 `GET /api/published-schedule/notifications`。匿名响应只保留公告所需的批次摘要、课程／学生群体／考场名称、日期时间、通知数量和文案；运行、内部 ID、评分、冲突、诊断、报告、统计和约束追踪均不再可见。标签缺失或为空时投影为 `null` 或省略，绝不以内部 ID 回退。完整运营响应迁入仅管理员／排考员可读的 `/api/published-schedule/operations`，教师和学生仍只能通过 `/api/me/*` 读取本人范围。shared 合同回归为 `22 passed`，完整 API 为 `109 passed`，仓库级类型检查和生产构建通过；可丢弃 PostgreSQL 16 的匿名公开合同与运营角色负向回归为 `2 passed`。一次更早的完整 PostgreSQL 集成在既有 CR-031 并发测试的等待观测窗口超时，结果为 `29 passed, 1 failed`；随即在同一隔离环境独立重跑该 CR-031 场景两次均通过，未把该测试时序现象计入 CR-034 通过结论，也未改动 CR-031 代码。临时数据库容器与端口均已清理，未触发 Runner、TCR、服务器写入或公开 release。CR-034 已从问题明细移入本索引；当前遗留问题为 P2 2 项、P3 2 项，仍不生成正式制品或公开上线。

- 2026-07-23：CR-033 完成本地整改。先由账户轮换服务与维护命令的最窄测试因模块不存在而失败；随后新增 `0017_auth_credential_versions.sql`，使用户与会话绑定单调递增的凭据版本。环境变量继续严格只用于首次 bootstrap；API 镜像新增仅维护用途的 CLI，从标准输入读取新密码、重复确认目标用户名、记录调用方提供的审计 actor，并在 PostgreSQL 单一事务内锁定用户行、更新 scrypt 散列和凭据版本、吊销全部未撤销会话、写入不含密码的 `auth.password_rotated` 审计。会话创建与恢复均比对凭据版本，阻断轮换并发的旧密码认证产生迟到有效会话；审计写入失败会回滚轮换。共享密码策略同时拒绝缺失、全空白、过短和占位值。账户轮换命令、服务与生产密码策略定向回归为 `8 passed`（含既有登录失败限流验证），迁移为 `9 passed`，可丢弃 PostgreSQL 16 集成为 `30 passed`，仓库级类型检查和生产构建通过；已编译 CLI 的本地验证确认旧密码不匹配、新密码匹配、凭据版本递增、旧会话撤销且审计 payload 仅含版本与数量。完整 API 两次新鲜运行分别为 `104 passed, 1 failed` 和 `105 passed`：失败唯一为已知 CR-030 的同毫秒随机 UUID 排序断言，随后全绿不改变其非确定性风险，也未纳入 CR-033 通过结论。临时数据库容器和端口均已清理，未触发 Runner、TCR、服务器写入或公开 release。CR-033 已从问题明细移入本索引；当前遗留问题为 P2 3 项、P3 2 项，仍不生成正式制品或公开上线。

- 2026-07-23：CR-032 完成本地整改。先以同一来源连续第 5 次错误登录仍返回 `401` 的最窄红灯，再补充反向代理来源仅能由 loopback 对端转发、外部伪造转发头不得生效的红灯。新增 `0016_auth_login_attempts.sql`，以来源和 NFKC 规范化用户名组合的 SHA-256 摘要保存失败窗口与锁定状态；认证服务在 15 分钟内第 5 次失败后锁定 15 分钟，锁定期稳定返回 `429` 与 `Retry-After`，正确密码不能绕过，窗口到期后恢复，成功认证清除状态。PostgreSQL 以插入冲突处理、行锁和单事务递增保证跨 API 实例共享；锁定转换只写入不含密码或明文来源的审计。内存 API 回归为 `102 passed`，可丢弃 PostgreSQL 16 集成为 `28 passed`，迁移测试为 `9 passed`，仓库级类型检查、生产构建和 `git diff --check` 通过。两次临时数据库容器均已删除，未触发 Runner、TCR、服务器写入或公开 release。CR-032 已从问题明细移入本索引；当前遗留问题为 P2 4 项、P3 2 项，仍不生成正式制品或公开上线。

- 2026-07-23：CR-031 完成本地整改。先在可丢弃 PostgreSQL 16 以两个不同可发布运行并发发布取得 `[200, 200]` 的最窄红灯；随后新增 `0015_batch_publication_version.sql`，为批次维护发布版本。运行发布、草稿发布和发布回滚均在单事务内锁定批次、比较版本、更新指针并写入成功审计；陈旧请求稳定返回 `409`，审计写入失败会回滚指针变更。内存 API 回归为 `97 passed`，可丢弃 PostgreSQL 16 集成为 `27 passed`，迁移测试为 `9 passed`，仓库级类型检查和构建通过。临时数据库容器已删除，未触发 Runner、TCR、服务器写入或公开 release。CR-031 已从问题明细移入本索引；当前遗留问题为 P2 5 项、P3 2 项，仍不生成正式制品或公开上线。

- 2026-07-23：CR-029 完成本地整改。`apps/api/src/app.ts` 将 dashboard、基础数据、运行、草稿、比较和建议统一限制为 `admin/operator`，审计限制为 `admin`，全量 CSV 不再允许教师或学生；本人 `/api/me/*` 与匿名聚合课表、公告路径未改动。先由最窄授权矩阵取得红灯，再完成实现；随后 `npm test` 为 `97 passed`，`npm run typecheck`、`npm run build` 与 `git diff --check` 通过。使用可丢弃 PostgreSQL 16 的集成回归为 `22 passed`，其中教师和学生对 11 条运营读取路径（含 CSV）均为 `403`。独立复核未发现 Critical、Important 或 Minor 问题。临时数据库容器已删除，未触发 Runner、TCR、服务器写入或公开 release。CR-029 已从问题明细移入本索引；该时点遗留问题为 P2 6 项、P3 2 项，公开上线仍须先生成并验证包含该修复的新正式制品，并完成任务 7 与正式域名验收。

- 2026-07-17：以固定基线 `b1aaedea236c142f42cc0df6e40d38db935b5841` 汇总 Codex 与 Grok Build 两条互相隔离的第五版全量审查。两边独立确认 CR-029 权限越界和 CR-030 同毫秒排序；主线再用可丢弃 PostgreSQL 16 复现 CR-031，两个不同 run 并发发布均返回成功并写入 2 条成功审计；用 30 名教师、15 个教室、20 个时段和 150 个任务复现 CR-035，130,500 个候选耗时约 10,278 ms、堆内存增加约 77.8 MiB，最终只返回 8 条。其余候选完成产品裁决：CR-033 保留环境变量仅首次建户的现有合同，问题收窄为缺少显式密码轮换和会话吊销；CR-034 保留匿名聚合课表，但公开 DTO 必须剥离内部评分、冲突、诊断和 report；CR-036 作为 internal network 失守后的安全纵深风险暂缓。缺失 nginx 模板不另立 CR，因为任务 7 的 nginx/HTTPS 清单仍未完成，项目状态也从未宣称该 site 已交付；它仍是备案后完成任务 7 的必需产物。最终新增 CR-029 至 CR-036：P0 0、P1 1、P2 6、P3 1；连同既有 CR-003，问题明细共 9 项。第五版不得在 CR-029 未解决时公开上线或归档。

- 2026-07-17：CR-028 完成远端关闭。共享重试策略继续固定为最多 6 次尝试、1000 ms 指数退避基数，Publisher、Worker/`JobExecutionService`、生产 Compose 和预检使用同一合同。提交 `a507993` 的工作流 `29561565291` 中，GitHub 质量 job 与本地 release job 均为 `success`；四镜像首次构建/探针、SBOM、Trivy HIGH/CRITICAL、TCR 推送、远程 digest、release manifest 和正式 artifact `8399608869` 全部通过。北京服务器按新 manifest 部署后，Scheduler 停止场景依次产生 3 个 `scheduler_unavailable` attempt 和 3 个 `schedule_job.retry_scheduled`，第 4 个 attempt 成功；最终仅 1 个运行、14 个严格有序事件。API 重启后的 SSE 以 `Last-Event-ID` 重连，只回放后续 4 个事件并收到成功终态；Redis、Publisher 和 Worker 故障同样保持单一运行。随后真实回滚到 `f769725` 用时 127 秒，回滚后业务 smoke 通过；重新部署 `a507993` 用时 128 秒并再次通过 smoke。CR-028 从问题明细移除并进入已解决索引，当前没有待解决 P0/P1。

- 2026-07-17：远端部署前发现 Ubuntu 主机 Node.js `v12.22.9` 无法解析宿主侧 release verifier 的逻辑空值赋值、可选链、空值合并和 CommonJS `node:` 模块名。两次失败均发生在镜像拉取和容器启动前，部署错误处理保留旧 `current` 与环境文件。最窄合同先约束宿主侧校验库不使用 `??`、`?.`，且 `deploy.sh` 不使用 `require("node:...")`，再改为等价显式判断和 `require("fs")`；服务器原生 Node 完成语法检查与完整 bundle 校验，部署合同增至 `39 passed`。应用构建与运行仍固定 Node.js 22.22.2，没有降低应用运行时基线或全局升级同机 Node。

- 2026-07-17：apt 修复提交 `b9a2274` 的工作流 `29560455791` 中，GitHub 质量 job、本地四镜像首次构建与职责探针、四份 SBOM、Trivy HIGH/CRITICAL 门禁、TCR 登录、四次推送、远程 digest 读取和 release manifest 校验均成功；正式 bundle 在 `CreateArtifact` 阶段遇到一次 `ECONNRESET`，主 artifact 上传失败，失败诊断 artifact 随即成功。由于正式 artifact 缺失，本轮候选 tag 与 manifest 不得部署，运行没有连接服务器。最窄合同红灯随后要求首次上传失败保留 bundle、等待 5 秒并以同名 `overwrite` 最多重试 1 次；实现与 Actionlint 转绿。尚未取得完整新 release artifact，CR-028 状态不变。

- 2026-07-17：Engine builder 修复提交 `a8ae2f2` 的工作流 `29558412245` 中，质量 job、本地 builder 校验、API 与 scheduler 首次构建/探针通过；Web 第一次在下载 `sed` 安全更新时遇到代理 `502`，第二次在 Debian `InRelease` 遇到 `502`，有界 helper 正确记录 failed/retrying/failed。运行未进入 SBOM、Trivy、TCR 登录、推送或 manifest，失败诊断 artifact ID 为 `8398425713`，清理与 Runner 退出成功。对照探针证明相同容器经官方 CDN 连续 3 次达到 120 秒边界，经清华 Debian 镜像约 4 秒完成 9.3 MB 签名索引；修复后的 `upgrade-debian.sh` 保留 Debian Release 签名与包哈希校验，对 update/upgrade 各设置单次 120 秒、最多 3 次并输出状态，四个正式镜像均在首次尝试完成真实构建与职责探针。该时点发布专项为 `19 passed`、部署合同为 `38 passed`；尚未生成新正式 digest，CR-028 状态不变。

- 2026-07-17：`11ab909` 的新制品工作流 `29557441559` 中，GitHub 质量 job 成功，本地 release job 在 `docker/setup-buildx-action` 的 `buildx inspect --bootstrap` 阶段连续约 8 分钟无日志、Docker 事件或 builder 状态变化，故在业务镜像构建前取消。独立探针确认本机 `moby/buildkit` 镜像完整且可直接运行，但 `docker-container` driver 仍强制远端 pull 并在 60 秒后超时；Docker Engine `default` builder 则在约 2 秒内完成真实 `scratch` 镜像构建与加载。最窄合同测试先要求 release job 禁止 setup Action、`docker-container` 与 `--bootstrap`，随后工作流改为校验并显式使用 Engine builder，发布专项恢复为 `18 passed`。运行未登录 TCR、未生成 manifest、未连接服务器，CR-028 状态不变。

- 2026-07-16：CR-028 新制品工作流 `29482599323` 的 GitHub 托管质量 job 成功，本地 Runner 在首个 API 构建中完成基础镜像与 Debian 安全更新下载后，停在 `npm install npm@12.0.1`，连续 17 分钟没有可证明进度。运行主动取消，未进入 SBOM、Trivy、TCR 登录、推送或 manifest；清理步骤和 Runner 退出成功。系统化复现确认专用 BuildKit 已注入四组代理变量，但基础镜像鉴权仍可能出现直连超时，构建内部 npm 也缺少工作流级边界。本地新增逐镜像构建状态、独立日志、单次 30 分钟上限、最多 1 次重试和显式 build arg 代理传递；同时修正 systemd 模板误从只含供应链附件的 `releases/current` 查找运维脚本的问题。部署合同 `37 passed`、`npm run check:ci`、Bash 语法和 `git diff --check` 通过。上述改动尚未提交、推送或生成新正式 digest，CR-028 继续保持待解决。

- 2026-07-15：完成 CR-028 本地修复。新增共享、受约束的 Scheduler 作业重试策略，生产默认以 6 次尝试和 1 秒指数退避提供约 31 秒恢复窗口；生产环境示例、Publisher/Worker Compose 注入及预检合同同步更新。最窄配置测试和真实 PostgreSQL/Redis Worker 测试均先取得旧实现红灯，再转为 Worker `18 passed`；部署合同 `34 passed`、仓库级类型检查和 Bash 语法检查通过。由于没有新正式 release 和远端故障演练，CR-028 继续保持待解决，第五版远端验收与归档边界不变。

- 2026-07-15：腾讯云备案期内部部署验证发现 CR-028。正式制品 `f769725` 从广州 TCR 按 digest 拉取并完成迁移、bootstrap、健康检查和无故障业务 smoke；API、Redis、Publisher 与 Worker 故障场景恢复，但 Scheduler 重启作业在约 3.35 秒内耗尽 3 次尝试，attempt 均为 `unavailable/scheduler_unavailable`，事件以 `schedule_job.failed` 终止。故障后七项服务恢复健康，再次无故障 smoke、备份恢复和 50/100/150 场基准通过；该结果证明数据与运行时可恢复，但不能关闭 Scheduler 自动恢复合同。CR-028 作为 P1 待解决问题进入问题明细，第五版不得在修复并生成新正式制品前归档。

- 2026-07-14：第五版第六阶段任务 1 解决 CR-002。npm 元数据确认当日稳定 Next 仍精确依赖 PostCSS 8.4.31，用户书面批准受约束的临时覆盖；仓库固定 Node.js 22.22.2 与 npm 12.0.1，以有效根级 override 将唯一的 Next 依赖链解析到 PostCSS 8.5.19，并新增依赖父链测试、三项精确安装脚本 allowlist、待审批脚本 CI 门禁和 moderate 审计。干净 `npm ci` 成功，`npm ls next postcss` 有效，`npm audit --audit-level=moderate` 为 0；治理测试 `9 passed`、Web `24 passed`，Web 类型检查和生产构建通过，API/Worker/Web 三个镜像构建通过。独立 Compose 项目从空卷完成六类故障 smoke，Playwright 为 `32 passed, 3 skipped`，验证资源随后清理，用户已有栈未修改。CR-002 移入已解决索引；当前问题明细只保留 P3 的 CR-003，无待解决 P0/P1。

- 2026-07-14：第五版第五阶段完成后复核存留问题。真实 PostgreSQL/Redis、15 个迁移、Worker 故障恢复、完整构建和 35 项 Playwright 场景均通过既定门禁，未发现新的 P0/P1 或需要单独编号的实现缺陷。`npm audit --audit-level=moderate` 仍返回 2 个 PostCSS moderate 公告，强制 override 会造成依赖树无效，自动修复会错误降级，因此 CR-002 保持暂缓但提升为第六阶段正式发布前置门禁；CR-003 未发生机器级变更，仍在本地代理变化或远程部署时重评。问题明细保持 2 项，无待解决 P0/P1。

- 2026-07-13：第五版第三阶段解决 CR-007。API 已停止进程内计时器执行，改为 PostgreSQL 事务 outbox、独立 Publisher、Redis/BullMQ 和独立 Worker；作业事件以严格序列持久化，SSE 先补发 PostgreSQL 历史并支持 `Last-Event-ID`，Redis 只用于唤醒。Web 已移除 1200 ms 主轮询，以 SSE 更新 Query cache，仅在断线期间执行不低于 5 秒的兜底查询。真实 PostgreSQL/Redis Worker 测试 `14 passed`；隔离 Compose 从空卷完成 API 重启、Redis 停止恢复、Publisher 重启、Worker 崩溃回收、scheduler 不可用重试、重复 outbox 和 SSE 重连，所有场景最终只生成一个运行结果，Chromium E2E `21 passed`。CR-007 移入已解决索引；当前问题明细仅保留 CR-002 和 CR-003。腾讯云私有试部署未获单独授权，未作为关闭该本地架构问题的虚假证据。

- 2026-07-13：第五版第二阶段解决 CR-008。新增独立 FastAPI scheduler 的 `/health`、`/ready`、`/solve` 和确定性 OpenAPI，CLI/HTTP 共用解析、求解、报告与序列化 pipeline；API 生产 Compose 显式使用 HTTP 客户端并稳定分类合同错误、业务不可行、超时、取消、不可用、协议损坏和内部错误，不进行 CLI 回退。独立 scheduler 镜像以 UID 10002 运行并设置 CPU、内存、进程数和健康检查，API 镜像探针确认不含 Python/uv。固定样例等价测试覆盖可行、不可行、固定安排和增量重排；隔离 Compose smoke 直连 scheduler 后完成真实会话排考、PostgreSQL 持久化和 API 重启读取，Chromium E2E `17 passed`。CR-007 仍保留到第三阶段，不能用同步 HTTP 服务替代可靠队列或 SSE 结论。

- 2026-07-06：创建本文档，迁入 `docs/status/project_status.md` 中既有存留风险，并补充第二版第四阶段已明确的轻量实现边界问题。
- 2026-07-06：执行当前 `main` 全量代码审查；复核 CR-001 至 CR-009 均仍成立，新增 CR-010 至 CR-013。新鲜验证包括：默认 `python -m pytest -q` 因 `python` 缺失失败，`cd apps/scheduler && uv run --python 3.12 --extra dev python -m pytest -q` 为 `32 passed`，`npm test` 为 API `16` 个测试通过，`npm run typecheck` 通过，`npm run build` 通过，顺序运行 `npm run test:e2e` 为 `2 passed`，`npm audit --audit-level=moderate` 仍报告 2 个 moderate 公告。
- 2026-07-07：修复 CR-010、CR-011、CR-012，提交为 `a835a94 fix(审查): 修复角色权限与草稿锁定问题`。先新增 API 红灯测试，确认无角色默认管理员、空 `allowed_slot_ids` 草稿误阻断和 DB schema 缺少锁字段三个问题可复现；随后完成修复并验证 `npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e` 均通过。
- 2026-07-07：修复 CR-001。仓库根 `package.json` 新增 `npm run test:scheduler`，统一通过 `uv run --python 3.12 --extra dev python -m pytest -q` 调用调度器测试；`apps/scheduler/AGENTS.md` 和 `README.md` 同步改为推荐项目级脚本，避免后续代理依赖本机默认 `python`。验证 `npm run test:scheduler` 通过，调度器测试结果为 `32 passed`。
- 2026-07-07：修复 CR-004、CR-005、CR-006、CR-013。新增 `schema_migrations` 迁移执行器和 `npm run db:migrate`；API 改为 Bearer token 登录与鉴权，Web 角色演示改用对应 token；异步排考作业移入 repository，并在 PostgreSQL 中新增 `schedule_jobs` 表；DB schema 和迁移补充外键、唯一约束，API 基础数据写入补充跨资源引用校验。验证 `npm run typecheck`、`LOG_LEVEL=silent npm test`、`npm run build`、`npm run test:scheduler`、`npm run test:e2e`、`git diff --check` 均通过；API 测试结果为 `22` 个测试通过，调度器测试结果为 `32 passed`，E2E 结果为 `2 passed`。
- 2026-07-07：修复 CR-009。完成第三版第一阶段 Web 运营台拆分：新增统一 API client、角色 token 边界、query keys、TanStack Query provider 和按业务面组织的 `apps/web/features/`；异步作业、已发布查询、基础数据、教师不可用、运行历史/审计和草稿工作台均已从主组件拆出；`operations-console.tsx` 从约 2397 行收敛到 851 行。验证 `npm run typecheck`、`LOG_LEVEL=silent npm test`、`npm run build`、`npm run test:e2e`、`git diff --check` 均通过；API 测试结果为 `22` 个通过，E2E 结果为 `2 passed`。
- 2026-07-08：执行第三版第四阶段后全量代码审查；复核 CR-002、CR-003、CR-007、CR-008 仍成立，新增 CR-014 至 CR-017。新鲜验证包括：`npm run test:scheduler` 通过，调度器测试结果为 `42 passed`；`LOG_LEVEL=silent npm test` 通过，API 测试结果为 `30` 个通过；`npm run typecheck` 通过；`npm run build` 通过；`npm run test:e2e` 通过，Playwright 结果为 `2 passed`；`npm audit --audit-level=moderate` 仍返回 2 个 moderate 公告；`TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:postgres`、`TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:migrations` 和 `DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run db:migrate` 均因 `connect ECONNREFUSED 127.0.0.1:5432` 失败，当前会话未取得真实 PostgreSQL 通过结论。
- 2026-07-08：按审查顺序修复 CR-014、CR-015、CR-016、CR-017。CSV 导出改为 Bearer 鉴权和下载审计；Web 运营台只读服务端数据改为直接消费 TanStack Query 数据；API 启动时将历史 `queued` / `running` 异步作业标为 failed 并记录审计；迁移完整性测试移除废弃草稿唯一约束断言，并将 `0007` 关联表纳入关键迁移检查。验证 `LOG_LEVEL=silent npm test`、`npm run test:scheduler`、`npm run typecheck`、`npm run build`、`npm run test:e2e` 均通过；API 测试结果为 `31` 个通过，调度器测试结果为 `42 passed`，E2E 结果为 `2 passed`。真实 PostgreSQL 验证仍受本机环境阻塞：`docker ps --format ...` 未发现运行中容器，`TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:postgres`、`TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:migrations`、`DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run db:migrate` 均因 `connect ECONNREFUSED 127.0.0.1:5432` 失败。
- 2026-07-08：修复 CR-018、CR-019。先新增 API 红灯测试，确认 `POST /api/schedule-runs` 和 `POST /api/schedule-jobs` 会把 `fixed_assignments` 丢成空数组；随后 API 排考入口改为解析 shared `fixedAssignmentSchema` 并合并到调度器输入。PostgreSQL 仓储 `getReferenceData()` 改为优先从 `teacher_unavailable_slots` 和 `exam_task_student_groups` 关联表构建教师不可用与考试学生组，JSONB 字段保留为兼容回退；同时新增 PostgreSQL 集成测试覆盖关联表优先读路径。验证 `LOG_LEVEL=silent npm test --workspace @examforge/api -- --test-name-pattern "fixed assignments"` 通过，API 测试结果为 `33` 个通过；`LOG_LEVEL=silent npm test --workspace @examforge/api` 通过，API 测试结果为 `33` 个通过；`npm run typecheck --workspace @examforge/api` 通过。真实 PostgreSQL 验证仍受本机环境阻塞：`TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:postgres --workspace @examforge/api` 因 `connect ECONNREFUSED 127.0.0.1:5432` 失败，当前会话未取得真实库通过结论。
- 2026-07-11：第四版第一阶段继续补强 CR-019 的真实库证据和长期边界。PostgreSQL 正式排考、教师已发布查询、草稿详情、草稿对比和草稿发布均改为优先读取监考教师关联表，并通过主动删除关联行的测试证明 JSONB 兼容回退；迁移检查新增 4 张关联表的主键、外键和 JSONB 双向一致性检测。新增排考、草稿和发布治理 service，草稿 service 对终态与锁定进行业务短路，发布前继续由 repository 重新校验硬冲突；PostgreSQL 同一草稿的全部 mutation 通过 advisory lock 串行化，锁和业务 SQL 共用同一专用连接，失败时先排空已入队查询再解锁和释放，终态转换使用可编辑状态 CAS，避免连接池耗尽、连接复用污染、终态回退、终态后变更和并发重复发布；CSV 下载审计在 service 中保留 actor、entity type、entity id 和 payload。验证 `LOG_LEVEL=silent npm test` 为 API `44` 个通过，`npm run typecheck`、`npm run build`、`npm run test:scheduler` 和 `git diff --check` 通过；真实 PostgreSQL 集成测试为 `9 passed`，迁移与数据库 session 检查为 `4 passed`，正式迁移入口无待应用迁移。CR-002、CR-003、CR-007、CR-008 本阶段未处理，状态保持不变。
- 2026-07-12：执行第四版完成后全量代码审查，基线 `HEAD=origin/main=2320fbdfbe2e1cd9c1be4d1d67b807f7ce0017db`，`.codegraph/` 可用；完整覆盖调度器、API/service、内存与 PostgreSQL、迁移/shared、Web、测试、CI/Compose/依赖和文档。复核 CR-002、CR-003、CR-007、CR-008 仍成立且没有重复编号，CR-014 至 CR-019 未发现回归；新增 CR-020 至 CR-027。当前待解决/暂缓问题共 12 个，分布为 P0 2 个、P1 3 个、P2 6 个、P3 1 个。
- 2026-07-12：新鲜验证结果：`npm run test:ci` 为 7 passed，`npm run check:ci`、`npm run typecheck`、`LOG_LEVEL=silent npm test`（54 passed）、`npm run test:scheduler`（73 passed）和 `npm run build` 通过；固定 seed 的 50/100/150 场 benchmark 均 feasible、0 冲突，耗时 262/403/676 ms，教师负载极差均为 1。独立 `examforge_review_test` PostgreSQL 16 容器中迁移测试 4 passed、迁移检查无缺失、正式迁移无待应用、集成测试 9 passed；独立 Compose 项目和端口从空卷完成 smoke、API 重启持久化及 Chromium E2E 3 passed，随后容器、网络和卷已清理，原有演示栈未被修改。`docker compose config --quiet`、`uv lock --check` 通过；当前环境未安装 `actionlint`，因此未重复本地静态检查，已有提交 `533619d` 的 GitHub Actions 成功证据仍有效。
- 2026-07-12：依赖复核中 `npm audit --audit-level=moderate` 仍因 2 个 PostCSS moderate 公告返回 1，归入既有 CR-002；Docker daemon 代理归入既有 CR-003。P0/P1 必须在第五版第一阶段开始前进入独立整改计划；本轮按只审查不修复边界停止，未修改业务代码、测试、迁移、依赖、CI 或部署配置。
- 2026-07-12：修复 CR-020。先用内存 API 和隔离 PostgreSQL 16 复现 `infeasible` 空运行被直接发布、空草稿被误标为 `validated` 的红灯；随后新增统一发布资格函数，要求运行状态为 `feasible`、无硬冲突，且考试任务与安排一一对应，草稿校验同时把缺失和重复任务记录为硬冲突。内存与 PostgreSQL 最终发布路径均返回稳定的 `not_publishable`，HTTP 映射为 409；合法发布测试夹具改为六个考试任务、六条安排和七条监考关联的完整可行方案。最窄 API 三类负向用例通过，`npm run typecheck --workspace @examforge/api` 通过，API 全套 56 项通过，隔离 PostgreSQL 集成测试 10 项通过。
- 2026-07-12：修复 CR-021。API 增加统一 GET `preHandler`，内部 dashboard、基础数据、作业、运行、草稿、建议、对比和审计读取要求有效 Bearer token，无 token 或伪造 token 稳定返回 401；匿名白名单仅保留 `/health`、`/ready` 和已发布总览、通知、教师及学生群体查询，CSV 导出继续要求认证。Web 内部读取统一使用 viewer 演示 token，变更请求仍使用当前角色 token；E2E 直接读取辅助函数同步携带 viewer token。验证 `npm run typecheck` 通过，API 全套 59 项通过，隔离 PostgreSQL 集成测试 10 项通过；临时 `3101/4101` 服务上的 Chromium E2E 4 项通过，随后服务已停止，原有演示栈未修改。
- 2026-07-12：修复 CR-023。API `validateReferenceRecord()` 和 Python `validate_schedule_input()` 统一拒绝教师引用不存在的不可用时段；草稿 assignment 校验新增 `time_slot_not_found` 硬冲突，即使考试任务不限时段也不能使用不存在的时段。教师快捷更新路由补齐 `ReferenceIntegrityError` 映射，Fastify 对 PostgreSQL `23502/23503/23505/23514` 完整性异常统一返回不含 SQL、表名和参数的 409。红灯覆盖内存、草稿、Python 和隔离 PostgreSQL；验证 API 全套 62 项、scheduler 74 项、隔离 PostgreSQL 11 项通过，`npm run typecheck` 和 `git diff --check` 通过。
- 2026-07-12：修复 CR-022。新增 scheduler 共享 `are_consecutive_time_slots()`，将连续场次统一定义为同一日期且 `period_index` 差 1；room-slot 学生目标、教师分配目标和最终学生/教师评分共同调用该函数，并按 `(date, period_index)` 排序。专项红灯证明旧实现会对跨日安排误罚、推迟考试并改选第三位教师；同日相邻、同日不相邻和跨日相邻 index 对照均转绿。scheduler 全套 78 项通过；固定 seed 的 50/100/150 场 benchmark 均 feasible、0 冲突，耗时 258/363/652 ms，教师负载极差均为 1。
- 2026-07-12：修复 CR-024。Playwright 用可控延迟复现考试 A 建议晚于 B 返回后，旧实现仍向 A 的 assignment 发送 PATCH；随后为建议请求增加递增代次，响应同时校验草稿 ID 与考试 ID，切换草稿、选择或进入终态会清空并失效旧请求，应用前再次核对当前上下文，面板显示绑定的考试 ID。专项用例验证快速切换后只修改 B，发布进入终态后不再提供应用操作；临时 `3104/4104` 服务上的 Chromium 全套 5 项通过，服务随后已停止，原有演示栈未修改。
- 2026-07-12：修复 CR-025。Playwright 分别拦截运行、审计、草稿和作业历史接口返回 500，四个红灯均证明旧界面没有错误提示并继续渲染空状态；随后四个面板分别消费对应 Query 的 `isError`、`isFetching` 与 `refetch`，共享错误组件提供可见 `role=alert`、重试状态和重试按钮，失败面板不再显示伪空数据，dashboard/reference 等成功数据继续可用。四类故障注入与恢复专项用例 4 项通过；临时 `3105/4105` 服务上的 Chromium 全套 9 项通过，服务随后已停止，原有演示栈未修改。
- 2026-07-12：修复 CR-026。Playwright 分别证明运行发布、发布回滚、草稿废弃和基础数据删除在旧实现首次点击后立即产生 1 次真实请求；随后新增共享原生 `dialog` 确认组件，使用 `role=alertdialog` 展示目标 ID 与影响说明，并覆盖运行/草稿发布、回滚、废弃和删除入口。对话框初始聚焦取消按钮，Escape/取消不发请求并把焦点归还触发器，确认期间禁用操作，强制重复点击仍只发送 1 次请求。四类专项用例通过；临时 `3106/4106` 服务上的 Chromium 全套 13 项通过，服务随后已停止，原有演示栈未修改。
- 2026-07-12：修复 CR-027。DOM 红灯确认旧页面仍暴露 1 个不完整 `grid`；随后草稿矩阵改为原生 `table`、`thead`、`tbody`、列头、行头和数据单元格，交互与拖拽继续由单元格内原生按钮承载，横向滚动限制在矩阵包装层。全局异步错误和面板查询错误使用 polite live region，确认对话框补充滚动边界。专项用例精确核对列头、行头和单元格数量，Enter 可激活考试，1600×1000 与 375×812 均无页面级横向溢出；临时 `3107/4107` 服务上的 Chromium 全套 14 项通过。实际截图复核桌面、移动矩阵及移动确认框均无文本或控件重叠，服务随后已停止，原有演示栈未修改。
- 2026-07-12：处置 CR-002、CR-003、CR-007、CR-008。CR-002 的 npm 官方元数据和隔离 lock 探针证明，强制 PostCSS override 虽可清除 audit，但会使 `npm ls` 返回 `ELSPROBLEMS`，相关试验改动已撤回；CR-003 的 daemon 代理仍为 `172.22.112.1:7897`，实际拉取 PostgreSQL 新镜像成功且未修改机器配置；CR-007/008 分别依赖第五版第三阶段可靠任务事件/SSE和第二阶段 FastAPI/OpenAPI 合同，第一阶段明确不实施。四项均保留在问题明细并改为暂缓，具备明确重评条件。
- 2026-07-12：完成第四版审查整改全量验证。`npm run test:ci` 为 7 passed，`npm run check:ci`、`npm run typecheck`、`LOG_LEVEL=silent npm test`（API 62 passed）、`npm run test:scheduler`（78 passed）和 `npm run build` 通过；固定 seed 的 50/100/150 场 benchmark 均 feasible、0 冲突，耗时 246/412/724 ms，教师负载极差均为 1。可丢弃 PostgreSQL 16 容器中迁移测试 4 passed、迁移检查无缺失或双向不一致、正式迁移无待应用、集成测试 11 passed。第一次独立 Compose 验证因 `demo-smoke.mjs` 匿名读取受保护基础数据返回 401 而失败，补齐 viewer token 后，第二次从空卷完成 smoke、API 重启持久化和 Chromium E2E 14 passed；测试容器、网络、卷及隔离 PostgreSQL 均已清理，原 `examforge` 栈保持健康。当前问题明细只剩 4 项暂缓边界，分布为 P2 3 项、P3 1 项，无待解决 P0/P1。
- 2026-07-12：第五版第一阶段完成作业状态/事件/outbox、关系化单一事实源、本地账户与服务端会话、四角色 RBAC、真实 actor 审计、Web Cookie 会话及前端信息架构基础。CR-007 复核后仍存在：持久化事件已经具备，但 Publisher、可靠 Worker 与 SSE 补发合同尚未实现，继续留到第三阶段。CR-008 复核后仍存在：API 生产路径仍调用 Python CLI，已通过 `docs/plan/第五版第二阶段计划.md` 固定 FastAPI/OpenAPI/HTTP 客户端和独立部署的验证门槛，在取得实现证据前不提前关闭。CR-002、CR-003 状态不变；问题明细仍为 P2 3 项、P3 1 项，无待解决 P0/P1。
