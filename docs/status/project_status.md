# ExamForge 项目状态

## 1. 当前结论

- 第五版第五阶段已于 2026-07-14 完成并归档，当前唯一活动计划为 `docs/plan/第五版第六阶段计划.md`。
- Web 已从根路由组合原型拆分为登录、管理员、排考、运行、草稿、审计、教师本人和学生本人页面；筛选、分页、对比和选中对象进入 URL，可直接访问、刷新和前进后退。
- 教师与学生作用域由 PostgreSQL 关联和服务端会话决定。本人页面只调用 `/api/me/*`，不能通过路径、查询参数或请求体切换到其他教师或学生群体。
- 作业、SSE、策略快照、发布资格和审计继续复用第三、第四阶段的服务端合同；页面拆分没有复制任务状态机或把 PostgreSQL 事实迁入浏览器。
- CR-002 已在第六阶段任务 1 关闭；代码审查当前保留 P3 的 CR-003 和 P1 的 CR-028。CR-028 已完成本地修复与真实 PostgreSQL/Redis 回归，但在新正式 digest 完成腾讯云 Scheduler 冷恢复前继续保持待解决；详细问题只维护在 `docs/status/code_review_status.md`。
- 第五版第一至第五阶段均已提交并推送；第六阶段生产发布与运维基线已由 `f741fc0` 提交并推送，TCR 冷上传超时调整为 `6c94599`，本地 WSL self-hosted Runner 的 B 方案实现为 `5f8eee8`，Buildx 代理修复和首次正式发布提交为 `f769725`。工作流 `29357107371` 已成功生成四个广州 TCR digest、完整 release manifest、SBOM 和扫描 artifact；服务器已完成不经域名暴露的内部部署、备份恢复和 150 场基准验证，验证后 ExamForge 栈已停止，nginx、证书、域名流量和其他服务均未修改。CR-028 修复后的工作流 `29482599323` 因首个 API 构建无法证明持续进度而取消，未登录 TCR、未推送镜像、未生成新 manifest，也未修改服务器。

## 2. 已实现内容

### 2.1 本人作用域与角色路由

- 新增 `0014_user_audience_scopes.sql`，以 `user_teacher_scopes` 和 `user_student_group_scopes` 保存用户与教师/学生群体的关系；外键、教师唯一绑定、重复迁移和第四阶段数据升级均由迁移测试与检查器覆盖。
- 新增 `/api/me/audience`、`/api/me/published-schedule`、`GET /api/me/teacher-unavailable-slots` 和 `PATCH /api/me/teacher-unavailable-slots`。教师只能读取本人监考与维护本人不可用时间，学生只能读取所属群体的已发布安排。
- 旧按教师或学生群体 ID 的发布查询不再匿名开放；管理员/排考员保留受保护的运营预览，教师/学生越权访问稳定返回 403，缺失本人 scope 不回退到演示 ID。
- 全局 `AuthProvider`、角色路由守卫和两类应用壳已经落地。根路由按真实会话角色分流，匿名深链使用安全 `returnTo` 回跳，会话失效清理私有 Query cache；403、404、页面错误和加载状态均有独立页面表达。

### 2.2 页面化运营工作流

- 管理员概览与基础数据迁入 `/admin/overview` 和 `/admin/reference-data`；资源 tab、筛选和选中记录由 URL 保持，局部请求失败不会抹去其他成功数据。
- 作业中心与策略治理迁入 `/scheduling/jobs` 和 `/scheduling/policies`。作业筛选、分页和选中任务由服务端稳定处理，详情继续展示持久化 attempt、有序事件、SSE、诊断、取消与运行入口；策略修改仍采用不可变版本、CAS、启停和唯一默认治理。
- 运行、对比和审计迁入 `/scheduling/runs` 与 `/audit`，支持深链筛选、发布/回滚确认、策略与 scheduler 追溯、审计 payload 按需展开以及不存在实体的 404。
- 草稿唯一编辑入口为 `/scheduling/drafts/:id`。矩阵使用 dnd-kit 的 pointer/keyboard sensor，并保留等价检查器表单；拖拽前后核对草稿、考试和响应代次，锁定与终态同时禁止所有 mutation 入口。
- 教师 `/teacher/schedule` 展示下一场监考、按日期分组日程和本人不可用时段；学生 `/student/schedule` 只展示所属群体考试，不泄露教师工作量、内部冲突或策略诊断。

