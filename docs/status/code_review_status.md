# ExamForge 代码审查与问题状态

## 1. 文档定位

本文档是 ExamForge 的代码审查结果和存留问题状态文档。它记录开发过程中发现但尚未解决的问题、风险、技术债和审查结论。

`docs/status/project_status.md` 只描述项目开发进度、已实现内容、验证结果和下一步；本文档专门维护“问题是否存在、是否已解决、解决证据是什么”。

## 2. 状态规则

问题状态使用：

- `待解决`：问题仍存在，需要后续处理。
- `已解决`：问题已有修复提交或明确证据证明不再存在。
- `暂缓`：问题确认存在，但当前阶段不处理，需要说明暂缓原因和重新评估条件。

解决问题时，不删除原记录；应把状态改为 `已解决`，并补充解决提交、验证命令和结果。

## 3. 待解决问题

### CR-001：本机默认 Python 环境不满足调度器要求

- 状态：待解决
- 严重级别：P2 中优先级
- 所属模块：`apps/scheduler` / 本地开发环境
- 发现来源：`docs/status/project_status.md`
- 位置：`apps/scheduler/pyproject.toml`
- 问题描述：本机默认 `python` 命令不可用，`python3` 为 3.10.12，而调度器配置要求 Python 3.12 及以上。当前验证依赖 `uv run --python 3.12 --extra dev python -m pytest -q`。
- 影响：裸 `python -m pytest -q` 不能直接运行，容易让后续代理误报调度器测试受阻。
- 建议处理：明确文档和脚本中的推荐命令；如果需要统一体验，可提供项目级脚本封装调度器测试。
- 验证方式：在 `apps/scheduler/` 下运行推荐命令并确认全量测试通过。
- 解决记录：未解决。
- 本轮复核：仍成立。2026-07-06 本机 `python` 仍不可用，`python3 --version` 为 `Python 3.10.12`；替代命令 `cd apps/scheduler && uv run --python 3.12 --extra dev python -m pytest -q` 通过，结果为 `32 passed`。

### CR-002：Next 依赖链存在 npm audit moderate 公告

- 状态：待解决
- 严重级别：P2 中优先级
- 所属模块：`apps/web` / 依赖治理
- 发现来源：`docs/status/project_status.md`
- 位置：`apps/web/package.json`、`package-lock.json`
- 问题描述：`npm audit` 曾报告 Next 15.5.20 依赖链中的 2 个 moderate 级 PostCSS 相关公告，npm 给出的自动修复方案会降级到不适合本项目的旧 Next 版本。
- 影响：当前不阻塞本地演示，但后续生产化前需要跟踪 Next 官方依赖修复。
- 建议处理：保留审计记录；后续升级 Next 或等待其依赖 PostCSS 修复版本，避免盲目执行降级式自动修复。
- 验证方式：运行 `npm audit`，确认公告状态；升级后运行 `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e`。
- 解决记录：未解决。
- 本轮复核：仍成立。2026-07-06 运行 `npm audit --audit-level=moderate` 返回 `postcss <8.5.10` 的 2 个 moderate 公告，自动修复仍提示会强制安装 `next@9.3.3`。

### CR-003：Docker daemon 拉取镜像依赖当前 WSL 到 Windows 代理

- 状态：待解决
- 严重级别：P3 低优先级
- 所属模块：本地部署环境
- 发现来源：`docs/status/project_status.md`
- 位置：本机 Docker systemd 配置；`docker-compose.yml`
- 问题描述：Docker daemon 依赖当前 WSL 到 Windows 代理 `http://172.22.112.1:7897` 拉取 Docker Hub 镜像。
- 影响：如果 Windows 代理端口或地址变化，重新拉取镜像可能失败；已存在的 `postgres:16-alpine` 镜像和容器不受影响。
- 建议处理：代理变化时同步更新 Docker systemd 代理配置并重启 `docker.service`；部署文档中保留环境依赖说明。
- 验证方式：执行 `docker compose pull` 或重新创建 PostgreSQL 容器并确认健康检查通过。
- 解决记录：未解决。
- 本轮复核：仍成立。仓库内未新增替代镜像源或离线镜像方案，`docker-compose.yml` 仍直接使用 `postgres:16-alpine`。

### CR-004：SQL 迁移文件缺少正式迁移执行器和迁移状态表

