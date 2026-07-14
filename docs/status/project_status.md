# ExamForge 项目状态

## 1. 当前结论

- 第五版第五阶段已于 2026-07-14 完成并归档，当前唯一活动计划为 `docs/plan/第五版第六阶段计划.md`。
- Web 已从根路由组合原型拆分为登录、管理员、排考、运行、草稿、审计、教师本人和学生本人页面；筛选、分页、对比和选中对象进入 URL，可直接访问、刷新和前进后退。
- 教师与学生作用域由 PostgreSQL 关联和服务端会话决定。本人页面只调用 `/api/me/*`，不能通过路径、查询参数或请求体切换到其他教师或学生群体。
- 作业、SSE、策略快照、发布资格和审计继续复用第三、第四阶段的服务端合同；页面拆分没有复制任务状态机或把 PostgreSQL 事实迁入浏览器。
- CR-002 已在第六阶段任务 1 关闭；代码审查当前只保留 P3 的 CR-003，无待解决 P0/P1。详细问题只维护在 `docs/status/code_review_status.md`。
- 第五版第一至第五阶段均已提交到本地 `main`，其中第三至第五阶段汇总于 `11b0336`；当前第六阶段改动尚未提交、未推送。经用户明确授权，服务器存储已迁到多项目共享挂载点，但尚未部署 ExamForge 应用、修改 nginx 或切换域名流量。

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
- `scripts/deploy/preflight.sh` 以只读方式校验 600 环境文件、owner、必填变量、镜像 digest、目录边界与 UID/GID、磁盘、内存、端口和镜像可访问性。任务 3 生成真实应用镜像 digest 前，生产模板只可用于配置检查，不能直接启动正式栈。

### 2.7 不可变镜像发布与供应链清单

- 第六阶段任务 3 已新增手动 `release-images.yml`。工作流只允许从 `main` 且明确确认后运行，先完成仓库质量门禁，再构建并探测 API、Web、Worker 和 scheduler 四个 linux/amd64 镜像；四组 SBOM 与漏洞门禁全部通过后才登录 TCR 和推送提交 SHA tag，不存在按矩阵提前推送部分镜像的窗口。
- 四个运行时镜像均带有 OCI source、revision 和 created 标签，并保持非 root 与职责隔离。Web 显式固化正式 API origin；API 探针拒绝 Python/uv，Web 探针拒绝服务器 secret。Node 运行时镜像移除了不参与启动的全局 npm/npx，并与 scheduler 一并完成 Debian 安全更新。
- 发布清单固定提交、创建时间、构建平台、四个 TCR tag/digest、OCI 来源、生产 npm 审计、SPDX SBOM、Trivy 报告及附件 SHA-256。验证器拒绝 `latest`、本地 image ID、提交或 tag 不一致、附件缺失或篡改、HIGH/CRITICAL 非零、越界附件路径和疑似 secret 字段。
- 工作流 artifact 保存发布清单及全部审计、SBOM、扫描附件 90 天。当前只完成未接触 TCR 的本地真实构建与清单演练；正式 registry digest 仍须在提交代码后手动运行工作流取得，生产部署不得使用本地 image ID 代替。

### 2.8 备份恢复与运维巡检

- 第六阶段任务 4 已新增 PostgreSQL custom-format 备份和恢复脚本。备份集合固定包含转储、SHA-256、迁移版本、脱敏摘要与 `.meta` 完成标记；本地和 COS 挂载目录均在附件到齐后才发布完成标记，外部复制失败不会删除上一份有效备份，也不会提前执行保留期清理。
- 恢复入口拒绝源库，只允许同时满足命令行确认、`_disposable` 名称和数据库级 `examforge.disposable=true` 标记的目标。恢复后使用生产 migrate 服务运行迁移检查，并比较关键表、本人 scope、发布版本、作业/attempt/事件序列和审计计数的脱敏摘要。
- 新增每 5 分钟健康巡检和每日备份的 systemd 模板，以及独立 nginx access/error logrotate。健康检查以稳定类别报告证书、数据盘、容器状态、API/Publisher/Worker/scheduler readiness、本地/异机备份完整性和年龄，不输出环境文件值。
- 上述 systemd 与 logrotate 文件尚未在腾讯云安装；目前只有隔离 PostgreSQL 与本地文件系统证据，不能据此宣称正式备份、COS 恢复或外部监控已经启用。

### 2.9 本地生产部署与 digest 回滚