### 2.3 视觉与可访问性门禁

- 全局样式拆分为 token、布局和表单层，受众页面使用独立 CSS module；移除残余暖色硬编码和无意义装饰，补齐跳到主内容、焦点可见、语义列表、图标标签和 `prefers-reduced-motion`。
- Playwright 固定 1600 x 1000、1280 x 800、768 x 1024 和 375 x 812 四种视口，并保存登录、概览、作业、草稿桌面及教师、学生移动端共 6 张 Linux Chromium 基线。
- `@axe-core/playwright` 对登录和全部关键角色页面执行 WCAG 2.1 A/AA 自动扫描；另有 200% 文本、403、404、依赖失败、键盘拖拽、焦点和页面级横向溢出专项断言。
- 旧根路由组合组件及已迁移的发布、运行、审计和教师不可用面板已删除；现有页面按 feature、layout、route 和纯 URL model 分工，不再维护第二套聚合入口。

### 2.4 真实依赖与故障证据

- 独立 Compose 项目从空 PostgreSQL/Redis 卷完成迁移、seed、四角色登录、本人 scope、作业提交、SSE、策略选择、运行跳转、草稿调整和发布查询。
- API 重启与 SSE 重连最终为 1 个 attempt、5 个事件和 1 个运行；Redis 停止恢复和 Publisher 重启也各保持 1 个 attempt、5 个事件和 1 个运行。
- Worker 崩溃由第 2 个 attempt 以 `worker_delivery_reclaimed` 回收，scheduler 暂停由第 2 个 attempt 在首个 `scheduler_unavailable` 后恢复；两种场景均为 8 个有序事件和 1 个运行。
- 重复投递同一 outbox 只增加 outbox 投递次数，不增加作业 attempt、业务事件或运行。全部证据使用独立端口、卷和测试数据库，完成后已删除该项目的容器、网络和卷，用户已有 Compose 栈未被修改。

### 2.5 第六阶段依赖与服务器前置准备

- 第六阶段任务 1 已关闭 CR-002。仓库固定 Node.js 22.22.2 与 npm 12.0.1；Next 15.5.20 的唯一 PostCSS 依赖链由有效 override 解析到 8.5.19，并由测试约束覆盖范围。CI 同时执行 moderate 审计和安装脚本审批门禁。
- `esbuild@0.28.1`、`msgpackr-extract@3.0.4` 与 `sharp@0.34.5` 是当前唯一获准运行安装脚本的精确版本；新增或漂移的安装脚本会使 CI 失败。
- 经用户授权，腾讯云数据盘与 COS 已分别迁到共享挂载点 `/srv/data/hot`、`/srv/data/cos`；旧 `/srv/data/devbrain-lab` 层级已移除，OpenViking 和 COS 挂载服务恢复健康。ExamForge 后续使用 `/srv/data/hot/examforge`，COS 只存备份等对象，不承载 PostgreSQL/Redis 在线数据。

### 2.6 生产配置与启动前门禁

- 第六阶段任务 2 已建立独立 `compose.production.yml`。生产定义不继承演示 build、seed、端口或弱默认值；六类镜像必须使用 digest，只有 Web/API 绑定 loopback，PostgreSQL、Redis、scheduler、Publisher 和 Worker 只在内部网络通信。
- 全部生产容器使用非 root、只读根文件系统、能力移除、`no-new-privileges`、进程/CPU/内存、日志轮转、优雅停止和健康检查约束。PostgreSQL 与 Redis 的持久数据分别写入 `/srv/data/hot/examforge` 下的独立目录，COS 目录只作为异机备份目标。
- API 新增显式 `demo`/`production` 部署模式。生产模式在监听前拒绝缺失数据库或 Redis、非 HTTP scheduler、弱或占位四角色密码、非精确 HTTPS Origin、关闭 Secure Cookie、非法 Cookie 名称或 TTL；演示 Compose 显式保持 `demo` 模式。
- `scripts/deploy/preflight.sh` 以只读方式校验 600 环境文件、owner、必填变量、镜像 digest、目录边界与 UID/GID、磁盘、内存、端口和镜像可访问性。腾讯云已建立 700 权限应用目录、600 权限环境文件及独立数据/备份目录；除一次 Docker Hub manifest 查询超时外，主机合同检查通过，六个固定 digest 随后均由实际 `pull` 验证可读。内部验证期间只有 Web/API 绑定 loopback，其他服务无宿主端口。
- CR-028 本地修复新增共享重试策略，生产默认最多尝试 6 次、指数退避基数 1000 ms，最终单次退避限制为 30000 ms；`.env.production.example` 显式声明两项配置，Compose 同时注入 Publisher 与 Worker，预检拒绝缺失、越界或跨字段不一致的窗口组合。

