# ExamForge 项目状态

## 当前结论

项目已完成正式需求分析、总体设计、第一版实现内容设计和可行性分析。实现路线暂以 `apps/scheduler/` 的 Python 排考算法原型为第一阶段核心，完整 Web 平台、API、数据库和部署能力后移到算法闭环验证之后。

## 最新进展

- 日期：2026-07-05
- 变更：Agent A 已完成调度器数据模型与测试数据生成器，并形成本地提交 `ff195cb feat(调度器): 添加数据模型与测试数据生成器`。
- 变更：文档治理规则改为简化版单一事实源，完成计划统一沉淀到 `docs/plan/history_plan.md`，不使用专门归档目录。
- 变更：已拆分 Agent B、Agent C、Agent D 三条并行计划，分别覆盖预检与冲突解释、硬约束求解器、软约束评分与报告。
- 验证：当前本机复核可运行 `git diff --check`；调度器测试需要满足 `apps/scheduler/pyproject.toml` 的 Python 版本和 pytest 依赖。

## 当前风险

- 风险：本机默认 `python` 命令不可用，`python3` 为 3.10.12，而调度器配置要求 Python 3.12 及以上。
- 影响：不能在当前默认环境直接确认 Agent A 的 pytest 全量通过。
- 处理建议：创建 Python 3.12 虚拟环境并安装 `apps/scheduler` 测试依赖后再运行调度器测试。

## 下一步

- [ ] 在独立 worktree 中启动 Agent B，基于现有数据模型实现确定性预检和冲突解释基础规则。
- [ ] 在独立 worktree 中启动 Agent C，实现 CP-SAT 硬约束求解器。
- [ ] 在独立 worktree 中启动 Agent D，实现软约束评分和报告整理。
- [ ] 准备 Python 3.12 开发环境，统一调度器测试命令。
