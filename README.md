# ExamForge

ExamForge 是一个面向高校考务场景的企业级排考运营平台。当前仓库已经包含：

- Python CP-SAT 排考核心：预检、room-slot 求解、教师分配、增量重排、评分和冲突解释。
- Fastify API：基础数据、排考运行、草稿治理、发布查询、审计、通知预览和导出。
- Next.js 多角色工作台：真实会话与角色路由、任务/SSE、策略治理、运行与审计深链、可访问草稿拖拽，以及教师/学生本人日程。
- Drizzle/PostgreSQL 数据层：schema、迁移、seed、关联表和持久化仓储。
- Docker Compose 演示栈：PostgreSQL、Redis、迁移、seed、FastAPI scheduler、Publisher、Worker、API 和 Web 一键编排。

## 环境要求

本地开发需要 Node.js 22、Python 3.12 和 [uv](https://docs.astral.sh/uv/)。完整演示只要求 Docker Engine 与 Docker Compose；浏览器测试还需要本机已安装 Playwright Chromium。

## 本地开发

安装 Node.js 依赖：

```bash
npm install
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
npm run check:ci
npm run test:scheduler
npm run check:scheduler-openapi
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`test:ci` 使用临时 Git 仓库验证治理脚本；`check:ci` 检查禁止跟踪的产物、中文 Conventional Commits 格式和提交区间空白错误。GitHub Actions 会为 `push` 或 PR 显式传入提交区间，本地直接运行时默认检查最近一次提交及当前工作树。

`npm run test:e2e` 会自行启动内存 API 和 Web，默认拒绝复用 3000 端口上的未知服务。仅在明确需要时设置 `E2E_REUSE_EXISTING_SERVERS=1`。

## CI 质量门禁

`.github/workflows/ci.yml` 按成本分为三类作业：

- 快速门禁：所有 `push`、PR 和手动触发均运行仓库治理检查、OpenAPI 漂移检查、类型检查、API/Web 单元测试、scheduler 测试和生产构建。
- PostgreSQL 与迁移门禁：仅在 `main` 的 `push` 和手动触发时运行，覆盖 PostgreSQL 16、Redis 7、空库迁移、迁移幂等、schema 检查、真实仓储以及 Publisher/Worker 集成测试。
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
