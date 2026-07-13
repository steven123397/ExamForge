# ExamForge 代码审查与问题状态

## 1. 文档定位

本文档是 ExamForge 的代码审查结果和存留问题状态文档。它记录开发过程中发现但尚未解决的问题、风险、技术债和审查结论。

`docs/status/project_status.md` 只描述项目开发进度、已实现内容、验证结果和下一步；本文档专门维护“问题是否存在、是否已解决、解决证据是什么”。

## 2. 状态规则

问题状态使用：

- `待解决`：问题仍存在，需要后续处理。
- `已解决`：问题已有修复提交或明确证据证明不再存在。
- `暂缓`：问题确认存在，但当前阶段不处理，需要说明暂缓原因和重新评估条件。

`## 3. 问题明细` 只保留 `待解决` 或 `暂缓` 的问题。问题解决后，从问题明细中移除完整条目，在 `## 4. 已解决问题索引` 保留编号和题目，并将解决过程与验证证据写入 `## 5. 审查记录`。

## 3. 问题明细

### CR-002：Next 依赖链存在 npm audit moderate 公告

- 状态：暂缓
- 严重级别：P2 中优先级
- 所属模块：`apps/web` / 依赖治理
- 发现来源：`docs/status/project_status.md`
- 位置：`apps/web/package.json`、`package-lock.json`
- 问题描述：`npm audit` 曾报告 Next 15.5.20 依赖链中的 2 个 moderate 级 PostCSS 相关公告，npm 给出的自动修复方案会降级到不适合本项目的旧 Next 版本。
- 影响：当前不阻塞本地演示，但后续生产化前需要跟踪 Next 官方依赖修复。
- 建议处理：保留审计记录；后续升级 Next 或等待其依赖 PostCSS 修复版本，避免盲目执行降级式自动修复。
- 验证方式：运行 `npm audit`，确认公告状态；升级后运行 `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e`。
- 解决记录：未解决。
- 本轮处置：暂缓。2026-07-14 运行 `npm audit --audit-level=moderate`，当前 `next@15.5.20 -> postcss@8.4.31` 仍命中 `postcss <8.5.10` 的 2 个 moderate 公告。隔离探针覆盖到 `postcss@8.5.19` 后虽然 audit 为 0，但 `npm ls` 以 `ELSPROBLEMS` 判定该版本不满足 Next 的精确声明；`npm audit fix --force` 又会错误降级到 `next@9.3.3`，故两类试验均未保留。重新评估条件为升级到经过完整回归且不再携带该精确依赖的 Next 版本，或形成明确的生产风险接受决定；第六阶段正式发布前必须处置。

### CR-003：Docker daemon 拉取镜像依赖当前 WSL 到 Windows 代理

- 状态：暂缓
- 严重级别：P3 低优先级
- 所属模块：本地部署环境
- 发现来源：`docs/status/project_status.md`
- 位置：本机 Docker systemd 配置；`docker-compose.yml`
- 问题描述：Docker daemon 依赖当前 WSL 到 Windows 代理 `http://172.22.112.1:7897` 拉取 Docker Hub 镜像。
- 影响：如果 Windows 代理端口或地址变化，重新拉取镜像可能失败；已存在的 `postgres:16-alpine` 镜像和容器不受影响。
- 建议处理：代理变化时同步更新 Docker systemd 代理配置并重启 `docker.service`；部署文档中保留环境依赖说明。
- 验证方式：执行 `docker compose pull` 或重新创建 PostgreSQL 容器并确认健康检查通过。
- 解决记录：未解决。
- 本轮处置：暂缓。2026-07-12 `docker info` 显示 daemon 的 HTTP/HTTPS 代理仍为 `http://172.22.112.1:7897`，且没有 Docker Hub 镜像源；`docker pull postgres:16-alpine` 通过该路径从 Docker Hub 拉取新 digest `sha256:57c72fd...` 成功，说明代理当前可用。未经用户单独授权不修改 machine-level systemd/Windows 代理；代理地址变化、Docker Hub 拉取失败或迁移到独立服务器时重新评估。

## 4. 已解决问题索引

