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
- 范围边界：异步作业为进程内作业表，权限为请求头轻量护栏，通知为预览与导出，不接入生产级队列、SSO、短信、邮件、WebSocket 或外部教务系统。
- 验证结果：`npm test` 通过，API 测试结果为 `16 passed`；`npm run typecheck` 通过；`npm run build` 通过；`npm run test:e2e` 通过，Playwright 结果为 `2 passed`；`uv run --python 3.12 --extra dev python -m pytest -q` 通过，调度器测试结果为 `32 passed`；`git diff --check` 通过。
- 后续影响：第二版设计文档中列出的增强方向已完成轻量闭环实现；后续可进入第三版企业化，优先生产化任务队列、真实认证授权、消息投递状态、下载审计、标准迁移执行器和部署监控。
