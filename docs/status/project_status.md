# ExamForge 项目状态

## 当前结论

- 日期：2026-07-12。
- 当前版本：第五版第一阶段已经完成并归档，当前唯一活动计划为 `docs/plan/第五版第二阶段计划.md`。
- 第一阶段建立了可靠作业与事件数据合同、关系化单一事实源、真实本地身份会话、四角色权限边界和前端信息架构基础；尚未开始 Scheduler 服务化、可靠队列或实时事件。
- 代码审查问题仍为 4 项暂缓：P2 的 CR-002、CR-007、CR-008，以及 P3 的 CR-003；当前无待解决 P0/P1。详细问题只维护在 `docs/status/code_review_status.md`。

## 当前实现基线

### 调度器与作业

- room-slot 与教师分配采用顺序二阶段 CP-SAT，覆盖固定安排、教师不可用、同时间唯一、最大负载、负载极差和同日相邻连续监考。
- `reschedule_context` 已贯通 shared、API、Python CLI 和 solver；固定 seed 提供 50、100、150 场 benchmark。
- 作业状态统一为 `queued`、`running`、`succeeded`、`failed`、`cancelled`、`timed_out`；`infeasible` 是 `succeeded` 下的业务结果。
- PostgreSQL 持久化作业、尝试、事件和 outbox；请求摘要、幂等键、条件状态转换和唯一约束防止重复入队、重复完成和终态竞争。
- 当前 API 仍以进程内执行器调用 Python scheduler CLI，Web 仍以轮询读取作业状态；FastAPI/HTTP 调用由第二阶段实施，Redis/BullMQ/Worker/SSE 由第三阶段实施。

### 数据、身份与 Web

- 教师不可用、考试学生群体、正式监考和草稿监考四类关系只使用关联表；旧 JSONB 关系列已由顺序迁移删除。
- PostgreSQL advisory lock 和终态 CAS 继续保护同一草稿的调整、校验、锁定、重排、发布和废弃。
- 本地用户、角色、用户角色和服务端会话已持久化；密码使用 scrypt 随机盐，会话只存摘要，Cookie 使用 HttpOnly/SameSite 并集中配置 Secure、过期和可信 Origin。
- API 根据真实会话执行管理员、排考员、教师、学生 RBAC，关键审计记录真实 userId 与角色快照；不存在匿名默认管理员回退。
- Web 使用 Cookie 恢复会话并统一处理 401/403/退出缓存；管理员和排考员使用运营台，教师和学生使用受限的已发布查询门户。
- `docs/design/第五版前端信息架构与视觉规范.md` 固定后续路由、角色导航、设计 token、状态、响应式与视觉验收边界；第一阶段只整理现有原型基础样式，没有完成第五阶段的页面级重构。

### CI 与演示

- GitHub Actions 继续提供快速、PostgreSQL/迁移和 Compose/Playwright 三层门禁；治理脚本检查禁止跟踪产物、中文 Conventional Commits 和提交区间空白错误。
- Compose 继续按 PostgreSQL、迁移、seed、API、Web 启动；演示账户密码必须显式注入，未配置时不会生成默认生产账户。
- demo smoke 使用真实 Cookie 会话完成主链，并验证 API 重启后 PostgreSQL 中的运行记录仍可读取。

## 第一阶段收尾验证

- `npm run test:ci`：`7 passed`；`npm run check:ci`、`npm run typecheck` 和 `npm run build` 通过。
- `LOG_LEVEL=silent npm test`：shared `9 passed`，API/服务测试共 `70 passed`。
- `npm run test:scheduler`：`78 passed`。
- `npm run benchmark:scheduler`：50、100、150 场均 feasible、0 冲突，耗时 419、767、1199 ms，教师负载极差均为 1。
- 可丢弃 PostgreSQL 16：迁移测试 `5 passed`，12 个迁移首次全部应用、第二次应用 0；迁移检查确认关键表/约束无缺失、关系无双向不一致、旧关系列为空、作业状态枚举正确；正式迁移入口返回 `applied: []`；真实集成测试 `13 passed`。
- 独立 Compose：smoke 完成真实登录、排考、持久化读取和 API 重启检查；Chromium E2E `17 passed`，覆盖错误密码、退出、Cookie 失效、管理员主链、排考员允许操作和教师/学生写请求 403。
- 视觉检查：登录、1600 px 管理员全页和 375 px 教师门户截图均非空；桌面和移动页面宽度等于视口，移动端未发现可见溢出元素。
- 最终隔离 Compose 回归再次通过：smoke 使用真实会话完成排考并验证 API 重启后的 PostgreSQL 持久化读取，Chromium E2E `17 passed`；测试容器、网络和卷均已清理，用户原有演示栈未修改。

## 当前边界

- 规模 profile 显式关闭连续监考软目标；该目标由专项测试覆盖，未取得大规模全局最优性能结论。
- 固定 100 分制在大规模下会因累计软惩罚饱和到 0，暂不支持跨批次质量比较。
- 作业事件和 outbox 已持久化，但尚无 Publisher、可靠队列、独立 Worker、崩溃恢复和 SSE 补发。
- scheduler 尚未提供独立 FastAPI/OpenAPI 服务，API 容器仍包含 CLI 调用所需的 Python 运行时。
- CI 尚未配置自动发布、镜像推送、分支保护或生产部署流水线。

## 下一步

1. 等待用户确认第五版第一阶段结果，不自动开始第二阶段。
2. 确认后按 `docs/plan/第五版第二阶段计划.md` 顺序实施 FastAPI、OpenAPI、API HTTP 客户端、独立 scheduler 镜像和故障合同，并在阶段末重评 CR-008。
3. CR-007 继续留到第五版第三阶段，与 Redis/BullMQ、Outbox Publisher、独立 Worker 和 SSE 成组处理；CR-002、CR-003 按各自重评条件持续跟踪。
