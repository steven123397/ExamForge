# 历史计划归档

本文件记录已完成计划的摘要。活动计划直接放在 `docs/plan/` 下；完成后将摘要追加到本文件，并删除原活动计划文件。

## 2026-07-05 Agent A 数据模型与测试数据生成器

- 原计划：Agent A 数据模型与测试数据生成器实现计划
- 完成提交：`ff195cb feat(调度器): 添加数据模型与测试数据生成器`
- 完成内容：创建 `apps/scheduler/` Python 包骨架，定义调度器输入输出数据模型，实现固定随机种子的测试数据生成器，并补充模型和生成器测试。
- 范围边界：未实现预检、CP-SAT 求解器、软约束评分、冲突解释、Web、API、数据库和部署配置。
- 当前复核：文档层面可运行 `git diff --check`；调度器测试在当前默认环境受阻，因为本机默认 `python` 不存在，`python3` 为 3.10.12，而 `apps/scheduler/pyproject.toml` 要求 Python 3.12 及以上且需要 pytest。
- 后续影响：Agent B 可基于既有数据合同实现预检与基础冲突解释；Agent C 可在数据合同稳定后实现求解器；Agent D 可继续补评分、报告和课程材料。

## 2026-07-05 Agent D 评分与报告

- 原计划：`docs/plan/agent_d_scoring_report_plan.md`
- 完成提交：`a3c7b31 feat(调度器): 添加评分与报告`
- 完成内容：创建 `examforge_scheduler/scoring.py` 和 `examforge_scheduler/report.py`，实现四类软约束评分、评分下限、报告统计摘要、冲突摘要、评分摘要、考场利用率摘要和教师工作量摘要，并补充 `test_scoring.py`、`test_report.py`。
- 范围边界：未实现预检、冲突解释、CP-SAT 求解器、Web、API、数据库、图表库或文件导出；评分和报告测试均基于手工构造的 `ScheduledExam` 与 `ScheduleResult`。
- 验证结果：分支内运行评分与报告测试结果为 `8 passed`；合并后随全量调度器测试一起通过。
- 后续影响：后续整合时可直接复用 `calculate_score()` 和 `build_schedule_report()` 作为排考结果输出阶段。

## 2026-07-05 Agent B 预检与冲突解释

- 原计划：`docs/plan/agent_b_precheck_conflicts_plan.md`
- 完成提交：`d8bbefc feat(调度器): 添加预检与冲突解释`
- 合并提交：`04f29ce merge: 集成 Agent B 预检与冲突解释`
- 完成内容：创建 `examforge_scheduler/precheck.py` 和 `examforge_scheduler/conflicts.py`，实现容量、考场条件、时间窗口、学生群体过载、教师不可用等预检冲突，并实现未排考试、考场时间冲突、学生群体冲突、教师时间冲突、容量不匹配和考场要求不匹配等排考结果冲突检测。
- 范围边界：未实现求解器、软约束评分、Web、API、数据库或命令行界面。
- 验证结果：分支内运行 `uv run --python 3.12 --extra dev python -m pytest tests/test_precheck.py tests/test_conflicts.py -q`，结果为 `12 passed`；合并后随全量调度器测试一起通过。
- 后续影响：求解前可用 `run_precheck()` 快速识别明显不可行数据，求解后可用 `detect_assignment_conflicts()` 对排考结果做硬约束复核。

## 2026-07-05 Agent C 硬约束求解器

- 原计划：`docs/plan/agent_c_solver_plan.md`
- 完成提交：`8deb43e feat(调度器): 添加硬约束求解器`
- 合并提交：`48013db merge: 集成 Agent C 硬约束求解器`
- 完成内容：创建 `examforge_scheduler/solver.py`，引入 OR-Tools 依赖，实现基于布尔变量 `x[exam_id, room_id, slot_id]` 的 CP-SAT 硬约束求解器，并补充硬约束求解测试。
- 范围边界：未实现正式软约束优化目标、Web、API、数据库或队列；监考教师分配采用求解后贪心策略。
- 验证结果：分支内运行 `uv run --python 3.12 --extra dev python -m pytest tests/test_solver_hard_constraints.py -q`，结果为 `3 passed`；合并后随全量调度器测试一起通过。
- 后续影响：第一版调度器现在可以从结构化测试数据生成排考结果，并返回 `ScheduleResult`、求解统计和硬约束失败原因。

## 2026-07-05 Agent B/C/D 集成

- 合并提交：`04f29ce`、`48013db`、`045fab3`
- 完成内容：将预检与冲突解释、硬约束求解器、软约束评分与报告整理合并到 `main`，并在 `examforge_scheduler/__init__.py` 同时导出 `solve_schedule()`、`calculate_score()` 和 `build_schedule_report()`。
- 验证结果：在 `apps/scheduler/` 下运行 `uv run --python 3.12 --extra dev python -m pytest -q`，最终结果为 `31 passed`；仓库根目录运行 `git diff --check`，结果为通过。
- 当前风险：默认系统 `python` 命令仍不存在，`python3` 为 3.10.12；调度器验证应继续使用 `uv run --python 3.12 --extra dev` 或准备正式 Python 3.12 虚拟环境。

## 2026-07-05 企业级全栈平台第一阶段

- 原计划：`docs/plan/企业级全栈平台第一阶段计划.md`
- 完成内容：创建 npm workspace、`packages/shared`、`packages/db`、`apps/api` 和 `apps/web`；补充 PostgreSQL/Drizzle schema、迁移 SQL、Docker Compose、Fastify API、Next.js 企业运营台、Python scheduler JSON CLI 和项目 README。
- 范围边界：API 第一阶段使用内置演示仓储保证无数据库也可演示；PostgreSQL schema 和迁移已存在，但持久化仓储留到下一阶段；未实现真实登录、SSO、多租户权限、完整 CRUD、Redis 队列和 WebSocket。
- 验证结果：`apps/scheduler` 全量测试通过，结果为 `32 passed`；`npm test` 的 API 测试通过，结果为 `2 passed`；`npm run typecheck` 通过；`npm run build` 通过；`git diff --check` 通过。
- 集成验证：启动 API 后调用 `POST /api/schedule-runs`，返回 `status=feasible`、`assignments=6`、`conflicts=0`、`score=60`；启动 Web 后 `http://127.0.0.1:3000` 返回 `200 OK`。
- 当前风险：`npm audit` 仍报告 Next 15.5.20 依赖链中的 2 个 moderate 级 PostCSS 相关公告，npm 给出的自动修复方案会降级到不适合本项目的旧 Next 版本。

## 2026-07-06 第二版方案草稿工作台第一阶段

