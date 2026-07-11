# ExamForge 项目状态

## 当前结论

- 日期：2026-07-11。
- 当前版本：第四版第一阶段已完成，提交为 `a591cf4 feat(第四版): 完成数据与服务边界治理`。
- 当前活动计划：`docs/plan/第四版第二阶段计划.md`，聚焦教师二阶段优化、增量重排语义和 50/100/150 场规模验证。
- 历史阶段、提交和验证明细统一维护在 `docs/plan/history_plan.md`。
- 存留问题、代码审查发现和技术债统一维护在 `docs/status/code_review_status.md`。

## 当前实现基线

### 调度器

- `apps/scheduler` 使用 Python、OR-Tools CP-SAT 完成 room-slot 排考，具备预检、冲突解释、软约束目标、评分和报告整理。
- shared 合同和调度器支持 `fixed_assignments`；非固定监考教师采用负载感知分配，尚未宣称全局最优。
- API 通过 JSON stdin/stdout CLI 调用调度器，当前适合单机演示和契约测试。

### 平台闭环

- Web、API、PostgreSQL 和调度器已形成“排考运行 → 草稿调整/锁定/再平衡 → 校验/对比 → 发布/废弃 → 查询/通知/导出”闭环。
- Web 已按业务面拆分并使用 TanStack Query；API 使用 Fastify、演示 Bearer token 鉴权和内存/PostgreSQL 双仓储。
- 排考、草稿和发布治理已进入独立 service/use-case 层，route 主要保留鉴权、参数解析和 HTTP 映射。

### 数据与一致性

- PostgreSQL 关联表是教师不可用、考试学生群体和监考教师的优先读路径，JSONB 暂作为兼容回退。
- 迁移检查覆盖关键关联表、主键、外键和 JSONB 双向一致性。
- 同一草稿的变更通过 PostgreSQL advisory lock 串行化，并用终态 CAS 防止并发重复发布、终态回退和终态后修改。

## 最新验证基线

第四版第一阶段提交前已重新验证：

- `npm run typecheck`：通过。
- `LOG_LEVEL=silent npm test`：API `44 passed`。
- `npm run test:scheduler`：scheduler `42 passed`。
- `npm run build`：通过。
- `npm run test:postgres`：PostgreSQL 集成测试 `9 passed`。
- `npm run test:migrations`：迁移与数据库 session 测试 `4 passed`。
- 连续运行正式迁移入口：第二次返回 `applied: []`。
- `git diff --check`：通过。

最近一次浏览器基线为第三版结束时 Playwright `2 passed`；第四版后续涉及 Web 或 CI 时必须重新取得 E2E 证据。

## 当前边界

- 鉴权仍为内置演示账号和 Bearer token，不是真实用户、会话或组织权限系统。
- 异步作业状态已持久化，但执行仍由 API 进程内 `setTimeout()` 触发，不具备多实例队列、恢复执行、取消和重试语义。
- 排考进度使用 HTTP 轮询，调度器仍为 CLI 子进程；真实队列、SSE/WebSocket 和 FastAPI 服务化继续暂缓。
- JSONB 兼容字段尚未删除，后续需根据迁移和兼容窗口决定最终收敛方式。

## 下一步

1. 执行第四版第二阶段计划：教师二阶段 CP-SAT、50/100/150 场考试规模基准和增量重排语义。
2. 执行第四版第三阶段：演示环境与体验增强。
3. 执行第四版第四阶段：建立类型检查、测试、构建、PostgreSQL、迁移和 E2E 的 CI 质量门禁。
4. 第四版全部阶段完成后执行一次全量代码审查，发现写入 `docs/status/code_review_status.md`，修复另建计划。
