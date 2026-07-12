# ExamForge

ExamForge 是一个面向高校考务场景的企业级排考运营平台。当前仓库已经包含：

- Python CP-SAT 排考核心：预检、room-slot 求解、教师分配、增量重排、评分和冲突解释。
- Fastify API：基础数据、排考运行、草稿治理、发布查询、审计、通知预览和导出。
- Next.js 运营台：运行排考、草稿矩阵、建议调整、锁定重排、结果分析和发布通知。
- Drizzle/PostgreSQL 数据层：schema、迁移、seed、关联表和持久化仓储。
- Docker Compose 演示栈：PostgreSQL、迁移、seed、API、Python 调度器和 Web 一键编排。

## 环境要求

本地开发需要 Node.js 22、Python 3.12 和 [uv](https://docs.astral.sh/uv/)。完整演示只要求 Docker Engine 与 Docker Compose；浏览器测试还需要本机已安装 Playwright Chromium。

## 本地开发

安装 Node.js 依赖：

```bash
npm install
```

启动 API 和 Web：

```bash
npm run dev
```

未配置 `DATABASE_URL` 时，API 使用内存演示仓储；本地开发模式不会静默连接 Compose 数据库。默认地址如下：

- Web：`http://localhost:3000`
- API：`http://localhost:4000`
- 存活检查：`http://localhost:4000/health`
- 就绪检查：`http://localhost:4000/ready`

常用验证命令：

```bash
npm run test:ci
npm run check:ci
npm run test:scheduler
npm run typecheck
npm test
npm run build
npm run test:e2e
```

`test:ci` 使用临时 Git 仓库验证治理脚本；`check:ci` 检查禁止跟踪的产物、中文 Conventional Commits 格式和提交区间空白错误。GitHub Actions 会为 `push` 或 PR 显式传入提交区间，本地直接运行时默认检查最近一次提交及当前工作树。

`npm run test:e2e` 会自行启动内存 API 和 Web，默认拒绝复用 3000 端口上的未知服务。仅在明确需要时设置 `E2E_REUSE_EXISTING_SERVERS=1`。

## CI 质量门禁

`.github/workflows/ci.yml` 按成本分为三类作业：

- 快速门禁：所有 `push`、PR 和手动触发均运行仓库治理检查、类型检查、API 测试、scheduler 测试和生产构建。
- PostgreSQL 与迁移门禁：仅在 `main` 的 `push` 和手动触发时运行，覆盖 PostgreSQL 16、空库迁移、迁移幂等、schema 检查和真实仓储集成测试。
- Compose 与 Playwright 门禁：仅在 `main` 的 `push` 和手动触发时运行，从空卷完成迁移、seed、smoke、API 重启持久化和浏览器主链。

完整门禁会在快速门禁通过后并行执行。同一分支的新运行会取消旧运行；工作流只授予 `contents: read` 权限。E2E 失败时上传 Compose 日志、Playwright trace 和测试结果，保留 7 天。

本地复现 PostgreSQL 门禁：

```bash
TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:migrations
TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run db:check-migrations
DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run db:migrate
TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:postgres
```

本地复现完整演示门禁：

```bash
npm run test:e2e:demo
```

GitHub Actions 的手动运行入口位于仓库 Actions 页的 `CI` 工作流。工作流只使用演示测试凭据，不需要生产 secrets，也不会发布镜像或自动部署。

## 完整 Compose 演示

启动完整演示栈：

```bash
npm run demo:up
```

该命令按 PostgreSQL 健康检查、迁移、seed、API 就绪检查、Web 健康检查的顺序启动服务。API 镜像内置 Node.js、Python 3.12、uv 和已同步的调度器环境，不依赖宿主机 Python。

默认地址与本地开发模式一致：

- Web：`http://localhost:3000`
- API：`http://localhost:4000`
- PostgreSQL：`localhost:5432`
- API 存活检查：`http://localhost:4000/health`
- API 就绪检查：`http://localhost:4000/ready`，成功时返回 `storage: "postgres"`

停止服务并保留演示数据：

```bash
npm run demo:down
```

删除演示数据卷并从空库重新执行迁移、seed 和启动流程：

```bash
npm run demo:reset
```

`demo:reset` 只操作当前 `COMPOSE_PROJECT_NAME` 对应的演示卷。默认卷名为 `examforge-demo-postgres-data`。

### 演示验收

演示栈启动后可运行：

```bash
npm run demo:smoke
```

烟测会验证 Web/API、PostgreSQL readiness、seed 数据、容器内真实调度、零硬冲突结果，以及 API 重启后的运行记录持久化。

完整浏览器验收入口：

```bash
npm run test:e2e:demo
```

该命令建立隔离的全新演示卷，依次运行 smoke 和全部 Playwright 场景，成功或失败后均清理容器、网络和演示卷。排查失败现场时可设置 `KEEP_DEMO_STACK=1` 保留环境。

## 环境配置

根目录 `.env.example` 列出可覆盖变量。Docker Compose 会自动读取根目录 `.env`；直接运行 `npm run dev` 时，需要由 shell 或进程管理器注入对应变量。

- 宿主机访问 PostgreSQL 使用 `localhost:${POSTGRES_PORT}`，容器内 API 固定通过 `postgres:5432` 访问数据库。
- 浏览器访问 API 使用 `NEXT_PUBLIC_API_BASE_URL`，该值会在 Web 镜像构建时写入客户端代码。
- `POSTGRES_PORT`、`API_PORT` 和 `WEB_PORT` 只覆盖宿主机映射端口，不改变容器内端口。
- 仓库内默认账号和数据库口令仅用于本机演示。不要把真实密码、生产 token 或外部数据库凭据写入 `.env.example`、Compose 文件或 Git。

如需手工验证 PostgreSQL 数据层，应使用名称包含 `test` 的隔离数据库，并通过 `TEST_DATABASE_URL` 运行集成测试；测试会重建目标数据库的 `public` schema。

## 认证

API 通过 Bearer token 校验身份和角色。开发环境内置 3 个演示账号，也可以通过环境变量覆盖密码和 token：

- `admin` / `admin`：管理员，默认 token 为 `examforge-admin-token`。
- `operator` / `operator`：排考教务员，默认 token 为 `examforge-operator-token`。
- `viewer` / `viewer`：只读观察员，默认 token 为 `examforge-viewer-token`。

登录接口为 `POST /api/auth/login`。Web 运营台的角色选择会使用对应 token 访问变更接口，不再信任客户端传入的角色请求头。

## 核心演示链路

1. 打开 `http://localhost:3000`。
2. 查看考试批次、基础数据和资源指标。
3. 创建同步或异步排考运行，查看结果、评分和资源利用率。
4. 从运行创建草稿，在矩阵中应用建议、拖拽、锁定或局部再平衡。
5. 锁定关键考试后生成增量重排版本，核对冻结、保留和变化摘要。
6. 校验并发布草稿，查看教师/学生安排和通知预览。