### 2.7 不可变镜像发布与供应链清单

- 第六阶段任务 3 已新增手动 `release-images.yml`，并由 `5f8eee8` 拆分为 GitHub 托管 `quality` 与 `[self-hosted, linux, x64, examforge-release]` 的 `release`：前者只运行质量门禁并上传生产依赖审计，后者才构建、探测、生成 SBOM、扫描和推送四个 linux/amd64 镜像。两者均检出精确发布 SHA，质量 job 不接触 TCR 变量或凭据。
- 四个运行时镜像均带有 OCI source、revision 和 created 标签，并保持非 root 与职责隔离。Web 显式固化正式 API origin；API 探针拒绝 Python/uv，Web 探针拒绝服务器 secret。Node 运行时镜像移除了不参与启动的全局 npm/npx，并与 scheduler 一并完成 Debian 安全更新。
- 发布清单固定提交、创建时间、构建平台、四个 TCR tag/digest、OCI 来源、生产 npm 审计、SPDX SBOM、Trivy 报告及附件 SHA-256。验证器拒绝 `latest`、本地 image ID、提交或 tag 不一致、附件缺失或篡改、HIGH/CRITICAL 非零、越界附件路径和疑似 secret 字段。
- 工作流 artifact 保存发布清单及全部审计、SBOM、扫描附件 90 天。正式 GitHub 托管 Runner 发布已执行两次：`29330180914` 达到原 60 分钟 job 上限后取消；`29334386863` 在推送步骤超过 60 分钟仍无可下载的实时日志或可证明进度，用户要求人工取消。两次运行的质量门禁、四镜像构建/探针、SBOM 和 HIGH/CRITICAL 扫描均成功，但均未生成完整 release manifest 或四个可部署 TCR digest。
- 优化前本地镜像证据为 API 约 982 MB、Worker 约 980 MB，两者各复制约 499 MB 的完整根 `node_modules` 层，容器内目录约 477 MB。当前本地重建改为目标 workspace 最小生产依赖，API 为 417 MB、Worker 为 414 MB，依赖目录分别为 42 MB 和 40 MB；运行镜像探针按同一 `docker image ls` 口径强制 700 MB 上限。
- self-hosted 发布 job 使用本次 job 专用 Buildx builder；每个镜像最长推送 30 分钟、最多重试 1 次，并独立记录状态和远程 registry digest。失败会停止后续镜像且不生成正式 manifest。workflow 不执行 SSH、SCP、nginx、Certbot 或远程 Compose；北京服务器继续只按 digest 部署，Runner 不持有生产 SSH 私钥或环境 secrets。
- 首次 self-hosted 工作流 `29354931745` 的 GitHub 托管质量 job 成功，本地 Runner 接收发布 job；首个 API 构建因 `docker-container` BuildKit 未继承 WSL HTTP(S) 代理而无法解析 Docker Hub 基础镜像，运行在 SBOM、Trivy、TCR 登录和推送之前失败。当前修复只把 Runner 进程代理注入本次专用 builder 并使用宿主网络，不修改 Docker 全局配置；本地空缓存 builder 已完成真实拉取、构建和职责探针。
- 代理修复提交 `f769725` 的工作流 `29357107371` 已成功：GitHub 托管质量 job 与本地 Runner 发布 job 均为 `success`，四镜像构建/探针、SBOM、Trivy HIGH/CRITICAL 门禁、TCR 登录、逐镜像推送、远程 digest 校验、release manifest 校验和正式 artifact 上传全部通过。正式 digest 为 API `sha256:a09acaad...73c0`、scheduler `sha256:b9bc72a5...0fad`、Web `sha256:ae735a3b...5b36b`、Worker `sha256:a346a2d0...982f`；artifact 为 `examforge-release-f7697252a931b3da871272355fec3ebcab0e3842`。