- 状态：待解决
- 严重级别：P1 高优先级
- 所属模块：`packages/db`
- 发现来源：`docs/status/project_status.md`
- 位置：`packages/db/drizzle/*.sql`
- 问题描述：当前 SQL 迁移文件不是全部幂等；重复执行旧迁移时会出现类型或表已存在的提示。项目尚未提供正式迁移执行器或迁移状态表。
- 影响：不影响已完成的真实库验证，但会影响后续数据库治理、多人协作和可重复部署。
- 建议处理：第三版企业化阶段引入标准迁移命令或迁移状态表，并在文档中区分“首次初始化”和“增量迁移”。
- 验证方式：在干净 PostgreSQL 数据库中执行迁移和 seed；重复执行时应由迁移工具识别已应用迁移，而不是产生对象已存在噪声。
- 解决记录：未解决。
- 本轮复核：仍成立。`packages/db/drizzle/0000_initial.sql` 仍使用非幂等 `CREATE TYPE` / `CREATE TABLE`，`0003_schedule_drafts.sql` 第 1 行仍为非幂等 `CREATE TYPE draft_status`，仓库仍未提供迁移状态表或迁移执行器。

### CR-005：权限体系仍是请求头轻量护栏，不是真实认证授权

- 状态：待解决
- 严重级别：P1 高优先级
- 所属模块：`apps/api`、`apps/web`
- 发现来源：第二版第四阶段边界说明
- 位置：`apps/api/src/app.ts`、`apps/web/app/operations-console.tsx`
- 问题描述：当前通过 `x-examforge-role` 区分 `admin`、`operator`、`viewer`，没有用户账户、登录、会话、Token 或服务端身份校验。
- 影响：足以支持课程演示和接口边界验证，但不能作为生产级访问控制。
- 建议处理：第三版企业化阶段设计真实认证授权，补充用户、角色、会话或 Token 校验，并调整前端角色来源。
- 验证方式：新增认证/授权测试，覆盖未登录、角色不足、Token 失效和关键变更操作。
- 解决记录：未解决。
- 本轮复核：仍成立。`apps/api/src/app.ts` 仍通过 `x-examforge-role` 请求头识别角色，且没有登录、会话、Token 或服务端用户身份模型。

### CR-006：异步排考作业为 API 进程内状态，不具备持久化和多实例能力

- 状态：待解决
- 严重级别：P1 高优先级
- 所属模块：`apps/api`
- 发现来源：第二版第四阶段边界说明
- 位置：`apps/api/src/app.ts`
- 问题描述：当前 `scheduleJobs` 使用 API 进程内 `Map` 保存作业状态。进程重启后作业丢失，多实例部署下也无法共享进度。
- 影响：满足当前演示和 E2E 验收，但不满足生产级异步队列要求。
- 建议处理：第三版企业化阶段引入持久化作业表或 BullMQ + Redis，并定义重试、失败、取消和进度事件模型。
- 验证方式：新增作业持久化测试和重启恢复测试；多实例部署时作业查询应一致。
- 解决记录：未解决。
- 本轮复核：仍成立。`apps/api/src/app.ts` 仍在 `createApp()` 内使用进程内 `Map<string, ScheduleJobSummary>` 保存 `scheduleJobs`。

### CR-007：排考进度仍使用轮询，没有 WebSocket 或 SSE 实时推送

- 状态：待解决
- 严重级别：P2 中优先级
- 所属模块：`apps/api`、`apps/web`
- 发现来源：`docs/design/总体设计与技术选型.md`
- 位置：`apps/web/app/operations-console.tsx`、`apps/api/src/app.ts`
- 问题描述：当前异步排考进度通过 Web 轮询 `/api/schedule-jobs` 获取，没有 WebSocket 或 SSE。
- 影响：当前体验可演示；长任务、高频进度和多用户场景下效率和实时性不足。
- 建议处理：在持久化队列完成后再评估 SSE 或 WebSocket，避免先做实时通道但缺少可靠任务状态。
- 验证方式：新增浏览器端实时进度测试或 API 事件流测试。
- 解决记录：未解决。
- 本轮复核：仍成立。`apps/web/app/operations-console.tsx` 仍通过 `setInterval` 轮询 `/api/schedule-jobs` 和运行历史，未实现 SSE 或 WebSocket。

### CR-008：Python 调度器尚未独立 FastAPI 服务化

- 状态：待解决
- 严重级别：P2 中优先级
- 所属模块：`apps/scheduler`、`apps/api`
- 发现来源：`docs/design/总体设计与技术选型.md`
- 位置：`apps/scheduler/examforge_scheduler/cli.py`、`apps/api/src/scheduler-client.ts`
- 问题描述：总体设计曾规划 Python + FastAPI 算法服务；当前实现为 API 通过 JSON stdin/stdout 调用 Python CLI。
- 影响：当前解耦程度足够支持测试和演示，但服务化部署、健康检查、并发隔离和独立扩缩容能力不足。
- 建议处理：若第三版需要独立部署算法服务，再引入 FastAPI；否则保持 CLI 方案，避免过早增加运维复杂度。
- 验证方式：服务化后补充 API 到 scheduler 服务的契约测试和故障降级测试。
- 解决记录：未解决。
- 本轮复核：仍成立。`apps/api/src/scheduler-client.ts` 仍通过 `uv run ... python -m examforge_scheduler.cli solve` 和 stdin/stdout 调用调度器。

