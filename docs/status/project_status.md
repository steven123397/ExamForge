# ExamForge 项目状态

## 当前结论

项目已完成正式需求分析、总体设计、第一版实现内容设计、可行性分析和第二版四个实现阶段。第一版 `apps/scheduler/` Python 排考算法原型的核心模块已合并到 `main`，包括数据模型、测试数据生成、预检、冲突解释、硬约束求解器、软约束评分和报告整理。第二版已形成“自动排考 → 异步作业 → 方案草稿 → 人工调整/锁定/局部再平衡 → 硬约束校验 → 对比确认 → 发布/废弃 → 查询/通知/导出”的人机协同排考闭环，并补齐浏览器级交互验收、课程报告终稿、部署说明和演示脚本。

存留问题、代码审查发现、风险和技术债统一维护在 `docs/status/code_review_status.md`；本文只维护开发进度、已实现内容、验证结果和下一步。

## 最新进展

- 日期：2026-07-06
- 变更：Agent A 已完成调度器数据模型与测试数据生成器，并形成本地提交 `ff195cb feat(调度器): 添加数据模型与测试数据生成器`。
- 变更：文档治理规则改为简化版单一事实源，完成计划统一沉淀到 `docs/plan/history_plan.md`，不使用专门归档目录。
- 变更：Agent B、Agent C、Agent D 三条并行实现分支已合并到 `main`。
- 变更：Agent B 实现 `run_precheck()` 和 `detect_assignment_conflicts()`。
- 变更：Agent C 实现 `solve_schedule()` 并引入 OR-Tools CP-SAT。
- 变更：Agent D 实现 `calculate_score()` 和 `build_schedule_report()`。
- 变更：已新增 `docs/design/企业级全栈平台第一阶段设计.md` 和 `docs/plan/企业级全栈平台第一阶段计划.md`，明确下一阶段不再局限于课程最小实现。
- 变更：已创建 npm workspace、`packages/shared`、`packages/db`、`apps/api` 和 `apps/web`，形成 Web/API/数据层/调度器的第一条企业级闭环。
- 变更：`apps/scheduler` 已新增 JSON CLI，Fastify API 可以通过 stdin/stdout 调用 Python 调度器。
- 变更：Next.js 运营台已提供批次概览、排考运行、结果列表、冲突解释、资源利用率和教师工作量视图。
- 变更：API 已新增仓储工厂，存在 `DATABASE_URL` 时切换到 PostgreSQL 持久化仓储，未配置时继续使用内置演示仓储。
- 变更：PostgreSQL 仓储已覆盖批次/基础数据读取、排考运行写入、排考结果读取、冲突记录和审计事件写入；`packages/db` seed 已从 JSON 摘要升级为真实入库脚本。
- 变更：本机 WSL2 已启用 Docker daemon 和 Docker Compose，`examforge-postgres` 容器已启动并通过健康检查。
- 变更：API 已新增基础数据创建和更新入口，覆盖学生群体、教师、课程、考场、时间段和考试任务；运营台已新增课程、教师、考场的基础数据编辑面板。
- 变更：API 已新增基础数据删除和批量导入入口；运营台基础数据管理已扩展到学生群体、教师、课程、考场、时间段和考试任务，并支持单条删除和 JSON 批量导入覆盖。
- 变更：API 已新增排考运行历史、审计事件列表和排考运行版本对比接口；运营台已新增运行历史、版本对比摘要和审计详情面板。
- 变更：API 已新增排考方案发布、当前发布方案查询和发布回滚接口；PostgreSQL `exam_batches` 已增加 `published_run_id` 字段，运营台运行历史已支持发布标记和回滚操作。
- 变更：API 已新增教师和学生群体维度的已发布排考查询接口；运营台已新增“已发布查询”面板，可按教师或学生群体查看课程、时间、考场和监考教师。
- 变更：已新增 `docs/design/第二版实现内容设计.md` 和 `docs/plan/第二版方案草稿工作台第一阶段计划.md`，第二版主线聚焦人机协同排考、草稿版本、人工调整、硬约束校验和发布治理。
- 变更：API 已新增排考草稿接口，支持从 `schedule_runs` 创建草稿、读取草稿列表和详情、调整单场考试安排、重新校验、对比来源运行，以及在无硬冲突时发布草稿。
- 变更：内存仓储和 PostgreSQL 仓储已新增草稿模型、草稿安排、草稿冲突和草稿变更事件；新增迁移 `packages/db/drizzle/0003_schedule_drafts.sql`。
- 变更：人工调整校验已覆盖考场时间唯一、学生群体时间唯一、教师时间唯一、教师不可用、考场容量、考场类型、设备要求、允许时间段和监考教师数量。
- 变更：运营台已新增“方案工作台”，支持创建草稿、读取草稿、通过时间段 × 考场矩阵选择考试、表单调整时间/考场/监考教师、展示冲突和变更记录，并在无冲突时发布草稿。
- 变更：第二版方案草稿工作台第一阶段已形成本地提交 `4154b61 feat(第二版): 添加方案草稿工作台闭环`。
- 变更：第二版第一阶段计划已归入 `docs/plan/history_plan.md`，并曾创建第二版方案草稿工作台第二阶段计划作为后续执行计划。
- 变更：第二版方案草稿工作台第二阶段已实现草稿废弃、废弃后禁止调整/发布、发布后禁止调整、草稿相对来源运行和当前发布版本的对比摘要。
- 变更：运营台方案工作台已新增发布确认面板，展示相对来源变化、相对发布变化、硬冲突数量、最近调整数量和最近 10 条调整记录，并对已发布/已废弃草稿禁用调整入口。
- 变更：已新增 `docs/background/第二版人机协同排考报告素材.md`，沉淀人机协同流程、草稿状态迁移、硬约束校验策略、测试结论和关键取舍。
- 变更：第二版方案草稿工作台第二阶段计划已归入 `docs/plan/history_plan.md`。
- 变更：第二版方案草稿工作台第三阶段计划已归入 `docs/plan/history_plan.md`，第三阶段聚焦拖拽式矩阵调整、单场局部调整建议、建议应用和报告图示材料。
- 变更：第三阶段主体已实现局部调整建议 API、建议生成服务、Web 建议面板、一键应用建议和矩阵拖放提交调整。
- 变更：已引入 Playwright 和 Chromium 浏览器验收，新增 `npm run test:e2e`，覆盖方案工作台建议应用和鼠标拖拽矩阵调整路径。
- 变更：课程报告素材已追加 Mermaid 流程图、草稿状态图、第三阶段演示脚本和测试结论摘要。
- 变更：第四阶段已实现异步排考作业 API 和 Web 轮询展示，支持作业队列、进度、完成状态和生成的运行版本。
- 变更：第四阶段已实现草稿考试锁定、解锁和局部再平衡 API；锁定考试禁止人工调整，局部再平衡跳过锁定考试。
- 变更：第四阶段已新增轻量角色权限护栏，通过 `x-examforge-role` 区分 `admin`、`operator`、`viewer`，并限制排考、发布、删除、回滚等变更操作。
- 变更：第四阶段已新增教师不可用时间维护 API 和 Web 面板，维护结果继续参与排考草稿硬约束校验。
- 变更：第四阶段已新增已发布排考学生群体通知预览和 CSV 导出 API，并在运营台提供刷新通知和导出入口。
- 变更：已新增 `docs/background/第二版课程报告终稿.md` 和 `docs/background/第二版部署与演示说明.md`，并更新第二版设计文档的增强方向落地边界。
- 变更：第二版增强方向第四阶段计划已归入 `docs/plan/history_plan.md`，第二版设计文档中列出的增强方向已完成轻量闭环实现。
- 变更：CodeGraph 已启用；已新增 `docs/plan/全量代码审查计划.md` 和 `docs/status/code_review_status.md`，后续全量代码审查结果和存留问题状态统一写入 `code_review_status.md`。
- 验证：PostgreSQL 运行路径已完成真实验证，包括按顺序执行 `packages/db/drizzle/*.sql`、运行 `npm run seed --workspace @examforge/db`、API 带 `DATABASE_URL` 读取 dashboard、发起一次排考运行并写入 `schedule_runs`、`scheduled_exams` 和 `audit_events`。
- 验证：当前全栈第一阶段验证包括 `apps/scheduler` 全量测试 `32 passed`、API 测试 `10 passed`、`npm run typecheck` 通过、`npm run build` 通过、`git diff --check` 通过。
- 验证：真实 PostgreSQL API 路径已验证 `POST /api/schedule-runs`、`POST /api/schedule-runs/:id/publish`、`GET /api/published-schedule`、`POST /api/published-schedule/rollback` 和回滚后的 `404` 查询结果；数据库已写入对应 `schedule_run.created`、`schedule_run.published` 和 `schedule_run.rollback` 审计事件。
- 验证：真实 PostgreSQL API 路径已验证 `GET /api/published-schedule/teachers/:teacherId` 和 `GET /api/published-schedule/student-groups/:studentGroupId`，本地已发布版本 `run-362133c8-ab13-4993-b7e1-fed5f1b3d71f` 可返回教师 `t-zhang` 的 4 条安排和学生群体 `g-cs-2301` 的 3 条安排。
- 验证：真实 PostgreSQL API 路径已验证 `POST /api/reference-data/time-slots/import`、同 `id` 覆盖导入、`DELETE /api/reference-data/time-slots/:id` 和删除后的基础数据查询结果。
- 验证：第二版草稿 API 行为测试已覆盖创建草稿、读取草稿列表、人工调整产生硬冲突、硬冲突阻塞发布、修复冲突后发布，并随 `npm test` 通过。
- 验证：第二版第一阶段本轮验证包括 `npm test` 通过、`npm run typecheck` 通过、`npm run build` 通过、`apps/scheduler` 全量测试 `32 passed`、`git diff --check` 通过。
- 验证：第二版第二阶段 API 行为测试已覆盖草稿相对来源和当前发布版本对比、废弃草稿、废弃后禁止调整、废弃后禁止发布和 `schedule_draft.discarded` 审计事件。
- 验证：真实 PostgreSQL API 路径已验证从排考运行创建草稿、制造硬冲突、硬冲突阻断发布、恢复后发布、发布后禁止调整、另一个草稿废弃后禁止发布。
- 验证：第二版第二阶段本轮验证包括 `npm test` 通过，API 测试 `12 passed`；`npm run typecheck` 通过；`npm run build` 通过；`apps/scheduler` 全量测试 `32 passed`；`git diff --check` 通过。
- 验证：第三阶段 API 行为测试已覆盖局部调整建议接口，当前 `npm test` 通过，API 测试 `13 passed`。
- 验证：第三阶段本轮验证包括 `npm run typecheck` 通过；`npm run build` 通过；`apps/scheduler` 全量测试 `32 passed`。
- 验证：本地 dev 服务运行态验证通过，`GET /health` 返回正常，Web 页面可返回“方案工作台”和“局部调整建议”内容，建议接口可返回 8 个候选且首个候选硬冲突数为 0。
- 验证：浏览器级验收已通过，`npm run test:e2e` 在真实 Chromium 中验证方案工作台加载、局部调整建议应用和矩阵鼠标拖拽调整，结果为 `1 passed`。
- 验证：第四阶段 API 行为测试已覆盖异步排考作业、草稿锁定/解锁、局部再平衡、角色权限、教师不可用维护、通知预览和 CSV 导出；`npm test` 通过，API 测试结果为 `16 passed`。
- 验证：第四阶段 `npm run typecheck` 通过。
- 验证：第四阶段 `npm run build` 通过。
- 验证：第四阶段浏览器级验收已通过，`npm run test:e2e` 在 Chromium 中验证草稿锁定/解锁、局部再平衡、矩阵拖拽、异步排考作业和发布通知预览，结果为 `2 passed`。
- 验证：第四阶段调度器回归已通过，`uv run --python 3.12 --extra dev python -m pytest -q` 结果为 `32 passed`。
- 验证：第四阶段 `git diff --check` 通过。