- 原计划：`docs/plan/第二版方案草稿工作台第一阶段计划.md`
- 完成提交：`4154b61 feat(第二版): 添加方案草稿工作台闭环`
- 完成内容：新增 `docs/design/第二版实现内容设计.md`，实现排考草稿领域合同、草稿 API、内存仓储、PostgreSQL 仓储、草稿表迁移、人工调整硬约束校验和 Web 方案工作台。
- 范围边界：未实现复杂拖拽、局部重排、登录权限、消息通知、队列、WebSocket、生产级多租户和课程报告终稿。
- 验证结果：`npm test` 通过，API 测试结果为 `11 passed`；`npm run typecheck` 通过；`npm run build` 通过；`apps/scheduler` 全量测试结果为 `32 passed`；`git diff --check` 通过。
- 后续影响：第二阶段应优先补真实 PostgreSQL 草稿路径验证、废弃草稿、草稿对比与发布确认面板，让方案治理流程更接近真实教务运营。

## 2026-07-06 第二版方案草稿工作台第二阶段

- 原计划：`docs/plan/第二版方案草稿工作台第二阶段计划.md`
- 完成提交：本轮本地提交 `feat(第二版): 完成方案草稿治理第二阶段`；未 push。
- 完成内容：新增草稿废弃 API、仓储方法和审计事件；扩展草稿对比合同，支持相对来源运行和当前发布版本的变化摘要；运营台方案工作台新增发布确认面板、废弃入口、终态草稿锁定和最近 10 条调整记录展示；新增课程报告素材文档 `docs/background/第二版人机协同排考报告素材.md`。
- 范围边界：未实现拖拽式矩阵、局部重排、登录权限、异步队列、WebSocket、通知和导出文件。
- 真实库验证：Docker PostgreSQL 容器 `examforge-postgres` 中验证草稿创建、制造硬冲突、硬冲突阻断发布、恢复后发布、发布后禁止调整、废弃后禁止发布；旧迁移重复执行会出现已存在对象提示，`0003_schedule_drafts.sql` 已成功应用。
- 验证结果：`npm test` 通过，API 测试结果为 `12 passed`；`npm run typecheck` 通过；`npm run build` 通过；`apps/scheduler` 全量测试结果为 `32 passed`；`git diff --check` 通过。
- 后续影响：第三阶段可基于当前草稿治理闭环继续做拖拽式交互、局部重排建议、权限审计或报告导出。

## 2026-07-06 第二版方案草稿工作台第三阶段

- 原计划：`docs/plan/第二版方案草稿工作台第三阶段计划.md`
- 完成内容：实现局部调整建议 API、建议生成服务、内存仓储和 PostgreSQL 仓储接入；运营台方案工作台新增局部调整建议面板、一键应用建议、矩阵拖拽调整和拖放状态；课程报告素材追加 Mermaid 流程图、草稿状态图、演示脚本和测试结论摘要。
- 范围边界：未实现真实登录权限、异步队列、WebSocket、通知系统、导出文件、完整 CP-SAT 局部重排和数据库迁移治理。
- 浏览器验收：引入 Playwright 和 Chromium，新增 `npm run test:e2e`，在真实 Chromium 中验证“创建草稿 → 加载方案工作台 → 展示局部调整建议 → 一键应用建议 → 鼠标拖拽矩阵单元格 → API 草稿状态更新”的端到端路径。
- 验证结果：第三阶段 API 行为测试已覆盖局部调整建议接口；`npm run test:e2e` 通过，Playwright 结果为 `1 passed`。完整回归验证以本轮最终验证记录为准。
- 后续影响：第二版人机协同排考核心闭环已经覆盖 API、仓储、Web 工作台和浏览器级交互验收；下一阶段可转向权限审计、报告导出、迁移治理或课程报告终稿整理。

## 2026-07-06 第二版增强方向第四阶段

- 原计划：`docs/plan/第二版增强方向第四阶段计划.md`
- 完成提交：本轮本地提交 `feat(第二版): 完成增强方向第四阶段`；未 push。
- 完成内容：实现异步排考作业 API 和 Web 轮询展示；实现草稿考试锁定、解锁、锁定后禁止调整、局部再平衡；实现轻量角色权限护栏、教师不可用时间维护、已发布方案通知预览和 CSV 导出；运营台新增角色选择、异步作业、锁定/解锁、局部再平衡、教师不可用维护、通知预览和导出入口。
- 文档交付：新增 `docs/background/第二版课程报告终稿.md` 和 `docs/background/第二版部署与演示说明.md`；更新第二版设计文档的增强方向落地边界。
- 范围边界：当轮实现中异步作业为进程内作业表，权限为请求头轻量护栏，通知为预览与导出，不接入生产级队列、SSO、短信、邮件、WebSocket 或外部教务系统；后续代码审查修复已将作业状态迁入 repository/PostgreSQL 表，并将权限升级为 Bearer token 登录与鉴权。
- 验证结果：`npm test` 通过，API 测试结果为 `16 passed`；`npm run typecheck` 通过；`npm run build` 通过；`npm run test:e2e` 通过，Playwright 结果为 `2 passed`；`uv run --python 3.12 --extra dev python -m pytest -q` 通过，调度器测试结果为 `32 passed`；`git diff --check` 通过。
- 后续影响：第二版设计文档中列出的增强方向已完成轻量闭环实现；后续可进入第三版企业化，优先生产化任务队列、真实认证授权、消息投递状态、下载审计、标准迁移执行器和部署监控。

## 2026-07-07 第三版第一阶段：Web 运营台拆分

- 原计划：`docs/plan/第三版第一阶段计划.md`
- 完成提交：`efa3eac feat(第三版): 拆分 Web 运营台`；未 push。
- 完成内容：新增 Web API client、角色 token 边界、query keys 和 TanStack Query provider；将异步作业、已发布查询、基础数据管理、教师不可用维护、运行历史/审计、草稿工作台拆入 `apps/web/features/`；将共享 `LoadState`、指标卡和面板壳提取到 `apps/web/components/shared/`；`apps/web/app/operations-console.tsx` 从约 2397 行收敛到 851 行，主要保留页面编排、角色选择、跨面板状态和动作 handler。
- 范围边界：未修改 API、数据库、调度器业务行为；未引入 PostgreSQL 集成测试体系、软约束入 CP-SAT、Redis/BullMQ、SSE/WebSocket 或 FastAPI scheduler；未重设计运营台视觉风格。
- 验证结果：`npm run typecheck` 通过；`LOG_LEVEL=silent npm test` 通过，API 测试结果为 `22` 个通过；`npm run build` 通过；`npm run test:e2e` 通过，Playwright 结果为 `2 passed`；`git diff --check` 通过。
- 后续影响：CR-009 的 Web 单文件维护风险已显著降低；第三版第二阶段可转向 PostgreSQL 集成测试、迁移验证、scheduler CLI 契约测试和 API service 提取。

