# ExamForge 项目状态

## 当前结论

项目已完成正式需求分析、总体设计、第一版实现内容设计和可行性分析。第一版 `apps/scheduler/` Python 排考算法原型的核心模块已合并到 `main`，包括数据模型、测试数据生成、预检、冲突解释、硬约束求解器、软约束评分和报告整理。完整 Web 平台、API、数据库和部署能力仍后移到下一阶段。

## 最新进展

- 日期：2026-07-05
- 变更：Agent A 已完成调度器数据模型与测试数据生成器，并形成本地提交 `ff195cb feat(调度器): 添加数据模型与测试数据生成器`。
- 变更：文档治理规则改为简化版单一事实源，完成计划统一沉淀到 `docs/plan/history_plan.md`，不使用专门归档目录。
- 变更：Agent B、Agent C、Agent D 三条并行实现分支已合并到 `main`。
- 变更：Agent B 实现 `run_precheck()` 和 `detect_assignment_conflicts()`。
- 变更：Agent C 实现 `solve_schedule()` 并引入 OR-Tools CP-SAT。
- 变更：Agent D 实现 `calculate_score()` 和 `build_schedule_report()`。
- 验证：合并后在 `apps/scheduler/` 下运行 `uv run --python 3.12 --extra dev python -m pytest -q`，最终结果为 `31 passed`；仓库根目录运行 `git diff --check`，结果为通过。

## 当前风险

- 风险：本机默认 `python` 命令不可用，`python3` 为 3.10.12，而调度器配置要求 Python 3.12 及以上。
- 影响：不能在当前默认环境直接运行计划中的裸 `python -m pytest` 命令。
- 处理建议：创建 Python 3.12 虚拟环境并安装 `apps/scheduler` 测试依赖后再运行调度器测试。
## 下一步

- [ ] 准备 Python 3.12 开发环境，统一调度器测试命令。
- [ ] 将预检、求解、评分和报告串成一个演示脚本或 CLI。
- [ ] 将算法流程、测试数据和验证结果整理为课程报告素材。
