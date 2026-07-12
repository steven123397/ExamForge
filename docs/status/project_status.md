# ExamForge 项目状态

## 当前结论

- 日期：2026-07-12。
- 当前版本：第四版第二阶段已完成；实现提交为 `7c76ac6`、`cfd1800`、`bc386ac`、`b476d9a` 和 `62a5e1b`。
- 当前活动计划为 `docs/plan/第四版第三阶段计划.md`，实施范围是草稿增量重排 Web 闭环、完整 Compose 演示栈和 Playwright 证据重建；历史阶段与验证明细维护在 `docs/plan/history_plan.md`，审查问题维护在 `docs/status/code_review_status.md`。

## 当前实现基线

### 调度器与重排

- room-slot 与教师分配采用顺序二阶段 CP-SAT；教师模型覆盖固定教师、不可用时间、同时间唯一、最大负载、负载极差和连续监考。
- `reschedule_context` 已贯通 shared、API 同步/异步入口、Python CLI 和 solver；冻结考试保持 room、slot、teacher，可移动考试受稳定性目标影响。
- 报告输出 frozen、retained 和 changed 摘要；根脚本提供固定 seed 的 50、100、150 场 benchmark。

### 平台与数据

- Web、API、PostgreSQL 和调度器已形成排考、草稿治理、发布、查询、通知和导出闭环。
- 排考、草稿和发布治理进入独立 service/use-case 层；PostgreSQL 关联表优先读取，JSONB 暂作兼容回退。
- 同一草稿通过 PostgreSQL advisory lock 串行化，并以终态 CAS 防止重复发布和终态后修改。

## 最新验证基线

- `npm run test:scheduler`：scheduler `73 passed`。
- `npm run benchmark:scheduler`：50、100、150 场均为 `feasible`、零冲突；最新耗时为 305、437、732 ms，教师负载极差均为 1。
- `npm run typecheck`：通过。
- `LOG_LEVEL=silent npm test`：API `48 passed`。
- `npm run build`：通过。
- `TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:postgres`：PostgreSQL `9 passed`。

最近一次浏览器基线仍为第三版结束时 Playwright `2 passed`；第四版第三阶段涉及演示体验时必须重新取得 E2E 证据。

## 当前边界

- 规模 profile 显式关闭连续监考软目标；该目标由专项测试覆盖，未取得大规模全局最优性能结论。
- 固定 100 分制在大规模下会因累计软惩罚饱和到 0，暂不支持跨批次质量比较。
- Web 草稿锁定尚未自动生成完整 `reschedule_context`；鉴权、异步执行、进度和 scheduler 部署仍是演示级边界。
- JSONB 兼容字段尚未删除。

## 下一步

1. 按 `docs/plan/第四版第三阶段计划.md` 实施演示环境与体验增强，并重新建立本地及真实 Compose/PostgreSQL Playwright E2E 证据。
2. 第四版第四阶段建立类型检查、测试、构建、PostgreSQL、迁移和 E2E 的 CI 质量门禁。
3. 第四版全部阶段完成后执行一次全量代码审查，发现写入 `docs/status/code_review_status.md`，修复另建计划。