### 2.8 备份恢复与运维巡检

- 第六阶段任务 4 已新增 PostgreSQL custom-format 备份和恢复脚本。备份集合固定包含转储、SHA-256、迁移版本、脱敏摘要与 `.meta` 完成标记；本地和 COS 挂载目录均在附件到齐后才发布完成标记，外部复制失败不会删除上一份有效备份，也不会提前执行保留期清理。
- 恢复入口拒绝源库，只允许同时满足命令行确认、`_disposable` 名称和数据库级 `examforge.disposable=true` 标记的目标。恢复后使用生产 migrate 服务运行迁移检查，并比较关键表、本人 scope、发布版本、作业/attempt/事件序列和审计计数的脱敏摘要。
- 新增每 5 分钟健康巡检和每日备份的 systemd 模板，以及独立 nginx access/error logrotate。健康检查以稳定类别报告证书、数据盘、容器状态、API/Publisher/Worker/scheduler readiness、本地/异机备份完整性和年龄，不输出环境文件值。systemd 模板固定从 `/srv/apps/examforge` 稳定运维目录读取脚本、Compose 和 600 环境文件，不把只含 manifest/SBOM 的 `releases/current` 当成源码目录。
- 上述 systemd 与 logrotate 文件尚未在腾讯云安装，外部监控也未启用。腾讯云已手动生成首份 custom-format 备份，将四件套同时写入热备和 COS 目录，并在标记为 disposable 的临时库完成恢复、迁移检查和脱敏摘要比对；该证据证明备份恢复链可用，但不等于定时任务和持续巡检已经安装。

### 2.9 本地生产部署与 digest 回滚

- 第六阶段任务 5 已新增生产部署、回滚、显式空库 bootstrap 和线上 smoke 入口。发布环境组装器验证清单后只替换 API、Web、Worker、scheduler 四个 digest，保留 600 权限环境文件中的 secrets 与 PostgreSQL/Redis 基础镜像；部署成功后原子更新 `current`/`previous`，失败时停止本轮容器并恢复上一环境。
- 本地生产验收使用临时 registry 和绝对 bind 数据目录，真实推送并读取四个应用加 PostgreSQL/Redis 的 registry digest。服务器侧路径只执行 pull、迁移、bootstrap、up、health 和 smoke，没有源码 bind mount、Compose build 或后端服务宿主端口。
- 空库完成 15 个迁移和显式 bootstrap 后，四角色登录、本人 scope、策略、异步作业/SSE、草稿验证/发布、教师/学生发布读取和审计均通过。API、Redis、Publisher、Worker、scheduler 故障恢复后的作业均保持单一运行和有序事件链。
- 在线测试库完成备份、可丢弃库恢复、迁移检查和脱敏摘要比较；随后第二组本地 digest 部署成功，再回滚到第一组 digest 并重跑 smoke。测试结束后隔离容器、网络、registry、bind 数据和发布状态均删除，既有容器 ID 集合未变化。
- 故障 smoke 期间采集 47 组容器资源快照，本地八服务总 CPU 峰值为 `114.18%`，总内存峰值为 `399059714` bytes，最长单项恢复为 `64278 ms`。该结果只用于本地回归和阈值参考，不代表腾讯云 4 核 4 GB、真实网络或 150 场基准结论。

### 2.10 腾讯云备案期内部部署验证

