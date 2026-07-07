# ExamForge 代码审查与问题状态

## 1. 文档定位

本文档是 ExamForge 的代码审查结果和存留问题状态文档。它记录开发过程中发现但尚未解决的问题、风险、技术债和审查结论。

`docs/status/project_status.md` 只描述项目开发进度、已实现内容、验证结果和下一步；本文档专门维护“问题是否存在、是否已解决、解决证据是什么”。

## 2. 状态规则

问题状态使用：

- `待解决`：问题仍存在，需要后续处理。
- `已解决`：问题已有修复提交或明确证据证明不再存在。
- `暂缓`：问题确认存在，但当前阶段不处理，需要说明暂缓原因和重新评估条件。

解决问题时，从 `## 3. 待解决问题` 移入 `## 4. 已解决问题`。已解决问题区只保留编号和题目，解决提交与验证证据集中记录在 `## 5. 审查记录`，避免待处理列表被历史问题稀释。

## 3. 待解决问题

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

### CR-007：排考进度仍使用轮询，没有 WebSocket 或 SSE 实时推送

- 状态：待解决
- 严重级别：P2 中优先级
- 所属模块：`apps/api`、`apps/web`
- 发现来源：`docs/design/总体设计与技术选型.md`
- 位置：`apps/web/features/async-jobs/`、`apps/api/src/app.ts`
- 问题描述：当前异步排考进度通过 Web 轮询 `/api/schedule-jobs` 获取，没有 WebSocket 或 SSE。
- 影响：当前体验可演示；长任务、高频进度和多用户场景下效率和实时性不足。
- 建议处理：在持久化队列完成后再评估 SSE 或 WebSocket，避免先做实时通道但缺少可靠任务状态。
- 验证方式：新增浏览器端实时进度测试或 API 事件流测试。
- 解决记录：未解决。
- 本轮复核：仍成立。第三版第一阶段已将异步作业轮询迁入 TanStack Query `refetchInterval`，但进度通道本质仍是 HTTP 轮询，未实现 SSE 或 WebSocket。

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

## 4. 已解决问题

- CR-001：本机默认 Python 环境不满足调度器要求
- CR-004：SQL 迁移文件缺少正式迁移执行器和迁移状态表
- CR-005：权限体系仍是请求头轻量护栏，不是真实认证授权
- CR-006：异步排考作业为 API 进程内状态，不具备持久化和多实例能力
- CR-010：Web 角色切换没有覆盖多数变更请求，缺失请求头会被 API 当作管理员
- CR-011：草稿校验错误处理空 `allowed_slot_ids`，会阻断合法的不限时段考试
- CR-012：PostgreSQL 草稿锁定状态只保存在进程内，重启后会丢失
- CR-013：数据库 schema 缺少外键和关键唯一约束，持久化数据一致性主要依赖应用自律
- CR-009：Web 运营台主组件体量过大，存在后续维护风险

## 5. 审查记录

- 2026-07-06：创建本文档，迁入 `docs/status/project_status.md` 中既有存留风险，并补充第二版第四阶段已明确的轻量实现边界问题。
- 2026-07-06：执行当前 `main` 全量代码审查；复核 CR-001 至 CR-009 均仍成立，新增 CR-010 至 CR-013。新鲜验证包括：默认 `python -m pytest -q` 因 `python` 缺失失败，`cd apps/scheduler && uv run --python 3.12 --extra dev python -m pytest -q` 为 `32 passed`，`npm test` 为 API `16` 个测试通过，`npm run typecheck` 通过，`npm run build` 通过，顺序运行 `npm run test:e2e` 为 `2 passed`，`npm audit --audit-level=moderate` 仍报告 2 个 moderate 公告。
- 2026-07-07：修复 CR-010、CR-011、CR-012，提交为 `a835a94 fix(审查): 修复角色权限与草稿锁定问题`。先新增 API 红灯测试，确认无角色默认管理员、空 `allowed_slot_ids` 草稿误阻断和 DB schema 缺少锁字段三个问题可复现；随后完成修复并验证 `npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e` 均通过。
- 2026-07-07：修复 CR-001。仓库根 `package.json` 新增 `npm run test:scheduler`，统一通过 `uv run --python 3.12 --extra dev python -m pytest -q` 调用调度器测试；`apps/scheduler/AGENTS.md` 和 `README.md` 同步改为推荐项目级脚本，避免后续代理依赖本机默认 `python`。验证 `npm run test:scheduler` 通过，调度器测试结果为 `32 passed`。
- 2026-07-07：修复 CR-004、CR-005、CR-006、CR-013。新增 `schema_migrations` 迁移执行器和 `npm run db:migrate`；API 改为 Bearer token 登录与鉴权，Web 角色演示改用对应 token；异步排考作业移入 repository，并在 PostgreSQL 中新增 `schedule_jobs` 表；DB schema 和迁移补充外键、唯一约束，API 基础数据写入补充跨资源引用校验。验证 `npm run typecheck`、`LOG_LEVEL=silent npm test`、`npm run build`、`npm run test:scheduler`、`npm run test:e2e`、`git diff --check` 均通过；API 测试结果为 `22` 个测试通过，调度器测试结果为 `32 passed`，E2E 结果为 `2 passed`。
- 2026-07-07：修复 CR-009。完成第三版第一阶段 Web 运营台拆分：新增统一 API client、角色 token 边界、query keys、TanStack Query provider 和按业务面组织的 `apps/web/features/`；异步作业、已发布查询、基础数据、教师不可用、运行历史/审计和草稿工作台均已从主组件拆出；`operations-console.tsx` 从约 2397 行收敛到 851 行。验证 `npm run typecheck`、`LOG_LEVEL=silent npm test`、`npm run build`、`npm run test:e2e`、`git diff --check` 均通过；API 测试结果为 `22` 个通过，E2E 结果为 `2 passed`。