- 第六阶段任务 5 已新增生产部署、回滚、显式空库 bootstrap 和线上 smoke 入口。发布环境组装器验证清单后只替换 API、Web、Worker、scheduler 四个 digest，保留 600 权限环境文件中的 secrets 与 PostgreSQL/Redis 基础镜像；部署成功后原子更新 `current`/`previous`，失败时停止本轮容器并恢复上一环境。
- 本地生产验收使用临时 registry 和绝对 bind 数据目录，真实推送并读取四个应用加 PostgreSQL/Redis 的 registry digest。服务器侧路径只执行 pull、迁移、bootstrap、up、health 和 smoke，没有源码 bind mount、Compose build 或后端服务宿主端口。
- 空库完成 15 个迁移和显式 bootstrap 后，四角色登录、本人 scope、策略、异步作业/SSE、草稿验证/发布、教师/学生发布读取和审计均通过。API、Redis、Publisher、Worker、scheduler 故障恢复后的作业均保持单一运行和有序事件链。
- 在线测试库完成备份、可丢弃库恢复、迁移检查和脱敏摘要比较；随后第二组本地 digest 部署成功，再回滚到第一组 digest 并重跑 smoke。测试结束后隔离容器、网络、registry、bind 数据和发布状态均删除，既有容器 ID 集合未变化。
- 故障 smoke 期间采集 47 组容器资源快照，本地八服务总 CPU 峰值为 `114.18%`，总内存峰值为 `399059714` bytes，最长单项恢复为 `64278 ms`。该结果只用于本地回归和阈值参考，不代表腾讯云 4 核 4 GB、真实网络或 150 场基准结论。

### 2.10 腾讯云任务 6 只读预检

- 用户已确认继续使用此前完成共享挂载迁移的同一台腾讯云服务器，并授权执行任务 6 只读预检。本轮预检未创建 ExamForge 目录、未上传文件、未修改 nginx/证书，也未启动或停止服务；TCR 登录由用户随后在独立交互式终端完成。
- 目标主机仍为 Ubuntu 22.04、4 核与 3719 MiB 内存；预检时可用内存为 2598 MiB，swap 仍为 0。系统盘可用约 20 GB，`/srv/data/hot` 可用约 19 GB，`/srv/data/cos` 挂载正常且两个共享根目录对 `ubuntu` 可读写。
- Docker 29.4.0、Compose 5.1.2、nginx 1.18.0 与 Certbot 1.21.0 可用，`nginx -t` 通过；现有站点、OpenViking、COS 挂载和交易系统容器均保持运行。候选端口 3000、3001、5432、6379、8000 和 8080 均空闲，UFW 保持启用。
- `examforge.site` 与 `www.examforge.site` 均已解析，但 ExamForge 证书尚不存在。现有 `campus2hand.site` 证书已于 2026-07-13 过期；该问题属于既有站点运维，不授权本阶段顺带修改。
- TCR registry 端点可在约 0.12 秒内到达。用户随后已由 `ubuntu` 完成交互式 `docker login`；只读复核确认 `~/.docker/config.json` 属于 `ubuntu:ubuntu`、权限为 600，且包含 TCR 登录项，未读取或输出凭据值。正式镜像尚未发布，因此 digest 拉取权限仍需在发布后验证。`/srv/apps/examforge`、`/srv/data/hot/examforge`、`/srv/data/cos/examforge`、正式发布清单和上一发布清单均尚不存在。
- 远程完整 `preflight.sh --read-only` 需要 600 权限生产环境文件、生产 Compose、正式镜像 digest、目标目录和可读取镜像的 TCR 凭据。上述前提尚未建立，因此本轮只完成主机级等价只读检查，没有使用 `--skip-image-check` 或占位 digest 冒充通过。
- 用户已将维护窗口定为备案通过后的第一个可用晚上 22:00–00:30（北京时间）。本轮任务 6 的远程写入范围为无；任务 7 候选范围只包含 ExamForge 专属应用/数据/COS 目录、独立 nginx site、ExamForge systemd/logrotate 文件和 Compose project `examforge`，实际开始仍需用户在窗口前最终确认。
- 当前结论仍为 `no-go`：TCR 登录准备和条件式维护窗口已完成，但任务 7 前仍需提交并发布第六阶段正式镜像与发布清单、验证 digest 拉取，并等待备案允许证书签发。第一版尚无上一发布清单，首次部署的回滚基线只能是部署前无 ExamForge 栈状态与已保存的 nginx 配置指纹。

## 3. 最新验证事实