- 用户确认可在备案审核期间继续服务器内部搭建和调试，边界为不恢复正式域名解析、不修改 nginx、证书、防火墙或其他站点，不安装源码、不公开 API/Web，并在验证后停止 ExamForge 栈。服务器端 Codex 和生产凭据未用于扩大该边界。
- 目标主机为 Ubuntu 22.04、4 核与 3719 MiB 内存，Docker 29.4.0、Compose 5.1.2 可用；`/srv/data/hot` 可用约 19 GB，`/srv/data/cos` 挂载正常。部署前候选端口空闲，现有 nginx 配置哈希、交易系统容器 ID 和 failed systemd unit 数已保存。
- 正式 artifact `examforge-release-f7697252a931b3da871272355fec3ebcab0e3842` 经附件校验后，以不含 `.git`、`apps/` 或 `packages/` 的最小部署包落盘。应用目录为 700，环境文件为 600；PostgreSQL、Redis、热备和 COS 备份使用 ExamForge 独立目录。服务器按 manifest 拉取四个 TCR 应用 digest，并固定 PostgreSQL 与 Redis 的 Docker Hub digest，不访问 GitHub、不构建源码。
- 从空库完成 15 个迁移和显式 bootstrap，七个常驻服务及 API/Publisher/Worker/scheduler readiness 通过。容器均为非 root、只读根文件系统、`cap_drop=ALL`、`no-new-privileges`，无 OOM 或重启；API/Web 仅监听 `127.0.0.1:4000/3000`，其他后端服务无宿主端口。四个应用 OCI revision 均为 `f7697252a931b3da871272355fec3ebcab0e3842`。
- 故障演练前后两次无故障 online smoke 均完成四角色登录、本人 scope、约束配置、异步作业/SSE、草稿验证/发布、教师/学生发布读取和审计。API、Redis、Publisher 和 Worker 故障恢复，Worker 崩溃作业由第 2 个 attempt 回收且仅生成 1 个运行；Scheduler 重启场景因约 3.35 秒内耗尽 3 次 `scheduler_unavailable` 尝试而失败，已登记为 P1 的 CR-028。
- 正式库生成 custom-format 备份并同步到热备与 COS 目录；带数据库级 disposable 标记的临时库完成校验和、恢复、迁移检查和脱敏摘要比对后删除。固定 seed `20260711` 的 50/100/150 场 HTTP 基准均为 feasible、0 冲突，solver/HTTP 耗时分别为 432/545 ms、894/906 ms、1223/1237 ms。Scheduler 采样峰值约 109.4% CPU、136 MiB，主机最低可用内存约 2.11 GiB，swap 为 0，无 OOM 或容器重启。
- 验证结束后 Compose project `examforge` 全部停止，候选端口无监听；数据、镜像、发布状态、备份和脱敏证据保留。`examforge.site` 与 `www.examforge.site` 仍无解析，nginx 配置测试和哈希、原交易系统容器及既有 failed unit 数与基线一致。第一版只有一个正式 release，故未伪造上一 digest 回滚。
- 当前仍不可公开上线：备案、正式域名 HTTPS/E2E、nginx site、Certbot、systemd/logrotate 安装、有限开放观察和跨版本回滚未完成；CR-028 已完成本地修复，但还需生成新正式制品并重新执行 Scheduler 恢复和回滚验收。

### 2.11 本地托管 Runner 发布决策

- 本地开发仓库只负责修改、测试、提交和推送；正式 Runner 不读取开发工作区，而是在独立 `_work` 目录检出 GitHub 上的目标完整 SHA。
- GitHub 继续保存源码、运行质量门禁并保存发布报告；大镜像不再由 GitHub 托管 Runner 跨境推送。
- 广州 TCR 继续作为正式制品单一来源，保存提交 SHA tag 与 registry digest；北京服务器只使用 release manifest 中的 digest 拉取和回滚。
- 本地 Runner 仅在人工发布时启动。Runner 离线时 job 保持排队，不回退到 GitHub 托管 Runner；发布 job 不执行 SSH、SCP、nginx、Certbot 或远程 Compose。
- API/Worker 镜像瘦身和 workflow 拆分已经完成本地实现与验证；正式 Runner 固定使用 `/home/liangjiaqi/actions-runner`、`_work`、名称 `examforge-release-wsl-x64` 和自定义标签 `examforge-release`。
- 用户已于 2026-07-15 确认安装和注册 Runner。Linux x64 Runner `2.335.1` 已按官方 SHA-256 校验后安装到独立目录，仓库级注册成功；名称、`_work` 和自定义标签符合设计，未安装系统服务。工作流 `29357107371` 已证明四标签调度、独立 `_work` 检出、代理隔离、完整供应链门禁和广州 TCR 推送路径有效；发布结束后凭据、临时报告和专用 builder 已清理，前台 Runner 正常退出并恢复离线。

