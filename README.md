# ExamForge

ExamForge 是一个面向高校考务场景的企业级排考运营平台。当前仓库已经包含：

- Python CP-SAT 排考核心：预检、room-slot 求解、教师分配、增量重排、评分和冲突解释。
- Fastify API：基础数据、排考运行、草稿治理、发布查询、审计、通知预览和导出。
- Next.js 多角色工作台：真实会话与角色路由、任务/SSE、策略治理、运行与审计深链、可访问草稿拖拽，以及教师/学生本人日程。
- Drizzle/PostgreSQL 数据层：schema、迁移、seed、关联表和持久化仓储。
- Docker Compose 演示栈：PostgreSQL、Redis、迁移、seed、FastAPI scheduler、Publisher、Worker、API 和 Web 一键编排。

## 环境要求

本地开发需要 Node.js 22.22.2、npm 12.0.1、Python 3.12 和 [uv](https://docs.astral.sh/uv/)。根 `package.json` 已固定包管理器版本；Node.js 24 用户需使用 24.15.0 或更高版本。完整演示只要求 Docker Engine 与 Docker Compose；浏览器测试还需要本机已安装 Playwright Chromium。

## 本地开发

安装 Node.js 依赖：

```bash
npm ci
```

启动 API 和 Web：

```bash
EXAMFORGE_ADMIN_PASSWORD='自行设置' \
EXAMFORGE_OPERATOR_PASSWORD='自行设置' \
EXAMFORGE_TEACHER_PASSWORD='自行设置' \
EXAMFORGE_STUDENT_PASSWORD='自行设置' \
npm run dev
```

未配置 `DATABASE_URL` 时，API 使用内存演示仓储；本地开发模式不会静默连接 Compose 数据库。默认地址如下：

- Web：`http://localhost:3000`
- API：`http://localhost:4000`
- 存活检查：`http://localhost:4000/health`
- 就绪检查：`http://localhost:4000/ready`

本地 `npm run dev` 默认显式使用 Python CLI transport，适合调试且不需要另起服务。需要验证进程间 HTTP 边界时，先启动 scheduler，再让 API 使用 HTTP：

```bash
cd apps/scheduler
uv run --frozen --python 3.12 --extra dev \
  uvicorn examforge_scheduler.http_api:app --host 127.0.0.1 --port 8000

# 在另一个终端启动 API/Web
SCHEDULER_TRANSPORT=http \
SCHEDULER_BASE_URL=http://127.0.0.1:8000 \
npm run dev
```

scheduler 提供 `GET /health`、`GET /ready` 和 `POST /solve`，确定性 OpenAPI 产物位于 `apps/scheduler/openapi.json`。调试用 CLI 和 HTTP 共用同一输入解析、求解、报告与序列化 pipeline。

常用验证命令：

```bash
npm run test:ci
npm run check:install-scripts
npm audit --audit-level=moderate
npm run check:ci
npm run test:scheduler
npm run check:scheduler-openapi
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`test:ci` 使用临时 Git 仓库验证治理脚本和依赖供应链策略；`check:install-scripts` 拒绝当前 lockfile 中未获精确版本批准的安装脚本，moderate 审计必须为 0。`check:ci` 检查禁止跟踪的产物、中文 Conventional Commits 格式和提交区间空白错误。GitHub Actions 会为 `push` 或 PR 显式传入提交区间，本地直接运行时默认检查最近一次提交及当前工作树。

`npm run test:e2e` 会自行启动内存 API 和 Web，默认拒绝复用 3000 端口上的未知服务。仅在明确需要时设置 `E2E_REUSE_EXISTING_SERVERS=1`。

## CI 质量门禁

`.github/workflows/ci.yml` 按成本分为三类作业：

- 快速门禁：所有 `push`、PR 和手动触发均使用固定 Node/npm 工具链，运行安装脚本审批、moderate 依赖审计、仓库治理、生产/发布/运维合同、OpenAPI 漂移、类型检查、API/Web 单元测试、scheduler 测试和生产构建。
- PostgreSQL 与迁移门禁：仅在 `main` 的 `push` 和手动触发时运行，覆盖 PostgreSQL 16、Redis 7、空库迁移、迁移幂等、schema 检查、真实仓储、Publisher/Worker 集成测试和可丢弃库备份恢复。
- Compose 与 Playwright 门禁：仅在 `main` 的 `push` 和手动触发时运行，从空卷完成迁移、seed、可靠作业 smoke、故障演练和浏览器主链。

完整门禁会在快速门禁通过后并行执行。同一分支的新运行会取消旧运行；工作流只授予 `contents: read` 权限。E2E 失败时上传 Compose 日志、Playwright trace 和测试结果，保留 7 天。

本地复现 PostgreSQL 门禁：

```bash
TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:migrations
TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run db:check-migrations
DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run db:migrate
TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:postgres
TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test \
TEST_REDIS_URL=redis://localhost:6379/0 \
  npm run test --workspace @examforge/worker
```

本地复现完整演示门禁：

```bash
npm run test:e2e:demo
```

GitHub Actions 的手动运行入口位于仓库 Actions 页的 `CI` 工作流。工作流只使用演示测试凭据，不需要生产 secrets，也不会发布镜像或自动部署。

## 完整 Compose 演示

启动完整演示栈：

```bash
cp .env.example .env
# 编辑 .env，填写四个 EXAMFORGE_*_PASSWORD
npm run demo:up
```

该命令启动 PostgreSQL、Redis、scheduler、Publisher、Worker、API 和 Web。迁移与 seed 完成后，Publisher 从 PostgreSQL outbox 向 BullMQ 投递，独立 Worker 通过内部 HTTP 调用 scheduler。Publisher 与 Worker 共用非 root Node.js 镜像，但作为两个进程独立部署；API 镜像不包含 Python、uv 或算法源码。

默认地址与本地开发模式一致：

- Web：`http://localhost:3000`
- API：`http://localhost:4000`
- Scheduler：`http://localhost:8000`
- PostgreSQL：`localhost:5432`
- Redis：`localhost:6379`
- Publisher 健康检查：`http://localhost:4010/health`、`http://localhost:4010/ready`
- Worker 健康检查：`http://localhost:4011/health`、`http://localhost:4011/ready`
- API 存活检查：`http://localhost:4000/health`
- API 就绪检查：`http://localhost:4000/ready`，成功时返回 `storage: "postgres"` 且 scheduler 已就绪
- Scheduler 存活/就绪检查：`http://localhost:8000/health`、`http://localhost:8000/ready`

停止服务并保留演示数据：

```bash
npm run demo:down
```

删除演示数据卷并从空库重新执行迁移、seed 和启动流程：

```bash
npm run demo:reset
```

`demo:reset` 只操作当前 `COMPOSE_PROJECT_NAME` 对应的 PostgreSQL 与 Redis 演示卷。默认卷名分别为 `examforge-demo-postgres-data` 和 `examforge-demo-redis-data`。

### 演示验收

演示栈启动后可运行：

```bash
npm run demo:smoke
```

烟测先验证各进程健康和 scheduler 直连求解，再使用 `.env` 中的排考员密码建立真实服务端会话。默认执行以下可靠性场景：

- Publisher 暂停投递后提交作业，重启 API，再通过 SSE 与 `Last-Event-ID` 补发取得终态。
- 短暂停止 Redis、重启 Publisher、运行中强制终止 Worker，以及停止 scheduler 后恢复。
- 重复发布同一 outbox 事件，确认不会新增 attempt、业务事件或运行记录。

每个场景输出脱敏的容器时间线、作业 ID、attempt 状态与错误码、事件序列和最终运行数量。仅需基础连通性检查时，可设置 `DEMO_RUN_FAULT_DRILLS=0` 跳过主动故障演练。

完整浏览器验收入口：

```bash
npm run test:e2e:demo
```

该命令建立隔离的全新演示卷，依次运行 smoke 和全部 Playwright 场景，成功或失败后均清理容器、网络和演示卷。排查失败现场时可设置 `KEEP_DEMO_STACK=1` 保留环境。

## 生产配置预检

生产部署使用独立的 `compose.production.yml`，不继承演示栈的本地 build、seed、宿主数据库/Redis/scheduler/Worker 端口或演示模式。六类镜像都必须以 `@sha256:` digest 固定；只有 Web/API 绑定 `127.0.0.1`，供宿主 nginx 反向代理。

在服务器上准备环境文件后先执行只读预检：

```bash
cp .env.production.example .env.production
# 替换全部占位符和镜像 digest，不要把真实文件提交到 Git
chmod 600 .env.production
./scripts/deploy/preflight.sh --env-file .env.production --read-only
```

预检会检查环境文件 owner/权限、强密码、精确 HTTPS Origin、Secure Cookie、绝对数据与备份目录、目录 UID/GID、磁盘、内存、端口和镜像可访问性。生产 API 也会在监听端口前执行同一类必需配置检查。正式发布工作流尚未运行、TCR 尚无本轮 digest 时，示例文件中的占位符会被预检拒绝，不应直接执行生产 Compose `up`。

演示 Compose 显式使用 `EXAMFORGE_DEPLOYMENT_MODE=demo`；生产 Compose 固定使用 `production`。两个模式的边界用于保留本地演示能力，同时禁止正式环境沿用演示默认值。

## 发布不可变镜像

`.github/workflows/release-images.yml` 是生产镜像的唯一发布入口。它只能从 `main` 手动运行，并要求勾选发布确认；仓库需要预先配置 `TCR_REGISTRY`、`TCR_NAMESPACE`、`TCR_USERNAME` 三个 GitHub Variables 和 `TCR_PASSWORD` Secret。变量与 Secret 只在 GitHub Actions 中注入，不写入仓库文件或发布清单。

工作流依次执行仓库质量门禁，构建并探测 API、Web、Worker 和 scheduler 四个 linux/amd64 镜像，生成 SPDX SBOM 和漏洞报告，并要求所有镜像的 HIGH/CRITICAL 漏洞为 0。全部门禁通过后才登录 TCR、推送提交 SHA tag，并读取 registry 返回的 digest；任一镜像失败都不会进入推送阶段。

成功运行后，`examforge-release-<commit-sha>` artifact 保存 `release-manifest.json`、生产依赖审计、四份 SBOM 和四份扫描报告，保留 90 天。下载并位于产物根目录时可重新校验：

```bash
node scripts/release/verify-release.mjs release-manifest.json --verify-files
```

生产部署只能读取清单里的 TCR `sha256` digest，不接受 `latest`、普通 tag 或本地 image ID。`NEXT_PUBLIC_API_BASE_URL` 会在 Web 构建时写入浏览器代码，因此正式域名或 API origin 改变后必须重新发布 Web 镜像并使用新的 digest。提交 `f769725` 已通过该入口生成首个完整正式 release；后续提交仍必须重新通过四镜像构建、职责探针、SBOM、Trivy、逐镜像推送和 manifest 校验，不能沿用旧 digest 冒充新版本。

## 备份、恢复与健康巡检

生产 PostgreSQL 备份使用 Compose 容器内的 `pg_dump`，宿主机不需要安装 PostgreSQL 客户端：

```bash
./scripts/deploy/backup-postgres.sh \
  --env-file .env.production \
  --compose-file compose.production.yml
```

每个备份集合包含 custom-format 转储、SHA-256、迁移版本、脱敏业务计数和 `.meta` 完成标记。本地与 `EXAMFORGE_OFFSITE_BACKUP_DIR` 都在附件完整后才发布 `.meta`；异机复制失败会返回非 0 并清理本轮半成品，不会删除上一份有效备份。保留期由 `EXAMFORGE_BACKUP_RETENTION_DAYS` 控制，默认 14 天。

恢复是破坏性操作，只允许写入独立的可丢弃数据库。目标库必须以 `_disposable` 结尾，并预先写入数据库级标记：

```bash
docker compose --env-file .env.production -f compose.production.yml \
  exec postgres sh -c 'createdb -U "$POSTGRES_USER" examforge_restore_disposable'
docker compose --env-file .env.production -f compose.production.yml \
  exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres' <<'SQL'
COMMENT ON DATABASE examforge_restore_disposable IS 'examforge.disposable=true';
SQL

./scripts/deploy/restore-postgres.sh \
  --env-file .env.production \
  --compose-file compose.production.yml \
  --backup /srv/data/hot/examforge/backups/postgres/<backup-id>.meta \
  --target-database examforge_restore_disposable \
  --confirm-disposable
```

恢复脚本会重新校验附件，运行迁移检查，并比较关键表、本人 scope、发布版本、作业事件序列和审计计数的脱敏摘要。它拒绝在线源库名称、未确认目标或缺少数据库端标记的目标。

只读巡检入口如下：

```bash
./scripts/deploy/health-check.sh \
  --env-file .env.production \
  --compose-file compose.production.yml
```

巡检覆盖证书期限、数据盘、容器 health、API/Publisher/Worker/scheduler readiness，以及本地和异机备份完整性与年龄。`deploy/systemd/` 提供每 5 分钟健康检查和每日备份模板，固定从 `/srv/apps/examforge` 的稳定运维目录读取脚本、Compose 和环境文件；`releases/current` 只保存不可变 release manifest 与供应链附件，不能作为源码或运维脚本目录。`deploy/logrotate/examforge-nginx` 约束独立 nginx 日志；这些文件需要在正式部署时由运维用户安装，目前尚未在腾讯云启用。

## 按 digest 部署与回滚

部署入口接收完整发布 bundle 中的 `release-manifest.json`，校验审计、SBOM、扫描附件和四个镜像 digest 后再修改生产环境。首次空库需要显式增加 `--bootstrap-demo`；已有业务数据时禁止使用该参数：

```bash
./scripts/deploy/deploy.sh \
  --env-file .env.production \
  --compose-file compose.production.yml \
  --release-manifest /srv/apps/examforge/incoming/release-manifest.json \
  --state-dir /srv/apps/examforge/releases \
  --bootstrap-demo
```

部署只执行 pull、迁移、可选 bootstrap、Compose up 和 runtime 健康检查，不在服务器构建源码。成功后，四个应用 image 以 digest 写回 600 权限环境文件，发布 bundle 保存到 `releases/commits/<commit>`，`current` 和 `previous` 软链接原子切换。失败会停止本轮容器，并尝试恢复上一环境和服务。

生产栈启动后可运行四角色、本人 scope、作业/SSE、策略、草稿发布和审计 smoke；主动故障演练只应在维护窗口执行：

```bash
ONLINE_API_BASE_URL=http://127.0.0.1:4000 \
ONLINE_WEB_BASE_URL=http://127.0.0.1:3000 \
ONLINE_COMPOSE_FILE=compose.production.yml \
ONLINE_COMPOSE_ENV_FILE=.env.production \
ONLINE_RUN_FAULT_DRILLS=0 \
node --env-file=.env.production scripts/deploy/online-smoke.mjs
```

回滚只读取 `previous/release-manifest.json`，重新走相同的清单验证、拉取、迁移和健康门禁：

```bash
./scripts/deploy/rollback.sh \
  --env-file .env.production \
  --compose-file compose.production.yml \
  --state-dir /srv/apps/examforge/releases
```

本地可用 `npm run test:production-local` 复现临时 registry、两版 digest、故障、备份恢复和回滚全链；它会清理自己的容器、网络、registry 和 bind 数据。该测试使用本地合成发布 bundle，不代表 TCR 或腾讯云已部署。

## 环境配置

根目录 `.env.example` 列出可覆盖变量。Docker Compose 会自动读取根目录 `.env`；直接运行 `npm run dev` 时，需要由 shell 或进程管理器注入对应变量。

- 宿主机访问 PostgreSQL 使用 `localhost:${POSTGRES_PORT}`，容器内 API 固定通过 `postgres:5432` 访问数据库。
- 浏览器访问 API 使用 `NEXT_PUBLIC_API_BASE_URL`，该值会在 Web 镜像构建时写入客户端代码。
- `POSTGRES_PORT`、`REDIS_PORT`、`SCHEDULER_PORT`、`API_PORT`、`WEB_PORT`、`PUBLISHER_HEALTH_PORT` 和 `WORKER_HEALTH_PORT` 只覆盖宿主机映射端口，不改变容器内端口。
- Redis 使用 AOF 持久化卷和 `noeviction` 策略；作业状态、结果与事件历史仍以 PostgreSQL 为准。
- `WORKER_LOCK_DURATION_MS` 与 `WORKER_STALLED_INTERVAL_MS` 控制 BullMQ 崩溃领取恢复。默认均为 30 秒，隔离故障演练缩短为 5 秒。
- `SCHEDULER_TRANSPORT` 可显式选择 `cli` 或 `http`；Compose 固定使用 `http://scheduler:8000`，不会在 HTTP 故障时静默回退 CLI。
- `SCHEDULER_HTTP_TIMEOUT_MS` 限制 API 到 scheduler 的 HTTP 等待时间；调用方取消只中止网络等待，不宣称能够强制终止已经进入 OR-Tools 的线程。
- Compose 与生产代码不提供账户默认密码；只有显式配置的 `EXAMFORGE_*_PASSWORD` 才会初始化对应本地账户。不要把真实密码、会话 token 或外部数据库凭据写入 `.env.example`、Compose 文件或 Git。

如需手工验证 PostgreSQL 数据层，应使用名称包含 `test` 的隔离数据库，并通过 `TEST_DATABASE_URL` 运行集成测试；测试会重建目标数据库的 `public` schema。

## 认证

API 使用数据库账户、角色和可撤销服务端会话。密码通过 scrypt 随机盐散列保存，浏览器只持有 `HttpOnly`、`SameSite=Lax` Cookie；生产环境默认启用 `Secure`。登录、退出、过期、撤销、停用账户和受信任 `Origin` 均由服务端验证。

可通过环境变量显式初始化四类本地账户，不配置就不会创建：

- `EXAMFORGE_ADMIN_PASSWORD`：`admin` 管理员。
- `EXAMFORGE_OPERATOR_PASSWORD`：`operator` 排考员。
- `EXAMFORGE_TEACHER_PASSWORD`：`teacher` 教师。
- `EXAMFORGE_STUDENT_PASSWORD`：`student` 学生。

登录接口为 `POST /api/auth/login`，会话恢复与退出分别为 `GET /api/auth/me` 和 `POST /api/auth/logout`。管理员和排考员进入运营工作台；教师和学生进入只读已发布查询门户。前端不提供角色切换，也不接受公开 Bearer token。

## 核心演示链路

1. 打开 `http://localhost:3000`。
2. 查看考试批次、基础数据和资源指标。
3. 创建同步或异步排考运行，查看结果、评分和资源利用率。
4. 从运行创建草稿，在矩阵中应用建议、拖拽、锁定或局部再平衡。
5. 锁定关键考试后生成增量重排版本，核对冻结、保留和变化摘要。
6. 校验并发布草稿，查看教师/学生安排和通知预览。