## 2026-07-07 第三版第二阶段：测试基线补强与 API service 提取

- 原计划：`docs/plan/第三版第二阶段计划.md`
- 完成提交：本次本地提交；按用户要求未 push。
- 完成内容：新增 PostgreSQL 集成测试入口和根脚本，覆盖真实仓储的排考运行、草稿冲突阻断与修复发布、作业状态迁移和审计过滤；新增迁移从空库执行验证入口和 `migration-check`；新增 API 到 Python scheduler CLI 契约测试；提取已发布方案受众、通知预览、CSV 导出 service；新增审计过滤 service，并让内存仓储、PostgreSQL 仓储和 API 路由支持 `entityType`、`entityId`、`actor`、`since`、`until` 过滤。
- 范围边界：未做软约束入 CP-SAT；未重构 JSONB 数组为关联表；未引入 Redis/BullMQ、SSE/WebSocket 或 FastAPI scheduler；未重设计 Web 交互。
- 迁移与数据修复：新增 `0006_allow_conflicting_draft_assignments.sql`，移除草稿安排的 `(draft_id, room_id, time_slot_id)` 唯一约束，让草稿可以暂存冲突并由草稿校验逻辑展示和阻断发布；正式 `scheduled_exams` 的唯一约束保持不变。
- 验证结果：`npm run typecheck` 通过；`LOG_LEVEL=silent npm test` 通过，API 测试结果为 `29` 个通过；`npm run build` 通过；`npm run test:scheduler` 通过，调度器测试结果为 `34 passed`；`npm run test:e2e` 通过，Playwright 结果为 `2 passed`；`TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:postgres` 通过，PostgreSQL 集成测试结果为 `3 passed`；同测试库运行 `npm run test:migrations` 通过，迁移测试结果为 `1 passed`；清空测试库后以 `DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run db:migrate` 验证正式迁移入口通过并应用 `0000` 至 `0006`；`git diff --check` 通过。
- 后续影响：第三版第三阶段可以在有 PostgreSQL、迁移、scheduler CLI 和 API service 测试保护的前提下推进软约束入 CP-SAT。

## 2026-07-07 第三版第三阶段：软约束入模

- 原计划：`docs/plan/第三版第三阶段计划.md`
- 完成提交：本轮本地提交 `feat(第三版): 完成软约束入模`；未 push。
- 完成内容：在 `solve_schedule()` 中为 room-slot 决策变量新增 CP-SAT 软约束目标函数，覆盖 `room_utilization`、`student_consecutive_exam` 和 `exam_distribution_balance`；新增 `test_solver_soft_objective.py`，证明软约束权重能改变考场选择、避免同一学生群体连续考试并降低单日集中安排；成功求解后返回与最终安排一致的 `score_breakdown`，Python CLI 复用求解器评分并只修正合并冲突后的硬冲突计数。
- 范围边界：未把教师分配纳入 CP-SAT 联合求解；未实现教师工作量负载感知匹配；未新增 `fixed_assignments`；未重构 JSONB 数组为关联表；未新增 `buildings` 表；未引入 Redis/BullMQ、SSE/WebSocket、FastAPI scheduler、OpenAPI/SDK 或复杂权限矩阵。
- 验证结果：先运行新增软约束目标红灯测试，`npm run test:scheduler` 预期失败为 `4 failed, 34 passed`；实现后 `npm run test:scheduler` 通过，调度器测试结果为 `38 passed`；`LOG_LEVEL=silent npm test` 通过，API 测试结果为 `29` 个通过；`npm run typecheck` 通过；`npm run build` 通过；`npm run test:e2e` 通过，Playwright 结果为 `2 passed`。
- 验证说明：曾并行运行 `npm run build` 与 `npm run test:e2e`，Next 同时读写 `.next` 导致 manifest 缺失并失败；串行重跑后构建和 E2E 均通过，该失败不归因于本阶段业务代码。
- 后续影响：第三版必做主线已覆盖 Web 拆分、测试基线/API service 和软约束入模；第四阶段可以转向设计文档中的选做内容，包括关联表重构、楼栋语义、教师分配增强和增量重排合同。

## 2026-07-07 第三版第四阶段：选做内容实现

- 原计划：`docs/plan/第三版第四阶段计划.md`
- 完成提交：本轮本地提交 `feat(第三版): 完成第四阶段选做内容`；未 push。
- 完成内容：新增 `fixed_assignments` shared 合同、Python scheduler `FixedAssignment` 模型、CLI 解析、固定 room-slot 约束和固定监考教师处理；将非固定监考教师分配改为负载感知选择；新增 `0007_association_tables.sql`，建立考试任务学生群体、正式监考、草稿监考和教师不可用时间关联表；seed、PostgreSQL 仓储创建/更新基础数据、正式排考、草稿创建/调整/发布路径均保持 JSONB 字段兼容并同步写入关联表；API 基础数据校验新增考场 `building_id` 语义约束。
- 范围边界：未删除既有 JSONB 数组字段，未改变 Web/API 返回结构；未把教师分配纳入 CP-SAT 联合求解；未新增完整 `buildings` 主数据表、楼栋 UI、跨楼栋软约束、Redis/BullMQ、SSE/WebSocket、FastAPI scheduler、OpenAPI/SDK 或复杂权限矩阵。
- 验证结果：`npm run test:scheduler` 通过，调度器测试结果为 `42 passed`；`npm run typecheck` 通过；`LOG_LEVEL=silent npm test` 通过，API 测试结果为 `30` 个通过；`npm run build` 通过；`npm run test:e2e` 通过，Playwright 结果为 `2 passed`；`TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:postgres` 通过，PostgreSQL 集成测试结果为 `3 passed`；同测试库运行 `npm run test:migrations` 通过，迁移测试结果为 `1 passed`；`DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run db:migrate` 通过且无待应用迁移；`git diff --check` 通过。
- 后续影响：第三版设计中的选做内容已形成兼容式实现基线；后续如果继续企业化，应优先评估是否删除 JSONB 冗余字段、补楼栋主数据和跨楼栋约束，或将固定安排合同接入 Web 锁定考试与局部重排请求。

## 2026-07-08 第三版完成后全量代码审查