## 3. 最新验证事实

- 快速与静态门禁：`npm run test:ci` 为 `9 passed`；发布专项当前为 `18 passed`，覆盖专用 Buildx 代理隔离、逐镜像构建/推送边界和远程 digest 校验，部署类 Node.js 合同总计 `37 passed`；`npm run check:scheduler-openapi`、`npm run build`、`docker compose config --quiet` 的既有基线通过，CR-028 本地修复后 `npm run check:ci`、仓库级 `npm run typecheck`、Bash 语法和 `git diff --check` 重新通过。
- 应用测试：shared `21 passed`，scheduling application `11 passed`，API `97 passed`，Web `24 passed`；CR-028 修复后隔离 PostgreSQL/Redis Worker 为 `18 passed`，新增连续 3 次不可用后第 4 次成功的恢复场景；scheduler `97 passed`，保留 1 条 Starlette/httpx 2 上游弃用警告。
- 数据库门禁：15 个迁移从空库首次全部应用，第二次应用数为 0；迁移测试 `9 passed`，迁移检查无缺失表、约束、回填或策略不一致，正式迁移入口返回 `applied: []`；PostgreSQL 集成测试 `21 passed`。
- 浏览器门禁：任务 2 独立 Compose 从空卷重新运行六类故障 smoke 和完整 Playwright，结果为 `32 passed, 3 skipped`，共 35 项；3 项只在主 Chromium 运行的状态专项在其他视觉视口按配置跳过。四角色路由、本人作用域、草稿 pointer/keyboard 操作、运营页面、Axe 扫描、截图和溢出检查均通过。
- 供应链门禁：npm 12.0.1 干净 `npm ci` 成功；`npm ls next postcss` 有效并解析为 `next@15.5.20 -> postcss@8.5.19 overridden`；生产依赖 moderate 审计为 0，安装脚本审批完整。正式运行 `29357107371` 中 API 417 MB、Worker 414 MB、Web 449 MB、scheduler 448 MB 均完成非 root、OCI、体积和职责探针，四份 SPDX SBOM 与固定 Trivy 0.72.0 的 HIGH/CRITICAL 门禁通过，并取得四个 TCR 正式 digest 和完整 release manifest。
- 备份恢复门禁：可丢弃 PostgreSQL 完成 15 个迁移、演示 seed、custom archive、SHA/摘要、保留期、模拟异机复制失败、未标记目标拒绝、标记目标恢复、迁移检查和 scope 读取；测试结束后已删除独立容器、网络、卷与临时备份。过期备份、磁盘阈值、证书窗口和 API readiness 四类故障注入均返回非 0 且未输出测试 secret。
- 本地生产门禁：临时 registry 生成两组应用 digest 和 PostgreSQL/Redis digest；第一组从空目录部署并完成全业务/故障 smoke、在线备份恢复，第二组部署后再按 `previous` 回滚第一组，两次切换后均重跑 smoke。最终清理前后的既有容器 ID 集合一致；该证据不包含 TCR、正式 HTTPS、腾讯云资源峰值或公网网络质量。
- 正式发布尝试：提交 `f741fc0` 和 `6c94599` 已推送到 `origin/main`。工作流 `29330180914` 与 `29334386863` 均通过推送前全部门禁；前者因 60 分钟上限取消，后者在超过 60 分钟且无法取得实时进度证据后由用户人工取消。服务器未参与构建或推送，未发生远程写入。
- B 方案首次运行：提交 `5f8eee8` 已推送到 `origin/main`，工作流 `29354931745` 的质量 job 成功并调度到本地 Runner；发布在首个 API 构建拉取基础镜像时因 BuildKit 代理缺失失败，未进入 SBOM、Trivy、TCR 登录、推送或 manifest。代理隔离修复已在本地专用 `docker-container` builder 上完成真实冷拉取、API 构建和职责探针；该本地镜像不是正式制品。
- B 方案正式发布：提交 `f769725` 的工作流 `29357107371` 于 2026-07-15 02:28（北京时间）以 `success` 完成；四次 TCR 推送均在首次尝试成功，发布阶段约 62 秒，正式 artifact ID 为 `8320804747`。本轮未连接或修改北京服务器。
- CR-028 新制品尝试：提交 `ce58a6a` 的工作流 `29482599323` 中 GitHub 托管质量 job 成功，本地 Runner 在首个 API 构建中完成基础镜像与 Debian 安全包下载后，停在 `npm install npm@12.0.1`；从 08:32 至 08:49（UTC）没有新增字节、日志或子阶段证据，故主动取消。SBOM、Trivy、TCR 登录、推送和 manifest 均未执行，清理步骤成功且 Runner 已退出。最小复现确认专用 BuildKit 已注入代理但外部鉴权仍可能直连超时；本地随后新增逐镜像构建 30 分钟上限、最多 1 次重试、状态/日志 artifact 和显式 build arg 代理传递，部署合同为 `37 passed`。
- 腾讯云备案期内部验证：服务器按正式 release manifest 拉取六个固定 digest，完成迁移、两次无故障业务 smoke、备份恢复和 50/100/150 场容量基准；API、Redis、Publisher、Worker 故障恢复通过，Scheduler 冷恢复因自动重试窗口不足失败并形成 CR-028。验证后 ExamForge 栈停止，域名仍无解析，nginx、证书、其他容器和主机级服务未修改。

