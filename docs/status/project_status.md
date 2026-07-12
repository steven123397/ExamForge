# ExamForge 项目状态

## 当前结论

- 日期：2026-07-12。
- 当前版本：第四版第三阶段已完成；本阶段实现提交为 `1284b66`、`95bac27`、`cbd6912` 和 `0d6e166`，文档与收尾见包含本状态更新的提交。
- 当前没有活动计划；历史阶段与验证明细维护在 `docs/plan/history_plan.md`，审查问题维护在 `docs/status/code_review_status.md`。

## 当前实现基线

### 调度器与重排

- room-slot 与教师分配采用顺序二阶段 CP-SAT；教师模型覆盖固定教师、不可用时间、同时间唯一、最大负载、负载极差和连续监考。
- `reschedule_context` 已贯通 shared、API 同步/异步入口、Python CLI 和 solver；冻结考试保持 room、slot、teacher，可移动考试受稳定性目标影响。
- 报告输出 frozen、retained 和 changed 摘要；根脚本提供固定 seed 的 50、100、150 场 benchmark。
- 草稿锁定可由 API service 自动转换为重排上下文；Web 可以生成独立重排运行并展示冻结、保留和变化摘要，来源草稿不被原地修改。

### 平台与数据

- Web、API、PostgreSQL 和调度器已形成排考、草稿治理、发布、查询、通知和导出闭环。
- 排考、草稿和发布治理进入独立 service/use-case 层；PostgreSQL 关联表优先读取，JSONB 暂作兼容回退。
- 同一草稿通过 PostgreSQL advisory lock 串行化，并以终态 CAS 防止重复发布和终态后修改。
- Compose 已覆盖 PostgreSQL、迁移、seed、API、容器内 scheduler 和 Web；`/health` 与真实仓储 `/ready` 分离，完整演示支持一键启动、重置、烟测和清理。

## 最新验证基线

- `npm run test:scheduler`：scheduler `73 passed`。
- `npm run benchmark:scheduler`：50、100、150 场均为 `feasible`、零冲突；最新耗时为 305、437、732 ms，教师负载极差均为 1。
- `npm run typecheck`：通过。
- `LOG_LEVEL=silent npm test`：API `54 passed`。
- `npm run build`：通过。
- `TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:postgres`：PostgreSQL `9 passed`。
- `TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:migrations`：迁移测试 `4 passed`；空 schema 正式迁移入口应用 `0000` 至 `0007`。
- `npm run test:e2e`：本地自启内存服务 Playwright `3 passed`，默认不复用未知旧服务。
- `npm run test:e2e:demo`：真实 Compose/PostgreSQL Playwright `3 passed`；前置 smoke 为 `storage=postgres`、6 条安排、硬冲突 0，并通过 API 重启持久化检查。

## 当前边界

- 规模 profile 显式关闭连续监考软目标；该目标由专项测试覆盖，未取得大规模全局最优性能结论。
- 固定 100 分制在大规模下会因累计软惩罚饱和到 0，暂不支持跨批次质量比较。
- Bearer token 鉴权、API 进程内异步执行、HTTP 轮询和 scheduler JSON CLI 仍是演示级边界；本阶段只把 CLI 运行环境封装进 API 镜像，没有引入独立 scheduler 服务。
- JSONB 兼容字段尚未删除。
- CI 质量门禁尚未建立，当前验证入口仍由开发者本地执行。

## 下一步

1. 为第四版第四阶段编写计划，建立类型检查、测试、构建、PostgreSQL、迁移和 E2E 的 CI 质量门禁。
2. 第四版全部阶段完成后执行一次全量代码审查，发现写入 `docs/status/code_review_status.md`，修复另建计划。