- 快速与静态门禁：`npm run test:ci` 为 `9 passed`，部署类 Node.js 合同总计 `25 passed`，其中生产配置 `5`、发布 `6`、运维与故障 `8`、部署/回滚 `6`；`npm run check:ci`、`npm run typecheck`、`npm run check:scheduler-openapi`、`npm run build`、`docker compose config --quiet`、Actionlint、ShellCheck 和 `git diff --check` 通过。
- 应用测试：shared `21 passed`，scheduling application `11 passed`，API `97 passed`，Web `24 passed`；隔离 PostgreSQL/Redis Worker `14 passed`；scheduler `97 passed`，保留 1 条 Starlette/httpx 2 上游弃用警告。
- 数据库门禁：15 个迁移从空库首次全部应用，第二次应用数为 0；迁移测试 `9 passed`，迁移检查无缺失表、约束、回填或策略不一致，正式迁移入口返回 `applied: []`；PostgreSQL 集成测试 `21 passed`。
- 浏览器门禁：任务 2 独立 Compose 从空卷重新运行六类故障 smoke 和完整 Playwright，结果为 `32 passed, 3 skipped`，共 35 项；3 项只在主 Chromium 运行的状态专项在其他视觉视口按配置跳过。四角色路由、本人作用域、草稿 pointer/keyboard 操作、运营页面、Axe 扫描、截图和溢出检查均通过。
- 供应链门禁：npm 12.0.1 干净 `npm ci` 成功；`npm ls next postcss` 有效并解析为 `next@15.5.20 -> postcss@8.5.19 overridden`；生产依赖 moderate 审计为 0，安装脚本审批完整。API、Web、Worker 和 scheduler 四个本地镜像均使用固定工具链完成真实构建与职责探针，实际生成 SPDX SBOM 并以固定 Trivy 扫描，HIGH/CRITICAL 为 0；本地组合清单通过附件校验，但尚无 TCR 正式 digest。
- 备份恢复门禁：可丢弃 PostgreSQL 完成 15 个迁移、演示 seed、custom archive、SHA/摘要、保留期、模拟异机复制失败、未标记目标拒绝、标记目标恢复、迁移检查和 scope 读取；测试结束后已删除独立容器、网络、卷与临时备份。过期备份、磁盘阈值、证书窗口和 API readiness 四类故障注入均返回非 0 且未输出测试 secret。
- 本地生产门禁：临时 registry 生成两组应用 digest 和 PostgreSQL/Redis digest；第一组从空目录部署并完成全业务/故障 smoke、在线备份恢复，第二组部署后再按 `previous` 回滚第一组，两次切换后均重跑 smoke。最终清理前后的既有容器 ID 集合一致；该证据不包含 TCR、正式 HTTPS、腾讯云资源峰值或公网网络质量。

## 4. 当前边界

- 不可变镜像发布工作流已经建立但尚未实际执行，TCR 中仍无本轮正式 digest；真实生产 secrets、nginx/HTTPS、正式异机备份、已安装的外部健康巡检和腾讯云回滚演练也尚未建立。生产 Compose、运维脚本、本地线上 smoke 和回滚合同虽已落地，但尚未在腾讯云服务器启动。
- 腾讯云主机级只读预检、TCR 登录准备和条件式维护窗口已完成，但正式发布清单、digest 拉取验证、ExamForge 目录和正式证书尚未具备，任务 6 仍处于 `no-go`，不得进入任务 7 写入或切流。
- 腾讯云 4 核 4 GB 服务器上的 150 场基准、完整业务闭环、资源峰值和真实网络 E2E 尚未执行；本地 Compose 结果不能冒充远程验证。
- PostCSS override 是上游稳定 Next 仍精确依赖旧版本期间的临时处置；Next 依赖声明变化时必须重新审计并优先移除覆盖。CR-003 在本地 Docker 代理变化时重新评估，远程发布使用 TCR，不把本地代理带到服务器。
- 第五版仍不包含多租户、SSO、多策略批量实验、Pareto 推荐、联合全局优化或 Kubernetes 高可用。
- 运行中取消仍是协作式尽力语义，不承诺强制终止已进入 OR-Tools 的线程，也不保留被强杀求解的中间最优解。

## 5. 下一步

1. 经用户另行授权后提交并推送当前第六阶段改动，手动运行正式镜像发布工作流，取得四个 TCR digest、SBOM、扫描报告和发布清单，并使用现有登录记录验证只读拉取。
2. 等待备案通过；进入已约定的首个可用 22:00–00:30 窗口前，由用户最终确认开始，再创建 ExamForge 专属目录与 600 权限生产环境文件并运行完整远程 `preflight.sh --read-only`。通过前不部署、不签发证书、不修改 nginx。
3. 任务 7 之后再执行正式部署、HTTPS、首份异机备份恢复、150 场基准、线上 smoke 和镜像回滚；未取得远程证据前不得宣称第五版整体完成。