- CR-001：本机默认 Python 环境不满足调度器要求
- CR-004：SQL 迁移文件缺少正式迁移执行器和迁移状态表
- CR-005：权限体系仍是请求头轻量护栏，不是真实认证授权
- CR-006：异步排考作业为 API 进程内状态，不具备持久化和多实例能力
- CR-010：Web 角色切换没有覆盖多数变更请求，缺失请求头会被 API 当作管理员
- CR-011：草稿校验错误处理空 `allowed_slot_ids`，会阻断合法的不限时段考试
- CR-012：PostgreSQL 草稿锁定状态只保存在进程内，重启后会丢失
- CR-013：数据库 schema 缺少外键和关键唯一约束，持久化数据一致性主要依赖应用自律
- CR-009：Web 运营台主组件体量过大，存在后续维护风险
- CR-014：已发布排考 CSV 导出未鉴权且没有下载审计
- CR-015：Web 运营台仍把 Query 数据大量镜像到本地状态
- CR-016：异步排考作业缺少启动恢复和超时失败语义
- CR-017：迁移完整性测试仍断言已废弃的草稿唯一约束
- CR-018：API 排考入口没有接收 `fixed_assignments`
- CR-019：PostgreSQL `getReferenceData()` 仍从 JSONB 读取教师不可用与考试学生组
- CR-020：不可行或不完整排考可以被发布为正式方案
- CR-021：内部运营读取接口绕过 Bearer 鉴权
- CR-022：连续考试与连续监考把跨日相邻序号误判为连续场次
- CR-023：跨资源时段引用校验缺失导致仓储语义分裂并泄露 SQL 错误
- CR-024：草稿建议请求竞态可能把旧考试建议应用到错误选择上下文
- CR-025：运营历史子查询失败会被吞掉并显示成空数据
- CR-026：发布、回滚、废弃和删除等高影响操作没有确认步骤
- CR-027：草稿矩阵 ARIA 网格语义和异步错误播报不完整
- CR-008：Python 调度器尚未独立 FastAPI 服务化
- CR-007：排考进度仍使用轮询，没有 WebSocket 或 SSE 实时推送

## 5. 审查记录

- 2026-07-14：第五版第五阶段完成后复核存留问题。真实 PostgreSQL/Redis、15 个迁移、Worker 故障恢复、完整构建和 35 项 Playwright 场景均通过既定门禁，未发现新的 P0/P1 或需要单独编号的实现缺陷。`npm audit --audit-level=moderate` 仍返回 2 个 PostCSS moderate 公告，强制 override 会造成依赖树无效，自动修复会错误降级，因此 CR-002 保持暂缓但提升为第六阶段正式发布前置门禁；CR-003 未发生机器级变更，仍在本地代理变化或远程部署时重评。问题明细保持 2 项，无待解决 P0/P1。

- 2026-07-13：第五版第三阶段解决 CR-007。API 已停止进程内计时器执行，改为 PostgreSQL 事务 outbox、独立 Publisher、Redis/BullMQ 和独立 Worker；作业事件以严格序列持久化，SSE 先补发 PostgreSQL 历史并支持 `Last-Event-ID`，Redis 只用于唤醒。Web 已移除 1200 ms 主轮询，以 SSE 更新 Query cache，仅在断线期间执行不低于 5 秒的兜底查询。真实 PostgreSQL/Redis Worker 测试 `14 passed`；隔离 Compose 从空卷完成 API 重启、Redis 停止恢复、Publisher 重启、Worker 崩溃回收、scheduler 不可用重试、重复 outbox 和 SSE 重连，所有场景最终只生成一个运行结果，Chromium E2E `21 passed`。CR-007 移入已解决索引；当前问题明细仅保留 CR-002 和 CR-003。腾讯云私有试部署未获单独授权，未作为关闭该本地架构问题的虚假证据。

- 2026-07-13：第五版第二阶段解决 CR-008。新增独立 FastAPI scheduler 的 `/health`、`/ready`、`/solve` 和确定性 OpenAPI，CLI/HTTP 共用解析、求解、报告与序列化 pipeline；API 生产 Compose 显式使用 HTTP 客户端并稳定分类合同错误、业务不可行、超时、取消、不可用、协议损坏和内部错误，不进行 CLI 回退。独立 scheduler 镜像以 UID 10002 运行并设置 CPU、内存、进程数和健康检查，API 镜像探针确认不含 Python/uv。固定样例等价测试覆盖可行、不可行、固定安排和增量重排；隔离 Compose smoke 直连 scheduler 后完成真实会话排考、PostgreSQL 持久化和 API 重启读取，Chromium E2E `17 passed`。CR-007 仍保留到第三阶段，不能用同步 HTTP 服务替代可靠队列或 SSE 结论。

