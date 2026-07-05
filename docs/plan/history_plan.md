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
- 完成证据：本分支新增评分与报告实现并通过计划验证命令。
- 完成内容：创建 `examforge_scheduler/scoring.py` 和 `examforge_scheduler/report.py`，实现四类软约束评分、评分下限、报告统计摘要、冲突摘要、评分摘要、考场利用率摘要和教师工作量摘要，并补充 `test_scoring.py`、`test_report.py`。
- 范围边界：未实现预检、冲突解释、CP-SAT 求解器、Web、API、数据库、图表库或文件导出；评分和报告测试均基于手工构造的 `ScheduledExam` 与 `ScheduleResult`。
- 验证结果：在 `apps/scheduler/` 下运行 `uv run --no-project --python 3.12 --with pytest python -m pytest tests/test_scoring.py tests/test_report.py -q`，结果为 `8 passed`；运行 `uv run --no-project --python 3.12 --with pytest python -m pytest -q`，结果为 `16 passed`；仓库根目录运行 `git diff --check`，结果为通过。
- 后续影响：Agent B 与 Agent C 可继续分别实现预检/冲突解释和求解器；后续整合时可直接复用 `calculate_score()` 和 `build_schedule_report()` 作为排考结果输出阶段。