- 原计划：`docs/plan/全量代码审查计划.md`
- 执行证据：`docs/status/code_review_status.md` 的 2026-07-08 审查记录；主要修复提交为 `5bd4395 fix(审查): 修复第四阶段全量审查问题`，CR-018、CR-019 的后续修复和真实库补强进入 `a591cf4 feat(第四版): 完成数据与服务边界治理`。
- 完成内容：覆盖 scheduler、API/service/repository、数据库迁移与共享合同、Web 运营台、工程验证和文档治理；复核 CR-002、CR-003、CR-007、CR-008，新增并处理 CR-014 至 CR-019。
- 验证结果：审查时 `npm run test:scheduler`、`LOG_LEVEL=silent npm test`、`npm run typecheck`、`npm run build` 和 `npm run test:e2e` 通过；当时真实 PostgreSQL 因本机服务未启动而阻塞，后续第四版第一阶段已补充 PostgreSQL `9 passed`、迁移与数据库 session `4 passed` 以及迁移幂等证据。
- 后续影响：全量代码审查改为每个大版本全部阶段完成后执行一次；阶段内继续使用 TDD、最窄回归和必要的独立复核，不重复维护整版审查计划。

## 2026-07-11 第四版第一阶段：数据与服务边界

- 原计划：`docs/plan/第四版第一阶段计划.md`
- 完成提交：`a591cf4 feat(第四版): 完成数据与服务边界治理`；未 push。
- 完成内容：PostgreSQL 调度输入、正式排考和草稿监考教师均采用关联表优先、JSONB 兼容回退；迁移检查覆盖关键关联表、主键、外键和 JSONB 双向一致性；API 新增排考运行、草稿治理和发布治理 service/use-case 层，route 主要保留鉴权、参数解析与 HTTP 错误映射；PostgreSQL 同一草稿的调整、校验、锁定、解锁、再平衡、发布和废弃通过 advisory lock 串行化，锁和业务 SQL 共用同一专用连接，异常时先排空已入队查询再解锁和释放连接，终态转换继续使用可编辑状态 CAS，避免连接池耗尽、连接复用污染、终态回退、终态后变更和并发重复发布。
- 测试过程：先用真实 PostgreSQL 红灯复现正式排考详情仍读取 JSONB，并用迁移测试证明约束/双向一致性检查缺失；排考、草稿和发布 service 均先以模块不存在或业务短路缺失形成红灯；独立审查后再以红灯复现终态草稿可被重新校验、关联表多余行未被检测、发布或废弃完成后锁状态仍可变更、终态转换领先时校验仍返回成功，以及单连接池下草稿 mutation 无法完成和失败查询后的尾部查询未受控，随后完成修复和回归；另通过主动删除关联行证明调度输入、正式排考、教师已发布查询和草稿读路径会回退 JSONB 兼容字段。
- 范围边界：保留 JSONB 兼容字段、演示 Bearer token、Python scheduler CLI、HTTP 轮询和 API 进程内 `setTimeout()` 作业执行；未引入真实队列、SSE/WebSocket、FastAPI scheduler、真实用户/会话、教师二阶段优化、规模基准或 Web 大改造。
- 验证结果：`npm run typecheck` 通过；`LOG_LEVEL=silent npm test` 通过，API 测试结果为 `44` 个通过；`npm run build` 通过；`npm run test:scheduler` 通过，调度器测试结果为 `42 passed`；真实 PostgreSQL 集成测试结果为 `9 passed`；迁移与数据库 session 检查结果为 `4 passed`；正式迁移入口返回 `applied: []`；`git diff --check` 通过。
- 后续影响：第四版第二阶段可以在数据读路径和 API 业务边界稳定的基础上推进教师分配优化、规模基准与增量重排语义；真实队列、实时进度和 scheduler 服务化仍按设计暂缓。

## 2026-07-11 第四版第二阶段：算法升级与规模验证

- 原计划：`docs/plan/第四版第二阶段计划.md`。
- 完成提交：`7c76ac6 feat(第四版): 启动第二阶段并建立重排合同`、`cfd1800 feat(调度器): 添加二阶段教师分配优化`、`bc386ac feat(调度器): 添加增量重排稳定性`、`b476d9a feat(API): 贯通增量重排请求合同`、`62a5e1b feat(调度器): 建立规模基准验证`；均为本地提交，未 push。
- 完成内容：新增 shared/Python `reschedule_context` 合同及 CLI 解析；以独立教师 CP-SAT 替换生产贪心路径，覆盖固定教师、不可用时间、同时间唯一、负载和连续监考目标；实现冻结 room-slot-teacher、可移动考试稳定性目标、稳定性评分与重排报告；同步和异步 API 统一透传重排覆盖对象；新增确定性 witness 规模生成器、benchmark JSON 入口和仓库脚本。
- 算法优化：连续监考从“考试对 × 教师”收敛为“相邻时段对 × 教师”；教师负载目标加入最大负载、最小负载和极差，50、100、150 场最终极差均为 1。
- 规模证据：固定 seed `20260711`、30 秒上限下，50、100、150 场均为 `feasible` 且冲突数为 0；收尾运行耗时分别为 305、437、732 ms，候选数分别为 228、456、684。环境和任务 5 原始输出见 `docs/background/第四版算法规模验证记录.md`。
- 验证结果：`npm run test:scheduler` 为 `73 passed`；`npm run typecheck` 通过；`LOG_LEVEL=silent npm test` 为 API `48 passed`；`npm run build` 通过；真实 PostgreSQL 集成测试为 `9 passed`；`git diff --check` 通过。
- 范围边界：规模 profile 显式关闭 `teacher_consecutive_invigilation`，该目标由专项测试覆盖；固定 100 分制在大规模下饱和到 0，尚未提供跨批次归一化评分；未改 Web 交互、数据库 schema、队列、实时进度、真实认证或 scheduler 部署形态。
- 后续影响：第四版第三阶段转向演示环境和体验增强，第四阶段建立 CI 质量门禁；第四版全部阶段结束后再执行一次全量代码审查。

## 2026-07-12 第四版第三阶段：演示环境与体验增强