## 下一步

- [x] 建立全量代码审查计划和独立问题状态文档，明确 `project_status.md` 与 `code_review_status.md` 的分工。
- [x] 将 API 内置演示仓储替换为 PostgreSQL 持久化仓储。
- [x] 扩展基础数据管理页面，补齐学生群体、时间段、考试任务编辑和删除/导入能力。
- [x] 增加排考运行历史、版本对比和审计详情。
- [x] 增加方案发布和回滚。
- [x] 增加教师/学生查询已发布安排。
- [x] 增加排考方案草稿、人工调整、硬约束校验、草稿发布治理和方案工作台第一阶段闭环。
- [x] 完成第二版草稿治理第二阶段：真实 PostgreSQL 草稿路径验证、草稿废弃、草稿对比、发布确认面板和课程报告素材。
- [x] 规划第三阶段：拖拽式工作台、局部重排建议、权限审计或报告导出。
- [x] 执行第三阶段：拖拽式矩阵调整、单场局部调整建议、报告图示材料和浏览器级拖拽验收。
- [x] 执行第四阶段：异步排考作业、草稿锁定、局部再平衡、角色权限护栏、教师不可用维护、通知导出和课程交付文档。
- [ ] 执行全量代码审查，并将审查发现写入 `docs/status/code_review_status.md`。
- [ ] 规划第三版或后续企业化阶段：持久化任务队列、真实认证授权、消息投递状态、下载审计、标准迁移执行器和部署监控。
