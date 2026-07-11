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
