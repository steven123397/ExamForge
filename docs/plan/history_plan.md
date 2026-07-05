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
- 完成提交：`a3c7b31 feat(调度器): 添加评分与报告`
- 完成内容：创建 `examforge_scheduler/scoring.py` 和 `examforge_scheduler/report.py`，实现四类软约束评分、评分下限、报告统计摘要、冲突摘要、评分摘要、考场利用率摘要和教师工作量摘要，并补充 `test_scoring.py`、`test_report.py`。
- 范围边界：未实现预检、冲突解释、CP-SAT 求解器、Web、API、数据库、图表库或文件导出；评分和报告测试均基于手工构造的 `ScheduledExam` 与 `ScheduleResult`。
- 验证结果：分支内运行评分与报告测试结果为 `8 passed`；合并后随全量调度器测试一起通过。
- 后续影响：后续整合时可直接复用 `calculate_score()` 和 `build_schedule_report()` 作为排考结果输出阶段。

## 2026-07-05 Agent B 预检与冲突解释

- 原计划：`docs/plan/agent_b_precheck_conflicts_plan.md`
- 完成提交：`d8bbefc feat(调度器): 添加预检与冲突解释`
- 合并提交：`04f29ce merge: 集成 Agent B 预检与冲突解释`
- 完成内容：创建 `examforge_scheduler/precheck.py` 和 `examforge_scheduler/conflicts.py`，实现容量、考场条件、时间窗口、学生群体过载、教师不可用等预检冲突，并实现未排考试、考场时间冲突、学生群体冲突、教师时间冲突、容量不匹配和考场要求不匹配等排考结果冲突检测。
- 范围边界：未实现求解器、软约束评分、Web、API、数据库或命令行界面。
- 验证结果：分支内运行 `uv run --python 3.12 --extra dev python -m pytest tests/test_precheck.py tests/test_conflicts.py -q`，结果为 `12 passed`；合并后随全量调度器测试一起通过。
- 后续影响：求解前可用 `run_precheck()` 快速识别明显不可行数据，求解后可用 `detect_assignment_conflicts()` 对排考结果做硬约束复核。

## 2026-07-05 Agent C 硬约束求解器

- 原计划：`docs/plan/agent_c_solver_plan.md`
- 完成提交：`8deb43e feat(调度器): 添加硬约束求解器`
- 合并提交：`48013db merge: 集成 Agent C 硬约束求解器`
- 完成内容：创建 `examforge_scheduler/solver.py`，引入 OR-Tools 依赖，实现基于布尔变量 `x[exam_id, room_id, slot_id]` 的 CP-SAT 硬约束求解器，并补充硬约束求解测试。
- 范围边界：未实现正式软约束优化目标、Web、API、数据库或队列；监考教师分配采用求解后贪心策略。
- 验证结果：分支内运行 `uv run --python 3.12 --extra dev python -m pytest tests/test_solver_hard_constraints.py -q`，结果为 `3 passed`；合并后随全量调度器测试一起通过。
- 后续影响：第一版调度器现在可以从结构化测试数据生成排考结果，并返回 `ScheduleResult`、求解统计和硬约束失败原因。

## 2026-07-05 Agent B/C/D 集成

- 合并提交：`04f29ce`、`48013db`、`045fab3`
- 完成内容：将预检与冲突解释、硬约束求解器、软约束评分与报告整理合并到 `main`，并在 `examforge_scheduler/__init__.py` 同时导出 `solve_schedule()`、`calculate_score()` 和 `build_schedule_report()`。
- 验证结果：在 `apps/scheduler/` 下运行 `uv run --python 3.12 --extra dev python -m pytest -q`，最终结果为 `31 passed`；仓库根目录运行 `git diff --check`，结果为通过。
- 当前风险：默认系统 `python` 命令仍不存在，`python3` 为 3.10.12；调度器验证应继续使用 `uv run --python 3.12 --extra dev` 或准备正式 Python 3.12 虚拟环境。
