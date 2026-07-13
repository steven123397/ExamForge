# ExamForge 项目状态

## 当前结论

- 日期：2026-07-13。
- 当前版本：第五版第二阶段已经完成并归档，当前唯一活动计划为 `docs/plan/第五版第三阶段计划.md`。
- 第二阶段已将 Python scheduler 升级为独立 FastAPI 计算服务，以 OpenAPI 固定跨语言合同，并将生产 Compose 的 API 调用切换为 HTTP；CLI 继续作为本地调试和直接基准入口。
- 代码审查存留问题共 3 项：P2 的 CR-002、CR-007，以及 P3 的 CR-003；CR-008 已解决，当前无待解决 P0/P1。详细问题只维护在 `docs/status/code_review_status.md`。

## 当前实现基线

### 调度器与 HTTP 边界

- room-slot 与教师分配继续采用顺序二阶段 CP-SAT，覆盖固定安排、教师不可用、同时间唯一、最大负载、负载极差、同日相邻连续监考和增量重排稳定性。
- scheduler 提供独立的 `GET /health`、`GET /ready` 和 `POST /solve`；合法业务不可行仍是 HTTP 200，合同错误、内部错误和 request ID 使用稳定 envelope。
- CLI 与 HTTP 复用同一输入解析、语义校验、预检、求解、冲突整理、报告和 JSON 序列化 pipeline；固定样例等价测试覆盖可行、不可行、固定安排和增量重排。
- Python 网络模型生成确定性 `apps/scheduler/openapi.json`，根脚本支持生成和漂移检查，GitHub Actions 快速门禁会拒绝未同步合同。
- API HTTP 客户端区分 validation、timeout、cancelled、unavailable、protocol 和 internal，不记录输入或透传内部异常，也不会在 HTTP 故障时静默回退 CLI。

### 作业、数据、身份与 Web

- 作业状态为 `queued`、`running`、`succeeded`、`failed`、`cancelled`、`timed_out`；`infeasible` 是 `succeeded` 下的业务结果。调度器错误类别、代码和可重试性会进入作业终态，trace ID 会贯通 API、作业和 scheduler 请求。
- PostgreSQL 持久化作业、尝试、事件和 outbox；请求摘要、幂等键、条件状态转换和唯一约束继续防止重复创建、重复完成和终态竞争。
- 教师不可用、考试学生群体、正式监考和草稿监考只使用关联表；草稿 mutation 继续由 PostgreSQL advisory lock 与终态 CAS 保护。
- 本地账户、服务端会话、四角色 RBAC、真实 actor 审计和 Cookie Web 会话已经贯通；Web 的管理员/排考员运营台与教师/学生发布查询门户边界不变。
- 当前作业仍由 API 进程内执行器领取，Web 仍以轮询读取状态；可靠分发、独立 Worker、崩溃后重新领取和 SSE 由第三阶段处理。

### CI 与部署

- scheduler 使用独立 Python 镜像，以 UID 10002 非 root 运行，并配置 CPU、内存、进程数、停止宽限期和 readiness 健康检查。
- API 镜像只包含 Node.js 运行时，不再包含 Python、uv 或 scheduler 源码；Compose 生产路径显式配置 `SCHEDULER_TRANSPORT=http` 并等待 scheduler 健康。
- demo smoke 会先直连 scheduler 验证健康、可行和不可行业务结果，再通过真实 Cookie 会话完成 API 主链和重启后的 PostgreSQL 持久化读取。
- GitHub Actions 继续提供快速、PostgreSQL/迁移和 Compose/Playwright 三层门禁；尚未配置镜像推送、自动发布或生产部署。

## 第二阶段收尾验证

- `npm run test:ci`：`7 passed`；`npm run check:ci`、`npm run typecheck`、`npm run check:scheduler-openapi` 和 `npm run build` 通过。
- `LOG_LEVEL=silent npm test`：shared `10 passed`，API/服务测试 `80 passed`。
- `npm run test:scheduler`：`93 passed`；存在 1 条 FastAPI `TestClient` 上游弃用警告，不影响测试结果。
- 固定 seed `20260711`、30 秒上限的直接 benchmark：50、100、150 场均 feasible、0 冲突，耗时 328、743、1183 ms，教师负载极差均为 1。
- 同机 HTTP benchmark：50、100、150 场均 feasible、完整安排且 0 冲突；solver 耗时 363、619、1099 ms，HTTP 总耗时 386、628、1109 ms，实测协议开销 23、9、10 ms。该结果只说明本机单请求边界开销，不代表并发容量或全局最优。
- 可丢弃 PostgreSQL 16：迁移测试 `5 passed`，12 个迁移首次全部应用、第二次应用 0；迁移检查确认关键表/约束无缺失、关系无双向不一致、旧关系列为空；正式迁移入口返回 `applied: []`；真实集成测试 `13 passed`。
- 隔离 Compose：scheduler `/health` 与 `/ready` 均返回 200，版本为 `0.1.0`；scheduler 容器 UID 为 10002，API 镜像不含 Python/uv；smoke 完成直连求解、真实会话、HTTP 排考和 API 重启读取，Chromium E2E `17 passed`。临时容器、网络、卷和独立 PostgreSQL 均已清理，用户原有演示栈未修改。

## 当前边界

- API 请求超时或调用方取消只会中止 HTTP 等待并落稳定作业终态；当前同步 FastAPI 求解会在线程中继续到 OR-Tools 返回，不宣称已经具备跨进程强制终止或中间最优解保留。
- 当前没有 Redis/BullMQ、Outbox Publisher、独立 Worker、可靠重试、运行中协作取消或 SSE 补发；CR-007 仍未解决。
- 规模 profile 显式关闭连续监考软目标；固定 100 分制在大规模下会因累计惩罚饱和到 0，暂不支持跨批次质量比较。
- scheduler 在本地 Compose 为便于验证映射宿主机端口；未来腾讯云私有试部署应只在内部网络暴露，并由 nginx/API 提供外部边界。
- CI 尚未配置自动发布、镜像推送、分支保护、备份恢复或生产回滚流水线。

## 下一步

1. 等待用户确认第五版第二阶段结果，不自动开始第三阶段。
2. 确认后按 `docs/plan/第五版第三阶段计划.md` 顺序实施 Redis/BullMQ、Outbox Publisher、独立 Worker、幂等重试/取消/超时和可补发 SSE，并在单独授权后进行腾讯云私有试部署。
3. 第三阶段完成时重评 CR-007；CR-002、CR-003 按各自重评条件持续跟踪，不提前混入完整任务中心、约束策略或页面级前端重构。
