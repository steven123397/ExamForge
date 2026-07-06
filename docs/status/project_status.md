# ExamForge 项目状态

## 当前结论

项目已完成正式需求分析、总体设计、第一版实现内容设计、可行性分析和第二版第一阶段。第一版 `apps/scheduler/` Python 排考算法原型的核心模块已合并到 `main`，包括数据模型、测试数据生成、预检、冲突解释、硬约束求解器、软约束评分和报告整理。当前主线已切换为第二版方案草稿工作台第二阶段，在 `main` 上继续完善草稿治理、真实数据库验证、发布确认和课程报告素材。

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
- 变更：第二版第一阶段计划已归入 `docs/plan/history_plan.md`，当前活动计划切换为 `docs/plan/第二版方案草稿工作台第二阶段计划.md`。
- 验证：PostgreSQL 运行路径已完成真实验证，包括按顺序执行 `packages/db/drizzle/*.sql`、运行 `npm run seed --workspace @examforge/db`、API 带 `DATABASE_URL` 读取 dashboard、发起一次排考运行并写入 `schedule_runs`、`scheduled_exams` 和 `audit_events`。
- 验证：当前全栈第一阶段验证包括 `apps/scheduler` 全量测试 `32 passed`、API 测试 `10 passed`、`npm run typecheck` 通过、`npm run build` 通过、`git diff --check` 通过。
- 验证：真实 PostgreSQL API 路径已验证 `POST /api/schedule-runs`、`POST /api/schedule-runs/:id/publish`、`GET /api/published-schedule`、`POST /api/published-schedule/rollback` 和回滚后的 `404` 查询结果；数据库已写入对应 `schedule_run.created`、`schedule_run.published` 和 `schedule_run.rollback` 审计事件。
- 验证：真实 PostgreSQL API 路径已验证 `GET /api/published-schedule/teachers/:teacherId` 和 `GET /api/published-schedule/student-groups/:studentGroupId`，本地已发布版本 `run-362133c8-ab13-4993-b7e1-fed5f1b3d71f` 可返回教师 `t-zhang` 的 4 条安排和学生群体 `g-cs-2301` 的 3 条安排。
- 验证：真实 PostgreSQL API 路径已验证 `POST /api/reference-data/time-slots/import`、同 `id` 覆盖导入、`DELETE /api/reference-data/time-slots/:id` 和删除后的基础数据查询结果。
- 验证：第二版草稿 API 行为测试已覆盖创建草稿、读取草稿列表、人工调整产生硬冲突、硬冲突阻塞发布、修复冲突后发布，并随 `npm test` 通过。
- 验证：第二版第一阶段本轮验证包括 `npm test` 通过、`npm run typecheck` 通过、`npm run build` 通过、`apps/scheduler` 全量测试 `32 passed`、`git diff --check` 通过。

## 当前风险

- 风险：本机默认 `python` 命令不可用，`python3` 为 3.10.12，而调度器配置要求 Python 3.12 及以上。
- 影响：不能在当前默认环境直接运行计划中的裸 `python -m pytest` 命令。
- 处理建议：创建 Python 3.12 虚拟环境并安装 `apps/scheduler` 测试依赖后再运行调度器测试。
- 风险：`npm audit` 仍报告 Next 15.5.20 依赖链中的 2 个 moderate 级 PostCSS 相关公告，npm 给出的自动修复方案会降级到不适合本项目的旧 Next 版本。
- 影响：当前不阻塞本地演示，但后续应跟踪 Next 官方依赖更新。
- 处理建议：保留审计记录，后续升级 Next 或等待其依赖 PostCSS 修复版本。
- 风险：Docker daemon 依赖当前 WSL 到 Windows 代理 `http://172.22.112.1:7897` 拉取 Docker Hub 镜像。
- 影响：如果 Windows 代理端口或地址变化，后续重新拉取镜像可能失败；已存在的 `postgres:16-alpine` 镜像和容器不受影响。
- 处理建议：代理变化时同步更新 `/etc/systemd/system/docker.service.d/proxy.conf` 并重启 `docker.service`。

## 下一步

- [x] 将 API 内置演示仓储替换为 PostgreSQL 持久化仓储。
- [x] 扩展基础数据管理页面，补齐学生群体、时间段、考试任务编辑和删除/导入能力。
- [x] 增加排考运行历史、版本对比和审计详情。
- [x] 增加方案发布和回滚。
- [x] 增加教师/学生查询已发布安排。
- [x] 增加排考方案草稿、人工调整、硬约束校验、草稿发布治理和方案工作台第一阶段闭环。
- [ ] 完成第二版草稿治理第二阶段：真实 PostgreSQL 草稿路径验证、草稿废弃、草稿对比、发布确认面板和课程报告素材。