- 2026-07-06：创建本文档，迁入 `docs/status/project_status.md` 中既有存留风险，并补充第二版第四阶段已明确的轻量实现边界问题。
- 2026-07-06：执行当前 `main` 全量代码审查；复核 CR-001 至 CR-009 均仍成立，新增 CR-010 至 CR-013。新鲜验证包括：默认 `python -m pytest -q` 因 `python` 缺失失败，`cd apps/scheduler && uv run --python 3.12 --extra dev python -m pytest -q` 为 `32 passed`，`npm test` 为 API `16` 个测试通过，`npm run typecheck` 通过，`npm run build` 通过，顺序运行 `npm run test:e2e` 为 `2 passed`，`npm audit --audit-level=moderate` 仍报告 2 个 moderate 公告。
- 2026-07-07：修复 CR-010、CR-011、CR-012，提交为 `a835a94 fix(审查): 修复角色权限与草稿锁定问题`。先新增 API 红灯测试，确认无角色默认管理员、空 `allowed_slot_ids` 草稿误阻断和 DB schema 缺少锁字段三个问题可复现；随后完成修复并验证 `npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e` 均通过。
- 2026-07-07：修复 CR-001。仓库根 `package.json` 新增 `npm run test:scheduler`，统一通过 `uv run --python 3.12 --extra dev python -m pytest -q` 调用调度器测试；`apps/scheduler/AGENTS.md` 和 `README.md` 同步改为推荐项目级脚本，避免后续代理依赖本机默认 `python`。验证 `npm run test:scheduler` 通过，调度器测试结果为 `32 passed`。
- 2026-07-07：修复 CR-004、CR-005、CR-006、CR-013。新增 `schema_migrations` 迁移执行器和 `npm run db:migrate`；API 改为 Bearer token 登录与鉴权，Web 角色演示改用对应 token；异步排考作业移入 repository，并在 PostgreSQL 中新增 `schedule_jobs` 表；DB schema 和迁移补充外键、唯一约束，API 基础数据写入补充跨资源引用校验。验证 `npm run typecheck`、`LOG_LEVEL=silent npm test`、`npm run build`、`npm run test:scheduler`、`npm run test:e2e`、`git diff --check` 均通过；API 测试结果为 `22` 个测试通过，调度器测试结果为 `32 passed`，E2E 结果为 `2 passed`。
- 2026-07-07：修复 CR-009。完成第三版第一阶段 Web 运营台拆分：新增统一 API client、角色 token 边界、query keys、TanStack Query provider 和按业务面组织的 `apps/web/features/`；异步作业、已发布查询、基础数据、教师不可用、运行历史/审计和草稿工作台均已从主组件拆出；`operations-console.tsx` 从约 2397 行收敛到 851 行。验证 `npm run typecheck`、`LOG_LEVEL=silent npm test`、`npm run build`、`npm run test:e2e`、`git diff --check` 均通过；API 测试结果为 `22` 个通过，E2E 结果为 `2 passed`。
- 2026-07-08：执行第三版第四阶段后全量代码审查；复核 CR-002、CR-003、CR-007、CR-008 仍成立，新增 CR-014 至 CR-017。新鲜验证包括：`npm run test:scheduler` 通过，调度器测试结果为 `42 passed`；`LOG_LEVEL=silent npm test` 通过，API 测试结果为 `30` 个通过；`npm run typecheck` 通过；`npm run build` 通过；`npm run test:e2e` 通过，Playwright 结果为 `2 passed`；`npm audit --audit-level=moderate` 仍返回 2 个 moderate 公告；`TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:postgres`、`TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:migrations` 和 `DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run db:migrate` 均因 `connect ECONNREFUSED 127.0.0.1:5432` 失败，当前会话未取得真实 PostgreSQL 通过结论。
- 2026-07-08：按审查顺序修复 CR-014、CR-015、CR-016、CR-017。CSV 导出改为 Bearer 鉴权和下载审计；Web 运营台只读服务端数据改为直接消费 TanStack Query 数据；API 启动时将历史 `queued` / `running` 异步作业标为 failed 并记录审计；迁移完整性测试移除废弃草稿唯一约束断言，并将 `0007` 关联表纳入关键迁移检查。验证 `LOG_LEVEL=silent npm test`、`npm run test:scheduler`、`npm run typecheck`、`npm run build`、`npm run test:e2e` 均通过；API 测试结果为 `31` 个通过，调度器测试结果为 `42 passed`，E2E 结果为 `2 passed`。真实 PostgreSQL 验证仍受本机环境阻塞：`docker ps --format ...` 未发现运行中容器，`TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:postgres`、`TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:migrations`、`DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run db:migrate` 均因 `connect ECONNREFUSED 127.0.0.1:5432` 失败。
- 2026-07-08：修复 CR-018、CR-019。先新增 API 红灯测试，确认 `POST /api/schedule-runs` 和 `POST /api/schedule-jobs` 会把 `fixed_assignments` 丢成空数组；随后 API 排考入口改为解析 shared `fixedAssignmentSchema` 并合并到调度器输入。PostgreSQL 仓储 `getReferenceData()` 改为优先从 `teacher_unavailable_slots` 和 `exam_task_student_groups` 关联表构建教师不可用与考试学生组，JSONB 字段保留为兼容回退；同时新增 PostgreSQL 集成测试覆盖关联表优先读路径。验证 `LOG_LEVEL=silent npm test --workspace @examforge/api -- --test-name-pattern "fixed assignments"` 通过，API 测试结果为 `33` 个通过；`LOG_LEVEL=silent npm test --workspace @examforge/api` 通过，API 测试结果为 `33` 个通过；`npm run typecheck --workspace @examforge/api` 通过。真实 PostgreSQL 验证仍受本机环境阻塞：`TEST_DATABASE_URL=postgres://examforge:examforge@localhost:5432/examforge_test npm run test:postgres --workspace @examforge/api` 因 `connect ECONNREFUSED 127.0.0.1:5432` 失败，当前会话未取得真实库通过结论。
- 2026-07-11：第四版第一阶段继续补强 CR-019 的真实库证据和长期边界。PostgreSQL 正式排考、教师已发布查询、草稿详情、草稿对比和草稿发布均改为优先读取监考教师关联表，并通过主动删除关联行的测试证明 JSONB 兼容回退；迁移检查新增 4 张关联表的主键、外键和 JSONB 双向一致性检测。新增排考、草稿和发布治理 service，草稿 service 对终态与锁定进行业务短路，发布前继续由 repository 重新校验硬冲突；PostgreSQL 同一草稿的全部 mutation 通过 advisory lock 串行化，锁和业务 SQL 共用同一专用连接，失败时先排空已入队查询再解锁和释放，终态转换使用可编辑状态 CAS，避免连接池耗尽、连接复用污染、终态回退、终态后变更和并发重复发布；CSV 下载审计在 service 中保留 actor、entity type、entity id 和 payload。验证 `LOG_LEVEL=silent npm test` 为 API `44` 个通过，`npm run typecheck`、`npm run build`、`npm run test:scheduler` 和 `git diff --check` 通过；真实 PostgreSQL 集成测试为 `9 passed`，迁移与数据库 session 检查为 `4 passed`，正式迁移入口无待应用迁移。CR-002、CR-003、CR-007、CR-008 本阶段未处理，状态保持不变。
- 2026-07-12：执行第四版完成后全量代码审查，基线 `HEAD=origin/main=2320fbdfbe2e1cd9c1be4d1d67b807f7ce0017db`，`.codegraph/` 可用；完整覆盖调度器、API/service、内存与 PostgreSQL、迁移/shared、Web、测试、CI/Compose/依赖和文档。复核 CR-002、CR-003、CR-007、CR-008 仍成立且没有重复编号，CR-014 至 CR-019 未发现回归；新增 CR-020 至 CR-027。当前待解决/暂缓问题共 12 个，分布为 P0 2 个、P1 3 个、P2 6 个、P3 1 个。
- 2026-07-12：新鲜验证结果：`npm run test:ci` 为 7 passed，`npm run check:ci`、`npm run typecheck`、`LOG_LEVEL=silent npm test`（54 passed）、`npm run test:scheduler`（73 passed）和 `npm run build` 通过；固定 seed 的 50/100/150 场 benchmark 均 feasible、0 冲突，耗时 262/403/676 ms，教师负载极差均为 1。独立 `examforge_review_test` PostgreSQL 16 容器中迁移测试 4 passed、迁移检查无缺失、正式迁移无待应用、集成测试 9 passed；独立 Compose 项目和端口从空卷完成 smoke、API 重启持久化及 Chromium E2E 3 passed，随后容器、网络和卷已清理，原有演示栈未被修改。`docker compose config --quiet`、`uv lock --check` 通过；当前环境未安装 `actionlint`，因此未重复本地静态检查，已有提交 `533619d` 的 GitHub Actions 成功证据仍有效。
- 2026-07-12：依赖复核中 `npm audit --audit-level=moderate` 仍因 2 个 PostCSS moderate 公告返回 1，归入既有 CR-002；Docker daemon 代理归入既有 CR-003。P0/P1 必须在第五版第一阶段开始前进入独立整改计划；本轮按只审查不修复边界停止，未修改业务代码、测试、迁移、依赖、CI 或部署配置。
- 2026-07-12：修复 CR-020。先用内存 API 和隔离 PostgreSQL 16 复现 `infeasible` 空运行被直接发布、空草稿被误标为 `validated` 的红灯；随后新增统一发布资格函数，要求运行状态为 `feasible`、无硬冲突，且考试任务与安排一一对应，草稿校验同时把缺失和重复任务记录为硬冲突。内存与 PostgreSQL 最终发布路径均返回稳定的 `not_publishable`，HTTP 映射为 409；合法发布测试夹具改为六个考试任务、六条安排和七条监考关联的完整可行方案。最窄 API 三类负向用例通过，`npm run typecheck --workspace @examforge/api` 通过，API 全套 56 项通过，隔离 PostgreSQL 集成测试 10 项通过。
- 2026-07-12：修复 CR-021。API 增加统一 GET `preHandler`，内部 dashboard、基础数据、作业、运行、草稿、建议、对比和审计读取要求有效 Bearer token，无 token 或伪造 token 稳定返回 401；匿名白名单仅保留 `/health`、`/ready` 和已发布总览、通知、教师及学生群体查询，CSV 导出继续要求认证。Web 内部读取统一使用 viewer 演示 token，变更请求仍使用当前角色 token；E2E 直接读取辅助函数同步携带 viewer token。验证 `npm run typecheck` 通过，API 全套 59 项通过，隔离 PostgreSQL 集成测试 10 项通过；临时 `3101/4101` 服务上的 Chromium E2E 4 项通过，随后服务已停止，原有演示栈未修改。
- 2026-07-12：修复 CR-023。API `validateReferenceRecord()` 和 Python `validate_schedule_input()` 统一拒绝教师引用不存在的不可用时段；草稿 assignment 校验新增 `time_slot_not_found` 硬冲突，即使考试任务不限时段也不能使用不存在的时段。教师快捷更新路由补齐 `ReferenceIntegrityError` 映射，Fastify 对 PostgreSQL `23502/23503/23505/23514` 完整性异常统一返回不含 SQL、表名和参数的 409。红灯覆盖内存、草稿、Python 和隔离 PostgreSQL；验证 API 全套 62 项、scheduler 74 项、隔离 PostgreSQL 11 项通过，`npm run typecheck` 和 `git diff --check` 通过。
- 2026-07-12：修复 CR-022。新增 scheduler 共享 `are_consecutive_time_slots()`，将连续场次统一定义为同一日期且 `period_index` 差 1；room-slot 学生目标、教师分配目标和最终学生/教师评分共同调用该函数，并按 `(date, period_index)` 排序。专项红灯证明旧实现会对跨日安排误罚、推迟考试并改选第三位教师；同日相邻、同日不相邻和跨日相邻 index 对照均转绿。scheduler 全套 78 项通过；固定 seed 的 50/100/150 场 benchmark 均 feasible、0 冲突，耗时 258/363/652 ms，教师负载极差均为 1。
- 2026-07-12：修复 CR-024。Playwright 用可控延迟复现考试 A 建议晚于 B 返回后，旧实现仍向 A 的 assignment 发送 PATCH；随后为建议请求增加递增代次，响应同时校验草稿 ID 与考试 ID，切换草稿、选择或进入终态会清空并失效旧请求，应用前再次核对当前上下文，面板显示绑定的考试 ID。专项用例验证快速切换后只修改 B，发布进入终态后不再提供应用操作；临时 `3104/4104` 服务上的 Chromium 全套 5 项通过，服务随后已停止，原有演示栈未修改。
- 2026-07-12：修复 CR-025。Playwright 分别拦截运行、审计、草稿和作业历史接口返回 500，四个红灯均证明旧界面没有错误提示并继续渲染空状态；随后四个面板分别消费对应 Query 的 `isError`、`isFetching` 与 `refetch`，共享错误组件提供可见 `role=alert`、重试状态和重试按钮，失败面板不再显示伪空数据，dashboard/reference 等成功数据继续可用。四类故障注入与恢复专项用例 4 项通过；临时 `3105/4105` 服务上的 Chromium 全套 9 项通过，服务随后已停止，原有演示栈未修改。
- 2026-07-12：修复 CR-026。Playwright 分别证明运行发布、发布回滚、草稿废弃和基础数据删除在旧实现首次点击后立即产生 1 次真实请求；随后新增共享原生 `dialog` 确认组件，使用 `role=alertdialog` 展示目标 ID 与影响说明，并覆盖运行/草稿发布、回滚、废弃和删除入口。对话框初始聚焦取消按钮，Escape/取消不发请求并把焦点归还触发器，确认期间禁用操作，强制重复点击仍只发送 1 次请求。四类专项用例通过；临时 `3106/4106` 服务上的 Chromium 全套 13 项通过，服务随后已停止，原有演示栈未修改。
- 2026-07-12：修复 CR-027。DOM 红灯确认旧页面仍暴露 1 个不完整 `grid`；随后草稿矩阵改为原生 `table`、`thead`、`tbody`、列头、行头和数据单元格，交互与拖拽继续由单元格内原生按钮承载，横向滚动限制在矩阵包装层。全局异步错误和面板查询错误使用 polite live region，确认对话框补充滚动边界。专项用例精确核对列头、行头和单元格数量，Enter 可激活考试，1600×1000 与 375×812 均无页面级横向溢出；临时 `3107/4107` 服务上的 Chromium 全套 14 项通过。实际截图复核桌面、移动矩阵及移动确认框均无文本或控件重叠，服务随后已停止，原有演示栈未修改。
- 2026-07-12：处置 CR-002、CR-003、CR-007、CR-008。CR-002 的 npm 官方元数据和隔离 lock 探针证明，强制 PostCSS override 虽可清除 audit，但会使 `npm ls` 返回 `ELSPROBLEMS`，相关试验改动已撤回；CR-003 的 daemon 代理仍为 `172.22.112.1:7897`，实际拉取 PostgreSQL 新镜像成功且未修改机器配置；CR-007/008 分别依赖第五版第三阶段可靠任务事件/SSE和第二阶段 FastAPI/OpenAPI 合同，第一阶段明确不实施。四项均保留在问题明细并改为暂缓，具备明确重评条件。
- 2026-07-12：完成第四版审查整改全量验证。`npm run test:ci` 为 7 passed，`npm run check:ci`、`npm run typecheck`、`LOG_LEVEL=silent npm test`（API 62 passed）、`npm run test:scheduler`（78 passed）和 `npm run build` 通过；固定 seed 的 50/100/150 场 benchmark 均 feasible、0 冲突，耗时 246/412/724 ms，教师负载极差均为 1。可丢弃 PostgreSQL 16 容器中迁移测试 4 passed、迁移检查无缺失或双向不一致、正式迁移无待应用、集成测试 11 passed。第一次独立 Compose 验证因 `demo-smoke.mjs` 匿名读取受保护基础数据返回 401 而失败，补齐 viewer token 后，第二次从空卷完成 smoke、API 重启持久化和 Chromium E2E 14 passed；测试容器、网络、卷及隔离 PostgreSQL 均已清理，原 `examforge` 栈保持健康。当前问题明细只剩 4 项暂缓边界，分布为 P2 3 项、P3 1 项，无待解决 P0/P1。
- 2026-07-12：第五版第一阶段完成作业状态/事件/outbox、关系化单一事实源、本地账户与服务端会话、四角色 RBAC、真实 actor 审计、Web Cookie 会话及前端信息架构基础。CR-007 复核后仍存在：持久化事件已经具备，但 Publisher、可靠 Worker 与 SSE 补发合同尚未实现，继续留到第三阶段。CR-008 复核后仍存在：API 生产路径仍调用 Python CLI，已通过 `docs/plan/第五版第二阶段计划.md` 固定 FastAPI/OpenAPI/HTTP 客户端和独立部署的验证门槛，在取得实现证据前不提前关闭。CR-002、CR-003 状态不变；问题明细仍为 P2 3 项、P3 1 项，无待解决 P0/P1。