## 4. 当前边界

- 不可变镜像发布工作流已通过完整正式运行，广州 TCR 已具备提交 `f769725` 的四镜像 digest 和可验证 release artifact；服务器内部部署也按这些 digest 完成，本地 image ID 或部分 tag 不作为发布结论。生产 secrets 已在服务器以 600 文件建立，但 nginx/HTTPS、定时运维单元和外部监控仍未安装。
- 腾讯云 4 核、3719 MiB 主机已完成内部迁移、业务 smoke、备份恢复、150 场基准和资源采样；该证据不包含正式域名、HTTPS、公网网络或有限开放观察。内部栈当前停止，域名继续无解析，不得恢复流量或把内部验证写成备案完成后的公开上线。
- CR-028 的本地实现已把默认窗口扩展为约 31 秒并通过真实依赖回归，但当前正式 digest `f769725` 仍只有旧的 3 次尝试。新正式 digest 完成腾讯云 Scheduler 冷恢复前，CR-028 继续作为 P1 阻塞，不得完成第五版归档或宣称全部故障恢复验收通过；新 release 同时承担首次真实跨版本回滚基线。
- PostCSS override 是上游稳定 Next 仍精确依赖旧版本期间的临时处置；Next 依赖声明变化时必须重新审计并优先移除覆盖。CR-003 在本地 Docker 代理变化时重新评估，远程发布使用 TCR，不把本地代理带到服务器。
- 第五版仍不包含多租户、SSO、多策略批量实验、Pareto 推荐、联合全局优化或 Kubernetes 高可用。
- 运行中取消仍是协作式尽力语义，不承诺强制终止已进入 OR-Tools 的线程，也不保留被强杀求解的中间最优解。

## 5. 下一步

1. CR-028 代码修复、逐镜像构建边界和 systemd 稳定路径合同已在本地通过；用户已于 2026-07-17 确认继续，下一步提交并推送修复后重新发布新制品。
2. 新正式 release 就绪后，在备案期内部维护窗口部署新 digest，验证 Scheduler 冷恢复，以 `f769725` 完成真实跨版本回滚，再恢复新 release；同时执行备份恢复、内部巡检和资源观察，完成后停止 ExamForge 栈。
3. 备案通过前继续保持域名无解析，不修改 nginx、证书、防火墙或其他服务；正式域名 HTTPS、核心 Playwright、证书续期和有限开放观察保留到备案通过后。