- 原计划：`docs/plan/第四版第三阶段计划.md`。
- 完成提交：`1284b66 feat(第四版): 建立草稿增量重排合同（任务 1/6）`、`95bac27 feat(Web): 接入草稿增量重排体验（任务 2/6）`、`cbd6912 feat(部署): 建立全栈演示基线（任务 3/6）`、`0d6e166 test(E2E): 建立双模式演示验收（任务 4/6）`；运行手册与阶段收尾见本条记录所在提交，均为本地提交，未 push。
- 完成内容：API service 将草稿基准安排与锁定集合转换为调度器级 `reschedule_context`，创建独立运行并返回 frozen、retained、changed 摘要；Web 草稿工作台新增生成重排版本入口和稳定性摘要，保持来源草稿不变；新增 `/ready` 仓储就绪检查和 PostgreSQL 真实查询。
- 演示环境：API 镜像内置 Node.js、Python 3.12、uv 和 scheduler 环境；Compose 按 PostgreSQL、迁移、seed、API、Web 顺序启动；新增 `demo:up`、`demo:down`、`demo:reset`、`demo:smoke`，并以独立命名卷隔离历史 PostgreSQL 数据。
- 浏览器证据：Playwright 显式区分自启内存服务与外部 Compose 服务，默认不复用未知旧服务；异步作业场景绑定自己创建的 `jobId`；`test:e2e:demo` 从空卷运行 smoke 和全部浏览器场景，默认通过 trap 清理容器、网络和演示卷。
- 验证结果：`npm run typecheck`、`npm run build` 通过；`LOG_LEVEL=silent npm test` 为 `54 passed`；`npm run test:scheduler` 为 `73 passed`；真实 PostgreSQL 集成为 `9 passed`，迁移测试为 `4 passed`，正式迁移入口从空 schema 应用 `0000` 至 `0007`；本地与 Compose Playwright 均为 `3 passed`；demo smoke 返回 `storage=postgres`、6 条安排、硬冲突 0，并证明 API 重启后运行记录仍可读取；`git diff --check` 通过。
- 范围边界：保留演示 Bearer token、API 进程内异步作业、HTTP 轮询和 scheduler JSON CLI；未引入真实认证、持久化队列、SSE/WebSocket、独立 scheduler 服务或 CI；JSONB 兼容字段和跨批次评分边界保持不变。
- 后续影响：第四版第四阶段只建立类型检查、测试、构建、PostgreSQL、迁移和 E2E 的 CI 质量门禁；第四版全部阶段完成后再执行一次全量代码审查。

## 2026-07-12 第四版第四阶段：CI 质量门禁与交付收尾

