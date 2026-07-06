# ExamForge 项目状态

## 当前结论

项目已完成正式需求分析、总体设计、第一版实现内容设计和可行性分析。第一版 `apps/scheduler/` Python 排考算法原型的核心模块已合并到 `main`，包括数据模型、测试数据生成、预检、冲突解释、硬约束求解器、软约束评分和报告整理。当前主线已切换为企业级全栈排考运营平台第一阶段，在 `main` 上直接实现 Web、API、数据库和调度器集成闭环。

## 最新进展

- 日期：2026-07-05
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
- 验证：当前全栈第一阶段验证包括 `apps/scheduler` 全量测试 `32 passed`、API 测试 `4 passed`、`npm run typecheck` 通过、`npm run build` 通过、`git diff --check` 通过。

## 当前风险

- 风险：本机默认 `python` 命令不可用，`python3` 为 3.10.12，而调度器配置要求 Python 3.12 及以上。
- 影响：不能在当前默认环境直接运行计划中的裸 `python -m pytest` 命令。
- 处理建议：创建 Python 3.12 虚拟环境并安装 `apps/scheduler` 测试依赖后再运行调度器测试。
- 风险：`npm audit` 仍报告 Next 15.5.20 依赖链中的 2 个 moderate 级 PostCSS 相关公告，npm 给出的自动修复方案会降级到不适合本项目的旧 Next 版本。
- 影响：当前不阻塞本地演示，但后续应跟踪 Next 官方依赖更新。
- 处理建议：保留审计记录，后续升级 Next 或等待其依赖 PostCSS 修复版本。
- 风险：当前机器未安装 `docker` 命令，无法在本机启动临时 PostgreSQL 容器完成真实数据库运行验证。
- 影响：PostgreSQL 路径已经通过 TypeScript 类型检查、构建和 API 仓储工厂测试覆盖，但 seed/API 对真实 PostgreSQL 的运行验证仍需在具备 Docker 或 PostgreSQL 的环境执行。
- 处理建议：安装 Docker 或提供可用 `DATABASE_URL` 后，按顺序执行 `packages/db/drizzle/*.sql`、`npm run seed --workspace @examforge/db` 和一次 API 排考运行验证。

## 下一步

- [x] 将 API 内置演示仓储替换为 PostgreSQL 持久化仓储。
- [ ] 增加基础数据管理页面的编辑能力。
- [ ] 增加排考运行历史、版本对比和审计详情。