### CR-009：Web 运营台主组件体量过大，存在后续维护风险

- 状态：待解决
- 严重级别：P2 中优先级
- 所属模块：`apps/web`
- 发现来源：当前代码结构观察
- 位置：`apps/web/app/operations-console.tsx`
- 问题描述：运营台多个业务区块、状态管理和 API 调用集中在单个大型组件文件中。
- 影响：当前功能可用，但后续继续增加第三版能力时，状态耦合和回归风险会上升。
- 建议处理：在全量代码审查中重点评估拆分边界；优先按业务面拆出 API client、方案工作台、基础数据管理、已发布查询和异步作业组件。
- 验证方式：拆分后运行 `npm run typecheck`、`npm run build` 和 `npm run test:e2e`。
- 解决记录：未解决。
- 本轮复核：仍成立。`apps/web/app/operations-console.tsx` 仍集中承载 API 调用、角色状态、排考运行、草稿工作台、基础数据管理、教师不可用维护和已发布查询等多个业务面。

### CR-010：Web 角色切换没有覆盖多数变更请求，缺失请求头会被 API 当作管理员

- 状态：待解决
- 严重级别：P1 高优先级
- 所属模块：`apps/api`、`apps/web`
- 发现来源：2026-07-06 全量代码审查
- 位置：`apps/api/src/app.ts:695`、`apps/api/src/app.ts:701`、`apps/web/app/operations-console.tsx:273`、`apps/web/app/operations-console.tsx:391`、`apps/web/app/operations-console.tsx:414`、`apps/web/app/operations-console.tsx:491`、`apps/web/app/operations-console.tsx:598`、`apps/web/app/operations-console.tsx:627`、`apps/web/app/operations-console.tsx:666`、`apps/web/app/operations-console.tsx:1952`
- 问题描述：API 的 `getRequestRole()` 在请求头缺失或非法时默认返回 `admin`；Web 仅在异步排考、锁定/解锁/再平衡和教师不可用维护中调用 `roleHeaders()`，同步排考、运行发布、创建草稿、草稿 PATCH、草稿发布/废弃、回滚发布和基础数据增删改导入都没有携带当前角色。
- 影响：运营台选择“只读”后，多数变更操作仍会以缺失请求头访问 API，并被服务端默认识别为管理员。这会绕过第二版角色演示边界，也掩盖后续真实认证接入前的授权测试缺口。
- 建议处理：服务端缺失或非法角色头应默认拒绝或默认 `viewer`；前端所有变更请求统一通过 API client 注入当前角色；API 测试补充“无头请求不得拥有管理员权限”和 Web/E2E 角色切换用例。
- 验证方式：新增 API 测试覆盖无 `x-examforge-role`、非法角色、`viewer` 访问所有变更接口均返回 `403`；新增 E2E 测试切到“只读”后点击排考、发布、基础数据保存等按钮应被阻止或返回权限提示。
- 解决记录：未解决。

### CR-011：草稿校验错误处理空 `allowed_slot_ids`，会阻断合法的不限时段考试

- 状态：待解决
- 严重级别：P1 高优先级
- 所属模块：`apps/api`、`packages/shared`、`apps/scheduler`
- 发现来源：2026-07-06 全量代码审查
- 位置：`packages/shared/src/domain.ts:64`、`apps/scheduler/examforge_scheduler/solver.py:136`、`apps/scheduler/examforge_scheduler/precheck.py:65`、`apps/api/src/repository.ts:749`、`apps/api/src/repository.ts:863`
- 问题描述：共享合同允许 `allowed_slot_ids` 默认空数组，调度器 `solver` / `precheck` 将空值解释为“允许所有时间段”，建议生成也按同一口径处理；但 API 草稿硬约束校验直接执行 `!task.allowed_slot_ids.includes(assignment.time_slot_id)`，空数组会把任意草稿安排都标为 `allowed_slot` 冲突。
- 影响：通过 Web 表单或 JSON 导入创建“无时间段限制”的考试任务后，自动排考可以正常产生安排，但从运行创建草稿、校验或发布草稿时会出现错误硬冲突，导致合法草稿无法发布。
- 建议处理：将 `validateDraftAssignments()` 的 allowed-slot 判断改为“仅当 `allowed_slot_ids.length > 0` 时校验包含关系”；补充 API 单元测试覆盖空 `allowed_slot_ids` 的草稿创建、调整、校验和发布路径。
- 验证方式：构造 `allowed_slot_ids: []` 的考试任务，运行自动排考后创建草稿并发布；期望草稿不产生 `allowed_slot` 冲突，`npm test` 和调度器 pytest 均通过。
- 解决记录：未解决。