- 原计划：`docs/plan/第四版第四阶段计划.md`。
- 完成提交：`533619d ci(第四版): 建立自动质量门禁`；阶段文档收尾见本条记录所在提交。
- 托管证据：[GitHub Actions CI #1](https://github.com/steven123397/ExamForge/actions/runs/29181104234) 在提交 `533619d` 上完成，快速门禁、PostgreSQL 与迁移门禁、Compose 与 Playwright 门禁均成功。
- 完成内容：新增 `scripts/ci/check-repository.mjs` 和 7 个临时 Git 仓库测试场景，检查禁止跟踪产物、中文 Conventional Commits、实际提交区间与空白错误；新增 `.github/workflows/ci.yml`，全部 `push`、PR 和手动触发运行快速门禁，`main` 的 `push` 与手动触发在快速门禁后并行运行 PostgreSQL 和完整演示门禁。
- 工程治理：工作流固定官方 action 发布 SHA，使用 `contents: read`、分支级并发取消和作业超时；PostgreSQL 门禁使用干净 PostgreSQL 16 service；完整演示以 run ID 隔离 Compose project，失败时收集 7 天诊断产物并清理容器、网络和卷；scheduler 验证增加 `uv --frozen` 锁文件约束。
- 本地验证：`npm run test:ci` 为 `7 passed`；`npm run check:ci`、`actionlint 1.7.12 .github/workflows/ci.yml`、`npm run typecheck` 和 `npm run build` 通过；API 为 `54 passed`，scheduler 为 `73 passed`；迁移测试为 `4 passed`，8 个迁移首次全部应用、第二次应用数为 0，正式迁移入口返回 `applied: []`，PostgreSQL 集成为 `9 passed`；隔离 Compose smoke 返回 `storage=postgres`、6 条安排和硬冲突 0，Playwright 为 `3 passed`。
- 范围边界：未引入自动发布、镜像推送、生产部署、远端 secrets 或分支保护；CR-002、CR-003、CR-007、CR-008 保持原状态，Bearer token、进程内异步作业、HTTP 轮询、scheduler CLI、JSONB 兼容字段和跨批次评分边界未改变。
- 后续影响：第四版四个阶段全部完成；下一步按大版本节奏执行一次全量代码审查，发现写入 `docs/status/code_review_status.md`，修复另建活动计划。

## 2026-07-12 第四版完成后全量代码审查

- 原计划：`docs/plan/全量代码审查计划.md`。
- 审查基线：`HEAD` 与 `origin/main` 均为 `2320fbdfbe2e1cd9c1be4d1d67b807f7ce0017db`；保留审查前已有的服务器勘察、第五版设计、第五版第一阶段计划、索引和状态文档修改。
- 完成内容：按计划覆盖调度算法、约束、评分、增量重排和规模基准；API/service、认证护栏、状态机和审计；PostgreSQL 仓储、事务并发、八个迁移、关联表和 shared 合同；Web 数据流、角色边界、关键工作流、错误状态、响应式和可访问性；单元、集成、迁移、E2E、CI、依赖、Compose、演示脚本和文档一致性。理解代码时先使用 CodeGraph，再以文件和运行证据补充。
- 审查结论：复核 CR-002、CR-003、CR-007、CR-008 仍成立，CR-014 至 CR-019 未发现回归；新增 CR-020 至 CR-027。详细证据和建议统一维护在 `docs/status/code_review_status.md`，当前问题共 12 个，分布为 P0 2 个、P1 3 个、P2 6 个、P3 1 个。
- 验证结果：CI 治理脚本 7 passed，仓库检查、类型检查、API/服务测试 54 passed、scheduler 73 passed、生产构建通过；50/100/150 场 benchmark 均 feasible、0 冲突，耗时 262/403/676 ms，教师负载极差均为 1。隔离 PostgreSQL 16 中迁移测试 4 passed、迁移检查无缺失、正式迁移无待应用、集成测试 9 passed；隔离 Compose 空卷 smoke 和 Chromium E2E 3 passed 并完成清理。`npm audit` 的 2 个 moderate 公告仍归入 CR-002；本机未安装 `actionlint`，未重复其本地静态检查。
- 范围边界：本轮只审查、不修复，没有修改业务代码、测试、迁移、依赖、CI 或部署配置，没有创建整改计划、启动第五版、提交或推送。
- 后续影响：先由用户确认审查结论，再为 P0/P1 和关联 P2 建立独立整改计划；阻塞问题处置并取得回归证据后，才可启动 `docs/plan/第五版第一阶段计划.md`。

## 2026-07-12 第四版完成后全量审查整改

- 原计划：`docs/plan/第四版完成后全量审查整改计划.md`。
- 完成内容：按严重度和依赖顺序修复 CR-020 至 CR-027。发布资格统一要求可行、零硬冲突且考试任务与安排一一对应；内部运营 GET 统一要求有效 Bearer token，公开发布查询保留匿名白名单；API、Python 和 PostgreSQL 统一跨资源时段引用校验并隐藏 SQL 完整性细节；连续考试/监考统一为同日相邻场次；草稿建议增加请求代次与上下文双重校验；运营历史面板分别展示错误与重试；发布、回滚、废弃和删除统一进入原生确认对话框；草稿矩阵改为原生表格语义，全局异步错误进入 polite live region。
- 测试过程：每项先取得可复现红灯，再完成最窄实现与风险相关回归。浏览器红灯覆盖旧建议响应修改错误考试、四类历史接口失败被渲染为空数据、四类高影响操作首次点击立即发请求，以及不完整 `role=grid`；API、scheduler 和 PostgreSQL 红灯覆盖不可行/不完整发布、缺失时段引用、SQL 错误泄露和跨日连续误罚。最终 Compose 首次运行发现 `demo-smoke.mjs` 匿名读取新受保护内部接口返回 401，补齐 viewer token 后重新从空卷验证通过。
- 既有问题处置：CR-002 的安全 PostCSS override 会使 `npm ls` 返回 `ELSPROBLEMS`，试验改动已撤回，等待 Next 官方依赖更新；CR-003 当前 Docker daemon 代理实际拉取新镜像成功，机器配置未修改；CR-007 和 CR-008 分别等待第五版第三阶段可靠事件/SSE和第二阶段 FastAPI/OpenAPI 合同。四项均保留为暂缓，当前无待解决 P0/P1。
- 验证结果：`npm run test:ci` 为 `7 passed`，`npm run check:ci`、`npm run typecheck`、`npm run build` 和 `git diff --check` 通过；API 为 `62 passed`，scheduler 为 `78 passed`；50、100、150 场 benchmark 均 feasible、0 冲突，耗时 246、412、724 ms，教师负载极差均为 1。隔离 PostgreSQL 迁移测试为 `4 passed`、迁移检查无缺失或双向不一致、正式迁移无待应用、集成测试为 `11 passed`；独立 Compose smoke 通过 API 重启持久化检查，Chromium E2E 为 `14 passed`，测试容器、网络、卷和隔离 PostgreSQL 均已清理，原演示栈未修改。
- 交付边界：未提交或推送，未开始第五版；整改结论等待用户确认。
- 后续影响：用户确认后可启动 `docs/plan/第五版第一阶段计划.md`；CR-002、CR-003、CR-007、CR-008 按各自重评条件继续维护在代码审查状态文档。

## 2026-07-12 第五版第一阶段：合同、数据与身份基础

- 原计划：`docs/plan/第五版第一阶段计划.md`。
- 完成提交：`63afc36 feat(第五版): 完成合同数据与身份基础`；本地提交，未 push。
- 完成内容：统一作业状态为 `queued`、`running`、`succeeded`、`failed`、`cancelled`、`timed_out`，新增作业尝试、持久化事件和 outbox，并以请求摘要、幂等键和原子终态防止重复运行；删除教师不可用、考试学生群体、正式监考和草稿监考四类旧 JSONB 列，关联表成为唯一事实源；新增用户、角色、用户角色和服务端会话，使用 scrypt 随机盐、会话摘要、HttpOnly Cookie、可信 Origin 和真实 actor 审计；Web 移除演示 Bearer token 与角色切换，管理员/排考员进入运营台，教师/学生进入受限已发布门户；形成第五版前端信息架构与视觉规范，并整理现有原型的基础设计 token、焦点和窄屏行为。
- 迁移与数据库证据：可丢弃 PostgreSQL 16 中迁移测试 `5 passed`，12 个迁移首次全部应用、第二次应用数为 0；第四版 `completed` 作业升级为 `succeeded`，四类关系漂移会在删列前拒绝迁移，迁移检查确认旧关系列为空、关键表和约束无缺失、关联数据无双向不一致；正式迁移入口返回 `applied: []`，真实 PostgreSQL 集成测试 `13 passed`。
- 应用与算法证据：`npm run test:ci` 为 `7 passed`，`npm run check:ci`、`npm run typecheck`、`LOG_LEVEL=silent npm test`（shared `9 passed`、API/服务共 `70 passed`）、`npm run test:scheduler`（`78 passed`）和生产构建通过。固定 seed 的 50、100、150 场 benchmark 均 feasible、0 冲突，耗时 419、767、1199 ms，教师负载极差均为 1。
- 浏览器与视觉证据：隔离 Compose/PostgreSQL smoke 完成真实登录、排考、持久化读取和 API 重启检查，Chromium E2E `17 passed`；桌面登录、1600 px 管理员页面和 375 px 教师门户截图均非空，桌面和移动页面宽度等于视口，移动端未发现可见溢出元素。临时 Compose 项目、网络和卷均在验证后清理，用户原有演示栈未修改。
- 范围边界：未实现 Redis/BullMQ、Outbox Publisher、独立 Worker、FastAPI scheduler、SSE/WebSocket、完整任务中心或全量前端路由重构；API 仍以进程内执行器调用 Python CLI，Web 仍轮询作业状态。CR-002、CR-003、CR-007、CR-008 继续按审查状态文档维护。
- 后续影响：下一阶段按 `docs/plan/第五版第二阶段计划.md` 将 scheduler 服务化；只处理 FastAPI、OpenAPI、HTTP 客户端、故障合同和独立容器，不提前混入可靠队列与实时事件。

## 2026-07-13 第五版第二阶段：Scheduler 服务化

- 原计划：`docs/plan/第五版第二阶段计划.md`。
- 完成提交：`5087066 feat(第五版): 完成第二阶段调度器服务化`；本地提交，未 push。
- 完成内容：抽取 CLI/HTTP 共用的输入解析、语义校验、预检、求解、冲突整理、报告和序列化 pipeline；新增 FastAPI `/health`、`/ready`、`/solve`、稳定错误 envelope、request ID 和完整 Pydantic 网络模型；生成受版本控制的确定性 OpenAPI，并在根脚本与 GitHub Actions 中检查漂移；API 新增运行时校验的 HTTP scheduler 客户端，区分 validation、timeout、cancelled、unavailable、protocol 和 internal，生产 Compose 显式使用 HTTP 且不静默回退 CLI；作业失败保留稳定类别、代码、可重试性和 trace ID。
- 镜像与演示：新增独立 scheduler Dockerfile，使用 UID 10002 非 root 运行并设置 CPU、内存、进程数、停止宽限期和 readiness；API 镜像删除 Python、uv 和 scheduler 源码。Compose 新增 scheduler 健康依赖，smoke 先直连验证健康、可行和不可行结果，再以真实 Cookie 会话完成 HTTP 排考、PostgreSQL 持久化和 API 重启读取。
- 合同与故障证据：固定可行、不可行、固定安排和增量重排样例证明 CLI、HTTP 与 application pipeline 规范化输出等价；API 客户端测试覆盖合同错误、业务不可行、超时、取消、服务不可用、非 JSON、schema 漂移和内部错误，不泄露请求输入或内部异常。scheduler 镜像 `/health`、`/ready` 均为 200、版本 `0.1.0`，容器 UID 为 10002；API 镜像探针确认不存在 Python 和 uv。
- 性能证据：固定 seed `20260711`、30 秒上限下，直接 benchmark 的 50、100、150 场均 feasible、0 冲突，耗时 328、743、1183 ms；本机 HTTP benchmark 的 solver 耗时为 363、619、1099 ms，端到端耗时为 386、628、1109 ms，协议开销为 23、9、10 ms。仅记录单机单请求实测，不宣称并发容量或全局最优。
- 全量验证：`npm run test:ci` 为 `7 passed`，`npm run check:ci`、`npm run typecheck`、`npm run check:scheduler-openapi` 和生产构建通过；shared `10 passed`、API/服务 `80 passed`、scheduler `93 passed`，scheduler 测试存在 1 条 FastAPI `TestClient` 上游弃用警告。可丢弃 PostgreSQL 16 中迁移测试 `5 passed`、12 个迁移首次全部应用且二次应用 0、迁移检查无缺失或双向不一致、正式迁移无待应用、真实集成测试 `13 passed`。隔离 Compose smoke 通过，Chromium E2E `17 passed`；临时容器、网络、卷和独立数据库均已清理，用户原有演示栈未修改。
- 审查处置：CR-008 已移入已解决索引并记录服务化、合同、镜像和进程间证据；CR-007 仍保持暂缓，不能用同步 HTTP 服务替代可靠队列或实时事件结论。
- 范围边界：未引入 Redis/BullMQ、Outbox Publisher、独立 Worker、可靠重试、SSE/WebSocket、完整任务中心或前端页面级重构；作业仍由 API 进程内执行器领取，Web 仍轮询。HTTP 取消只中止调用方等待，不宣称可强制终止已进入 OR-Tools 的线程。
- 后续影响：下一阶段按 `docs/plan/第五版第三阶段计划.md` 实施可靠任务与实时事件；腾讯云私有试部署必须在用户单独授权后进行，不自动开始第三阶段。

## 2026-07-13 第五版第三阶段：可靠任务与实时事件

- 原计划：`docs/plan/第五版第三阶段计划.md`。
- 完成提交：`11b0336 feat(第五版): 完成可靠调度与多角色工作台`；本地提交，未 push。
- 完成内容：新增可靠作业迁移、严格事件序列、请求快照、attempt 和 outbox 投递元数据；抽取 `packages/scheduling-application` 统一幂等提交与执行状态机；API 改为事务提交，独立 Publisher 通过 `FOR UPDATE SKIP LOCKED` 投递 BullMQ，独立 Worker 调用 FastAPI scheduler，并以数据库 CAS、稳定 job ID 和唯一约束治理重复投递、重试、取消、超时、stalled 回收与迟到结果。
- 实时事件：SSE 以 PostgreSQL 历史为准，支持初始补发、`Last-Event-ID`、订阅窗口二次回读、Redis 唤醒、心跳和终态关闭；Web 已移除 1200 ms 主轮询，以 SSE 更新 TanStack Query cache，仅在断线期间执行不低于 5 秒的兜底查询。
- 部署与故障证据：Compose 新增 AOF、`noeviction` Redis，以及独立非 root Publisher/Worker、健康检查和资源限制。隔离 Compose 从空卷完成 API 重启、SSE 重连、Redis 停止恢复、Publisher 重启、Worker 崩溃回收、scheduler 不可用重试和重复 outbox；各场景最终只生成 1 个运行，Worker 崩溃由第 2 个 attempt 回收，scheduler 不可用前 2 个 attempt 失败后第 3 个成功，重复 outbox 未增加作业 attempt 或运行。
- 全量验证：`npm run test:ci` 为 `7 passed`；仓库检查、类型检查、OpenAPI 漂移检查和生产构建通过；shared `12 passed`、scheduling application `8 passed`、API `83 passed`、Web `3 passed`、真实 PostgreSQL/Redis Worker `14 passed`、scheduler `93 passed`。13 个迁移从空库首次全部应用且二次应用 0，迁移检查无缺失或不一致，正式迁移无待应用，PostgreSQL 集成测试 `16 passed`；隔离 Compose smoke 全部故障场景通过，Chromium E2E `21 passed`。
- 审查处置：CR-007 已移入已解决索引；可靠队列、持久化事件、可补发 SSE 和浏览器断线证据齐全。CR-002、CR-003 状态不变。
- 范围边界：运行中取消仍为协作式尽力语义；未实现完整任务中心、约束策略版本、归一化评分、方案实验室或页面级前端重构。腾讯云私有试部署因未取得目标主机、凭据和维护窗口的单独授权而未执行，本地 Compose 结果不冒充远程结论。
- 后续影响：下一阶段按 `docs/plan/第五版第四阶段计划.md` 实施任务治理页面、约束策略版本与运行快照、归一化评分和确定性诊断；不自动开始第四阶段。

## 2026-07-13 第五版第四阶段：任务中心与约束策略基础

- 原计划：`docs/plan/第五版第四阶段计划.md`。
- 完成提交：`11b0336 feat(第五版): 完成可靠调度与多角色工作台`；本地提交，未 push。
- 完成内容：新增策略身份和不可变版本、启停、CAS 新版本、唯一默认版本、稳定摘要和真实 actor 审计；API 在作业创建事务内解析策略，作业 v2 请求与运行结果冻结同一版本、完整配置和摘要，Worker 不读取可变策略；同步排考和草稿重排也把实际调用策略与 scheduler 元数据传入运行持久化。迁移为旧数据生成显式 legacy 快照，幂等摘要覆盖策略语义。
- 评分与诊断：shared、Python 和 OpenAPI 固定评分合同 v1，同时保留违反次数、原始/加权惩罚、适用机会数、归一化分项和归一化总分；零机会、舍入和等比例规模样例由跨语言测试锁定。结构化诊断覆盖容量、时段、教师、固定安排、学生群体、引用错误和求解不可行，可行性与发布资格不被数值分数覆盖。
- 运营体验：现有根路由新增任务中心与策略治理区。任务中心支持状态、提交人、策略、日期筛选、8 条分页，并通过仅管理员/排考员可读的详情接口展示 PostgreSQL 持久化的 attempt 和完整有序事件，不从摘要时间戳伪造重试轨迹；同时保留 SSE 状态、错误解释、取消和运行跳转。策略区支持创建、不可变新版本、启停、默认切换、权重、硬规则与求解时限，禁用和默认切换均要求确认。任务中心按容器宽度切换单/双栏；桌面 1440 x 960 和移动 390 x 844 的页面宽度均为 0 溢出，新增检查器边界断言并经截图复核确认无裁切或重叠。
- 真实追溯证据：当前预览策略版本 `constraint-profile-ec00ca07-ff86-4885-86a1-9588da90724b-v1` 的摘要为 `3e45d0c6aa33...`；作业 `job-b72d45c2-a9f6-4c3e-8950-a39b13dab167` 与运行 `run-9dffc018-33d0-4f6d-b2d7-aabb28dbd84e` 使用同一版本和摘要，1 个 attempt、5 个事件、1 个运行，scheduler 版本 `0.1.0`。默认策略 v1 摘要为 `39a0920fd0df...`。
- 故障证据：独立 Compose 从空卷完成 API/SSE 重连、Redis 停止恢复、Publisher 重启、Worker stalled、scheduler 暂停恢复和重复 outbox。当前预览 scheduler 故障作业第 1 个 attempt 为 `unavailable/scheduler_unavailable`，第 2 个成功，共 8 个事件、1 个运行；Worker stalled 由第 2 个 attempt 回收，共 8 个事件、1 个运行；重复 outbox 未增加 attempt 或运行。
- 全量验证：`npm run test:ci` 为 `7 passed`；仓库检查、类型检查、OpenAPI 漂移检查、生产构建、Compose 配置和 `git diff --check` 通过；shared `15 passed`、scheduling application `11 passed`、API `85 passed`、Web `7 passed`、真实 PostgreSQL/Redis Worker `14 passed`、scheduler `97 passed`。14 个迁移首次全部应用且二次应用 0，迁移测试 `8 passed`、迁移检查无缺失或快照不一致、正式迁移无待应用、PostgreSQL 集成测试 `18 passed`；6 组 Compose 故障演练和 Chromium E2E `22 passed`。
- 审查处置：本阶段未发现新代码审查问题，也未解决 CR-002、CR-003；问题明细保持 2 项暂缓，无待解决 P0/P1。
- 范围边界：未实现真实页面路由、教师/学生服务端作用域、多策略批量实验、Pareto 比较、自动策略推荐或第六阶段部署。腾讯云与其他远程服务器未操作，本地证据不替代远程结论。
- 后续影响：下一阶段按 `docs/plan/第五版第五阶段计划.md` 先补本人作用域，再拆分真实路由、角色工作区、草稿拖拽和视觉/可访问性门禁；不自动开始第五阶段。

## 2026-07-14 第五版第五阶段：前端路由重构与多角色体验

- 原计划：`docs/plan/第五版第五阶段计划.md`。
- 完成提交：`11b0336 feat(第五版): 完成可靠调度与多角色工作台`；本地提交，未 push。
- 本人作用域：新增 `0014_user_audience_scopes.sql`、教师单作用域和学生多群体作用域，演示账户通过 seed 建立正式关联。`/api/me/audience`、本人已发布日程和教师本人不可用时段 API 只根据服务端会话解析对象；旧按教师/学生群体 ID 的发布查询不再匿名，管理员/排考员预览与教师/学生本人入口明确分离。
- 路由与权限：建立全局 AuthProvider、角色路由守卫、运营侧栏和受众顶栏；登录、管理员概览、基础数据、作业、运行、草稿、策略、审计、教师和学生十个路由均可深链刷新。筛选、分页、对比和选中对象进入 URL，匿名深链安全回跳，错误角色为 403，不存在页面或实体为 404，会话失效清理私有 Query cache。
- 运营工作流：第四阶段任务中心、SSE、持久化 attempt/事件和策略治理合同直接迁入 `/scheduling/jobs`、`/scheduling/policies`，没有复制任务状态机；运行、对比、发布/回滚和审计迁入独立页面。草稿唯一编辑入口使用 dnd-kit pointer/keyboard sensor，同时保留检查器表单等价路径，锁定、终态和建议响应代次继续阻断无效 mutation。
- 受众工作区：教师本人页展示下一场监考、按日期日程和不可用时段维护；学生本人页只展示所属群体考试，不泄露教师负载、内部冲突或策略事实。scope 缺失、未发布、空日程、会话失效和 API 失败均有稳定状态，375 x 812 视口无页面级横向溢出。
- 视觉与可访问性：全局样式拆分为 token、布局和表单层，受众页面使用 feature CSS module；补齐跳到主内容、可见焦点、语义列表、图标标签、对比度和 reduced motion。Playwright 固定四种视口并保存 6 张 Linux Chromium 基线；Axe 扫描覆盖登录和关键角色页面，另有 200% 文本、长内容、403、404、依赖失败、键盘拖拽和溢出专项断言。人工复核桌面/移动截图未发现裁切、重叠或不可达操作。
- 真实故障证据：独立 Compose 从空卷完成四角色登录、本人 scope、作业、SSE、策略、运行、草稿和发布查询。API 重启、Redis 停止恢复和 Publisher 重启均保持 1 个 attempt、5 个事件、1 个运行；Worker 崩溃与 scheduler 暂停均由第 2 个 attempt 恢复，保持 8 个有序事件和 1 个运行；重复 outbox 未增加 attempt、业务事件或运行。
- 全量验证：`npm run test:ci` 为 `7 passed`；仓库检查、类型检查、OpenAPI 漂移检查、生产构建、Compose 配置和 `git diff --check` 通过；shared `21 passed`、scheduling application `11 passed`、API `91 passed`、Web `21 passed`、真实 PostgreSQL/Redis Worker `14 passed`、scheduler `97 passed`。15 个迁移首次全部应用且二次应用 0，迁移测试 `9 passed`、迁移检查无缺失或不一致、正式迁移无待应用、PostgreSQL 集成测试 `21 passed`；最终 Playwright 共 35 项，为 `32 passed, 3 skipped`。
- 清理与边界：本轮隔离 Compose 的容器、网络和卷均已删除，用户已有演示栈未修改。`npm audit` 仍有 2 个 PostCSS moderate 公告并继续归入 CR-002；CR-003 状态不变。未操作腾讯云或其他远程服务器，未实现镜像发布、生产 Compose、HTTPS、异机备份、线上监控或回滚。
- 后续影响：下一阶段按 `docs/plan/第五版第六阶段计划.md` 先处置生产依赖安全，再建立发布物和本地生产门禁；取得目标主机、域名、镜像仓库、凭据和维护窗口授权后，才执行腾讯云正式部署与交付收尾。
