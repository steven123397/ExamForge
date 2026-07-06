# ExamForge

ExamForge 是一个面向高校考务场景的企业级排考运营平台。当前仓库已经包含：

- Python CP-SAT 排考算法核心：数据模型、测试数据生成、预检、冲突解释、求解、评分和报告。
- Fastify API：Dashboard、基础数据、排考运行和运行详情接口。
- Next.js 运营台：批次概览、排考运行、结果列表、冲突解释、资源利用率和教师工作量。
- Drizzle/PostgreSQL 数据模型：企业平台第一阶段 schema 和迁移 SQL。

## 本地开发

安装依赖：

```bash
npm install
```

运行 Python 调度器测试：

```bash
cd apps/scheduler
uv run --python 3.12 --extra dev python -m pytest -q
```

运行 TypeScript 检查、API 测试和 Web 构建：

```bash
npm run typecheck
npm test
npm run build
```

启动 API 和 Web：

```bash
npm run dev
```

默认地址：

- Web：`http://localhost:3000`
- API：`http://localhost:4000`
- API 健康检查：`http://localhost:4000/health`

## 数据库

启动 PostgreSQL：

```bash
docker compose up -d postgres
```

初始化 schema：

```bash
export DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge
for migration in packages/db/drizzle/*.sql; do
  psql "$DATABASE_URL" -f "$migration"
done
```

写入演示批次和基础数据：

```bash
export DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge
npm run seed --workspace @examforge/db
```

API 会在存在 `DATABASE_URL` 时使用 PostgreSQL 持久化仓储；未配置时回落到内置演示仓储，保证无数据库环境也能演示排考闭环。若已经应用过旧版 `0000_initial.sql`，只需要继续执行后续新增迁移。

## 核心演示链路

1. 打开 `http://localhost:3000`。
2. 查看考试批次、基础数据和资源指标。
3. 点击“运行排考”。
4. Web 调用 Fastify API。
5. API 通过 JSON stdin/stdout 调用 Python scheduler。
6. 页面展示排考结果、冲突解释、评分和资源利用率。