### CR-012：PostgreSQL 草稿锁定状态只保存在进程内，重启后会丢失

- 状态：待解决
- 严重级别：P1 高优先级
- 所属模块：`apps/api`、`packages/db`
- 发现来源：2026-07-06 全量代码审查
- 位置：`apps/api/src/postgres-repository.ts:70`、`apps/api/src/postgres-repository.ts:796`、`apps/api/src/postgres-repository.ts:808`、`apps/api/src/postgres-repository.ts:1254`、`packages/db/src/schema.ts:140`、`packages/db/drizzle/0003_schedule_drafts.sql:17`
- 问题描述：PostgreSQL 仓储虽然持久化了草稿、草稿安排、冲突和变更事件，但 `draftLocks` 仍是 `PostgresPlatformRepository` 实例内的 `Map`，schema 和迁移中没有锁定字段或锁表。
- 影响：API 进程重启、多实例部署或仓储实例重建后，已锁定考试会显示为未锁定，`updateScheduleDraftAssignment()` 和局部再平衡会重新允许修改这些考试，破坏“锁定后禁止人工调整、再平衡跳过锁定考试”的第二版承诺。
- 建议处理：在数据库中持久化锁定状态，例如为 `draft_scheduled_exams` 增加 `locked_at` / `locked_by` 字段，或新增 `draft_assignment_locks` 表；PostgreSQL 仓储读写锁定状态必须来自数据库，内存仓储可继续用 `Map` 支撑演示。
- 验证方式：新增 PostgreSQL 仓储集成测试：锁定草稿考试后重建 repository 实例，再读取草稿、PATCH 该考试和执行 rebalance，期望锁仍存在且修改被拒绝。
- 解决记录：未解决。

### CR-013：数据库 schema 缺少外键和关键唯一约束，持久化数据一致性主要依赖应用自律

- 状态：待解决
- 严重级别：P2 中优先级
- 所属模块：`packages/db`、`apps/api`
- 发现来源：2026-07-06 全量代码审查
- 位置：`packages/db/src/schema.ts:94`、`packages/db/src/schema.ts:121`、`packages/db/src/schema.ts:140`、`packages/db/src/schema.ts:154`、`packages/db/drizzle/0000_initial.sql:61`、`packages/db/drizzle/0003_schedule_drafts.sql:17`、`apps/api/src/postgres-repository.ts:162`
- 问题描述：数据库表之间基本只定义文本 ID 和主键，没有 `exam_tasks.batch_id`、`exam_tasks.course_id`、`scheduled_exams.run_id`、`draft_scheduled_exams.draft_id` 等外键，也没有设计文档提到的“同一运行中同一考场同一时间段唯一”等稳定唯一约束。API 创建基础数据时也主要做 Zod 形状校验，不做跨资源引用校验。
- 影响：直接写库、seed/导入异常或 API 创建缺失引用的考试任务时，数据库可以持久化孤儿记录或重复安排；后续排考、发布查询和历史版本展示只能在运行时降级或报错，第三版多人协作和可重复部署风险较高。
- 建议处理：分阶段补充数据库约束：先增加低风险外键和唯一索引，再为 JSON 数组引用保留应用层引用校验；API 的基础数据创建/导入应校验 `course_id`、`student_group_ids`、`allowed_slot_ids` 等引用存在。
- 验证方式：新增迁移和仓储/API 测试，覆盖缺失课程、缺失学生群体、重复 `(run_id, room_id, time_slot_id)`、孤儿草稿安排等场景会被拒绝；在干净 PostgreSQL 库上执行迁移、seed、`npm test`。
- 解决记录：未解决。

## 4. 已解决问题

当前暂无已解决的审查问题记录。后续问题修复后，在原问题记录中将状态更新为 `已解决`，并补充解决提交、验证命令和结果；不删除原问题记录。

## 5. 审查记录

- 2026-07-06：创建本文档，迁入 `docs/status/project_status.md` 中既有存留风险，并补充第二版第四阶段已明确的轻量实现边界问题。
- 2026-07-06：执行当前 `main` 全量代码审查；复核 CR-001 至 CR-009 均仍成立，新增 CR-010 至 CR-013。新鲜验证包括：默认 `python -m pytest -q` 因 `python` 缺失失败，`cd apps/scheduler && uv run --python 3.12 --extra dev python -m pytest -q` 为 `32 passed`，`npm test` 为 API `16` 个测试通过，`npm run typecheck` 通过，`npm run build` 通过，顺序运行 `npm run test:e2e` 为 `2 passed`，`npm audit --audit-level=moderate` 仍报告 2 个 moderate 公告。