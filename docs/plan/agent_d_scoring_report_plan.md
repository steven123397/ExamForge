# Agent D 评分与报告实现计划

## 1. 目标

实现第一版软约束评分和运行报告整理，使已有排考结果可以输出评分明细、统计摘要和课程报告可复用数据。

## 2. 范围

本轮包含：

- 新增 `examforge_scheduler/scoring.py`。
- 新增 `examforge_scheduler/report.py`。
- 新增 `tests/test_scoring.py` 和 `tests/test_report.py`。
- 基于手工构造的 `ScheduledExam` 测试评分和报告，不依赖求解器实现。

本轮不包含：

- 不实现预检和冲突解释。
- 不实现 CP-SAT 求解器。
- 不引入 Web、API、数据库、图表库或文件导出。

## 3. 前置条件

执行前阅读：

- `AGENTS.md`
- `apps/AGENTS.md`
- `apps/scheduler/AGENTS.md`
- `docs/design/第一版实现内容设计.md`
- `docs/status/project_status.md`

执行前检查：

```bash
git status --short --branch
```

本计划只处理纯 Python 逻辑，不应引入额外运行时依赖。

## 4. 文件职责

- 创建 `apps/scheduler/examforge_scheduler/scoring.py`：提供 `calculate_score(schedule_input: ScheduleInput, assignments: tuple[ScheduledExam, ...]) -> ScoreBreakdown`。
- 创建 `apps/scheduler/examforge_scheduler/report.py`：提供 `build_schedule_report(schedule_input: ScheduleInput, result: ScheduleResult) -> dict[str, object]`。
- 创建 `apps/scheduler/tests/test_scoring.py`：覆盖连续考试、教师工作量、考场利用率和考试日期分布评分。
- 创建 `apps/scheduler/tests/test_report.py`：覆盖统计摘要、冲突摘要、评分摘要和可序列化结构。

除非为测试修复明显模型缺口，不修改 `models.py`、`generator.py` 和 `pyproject.toml`。

## 5. 任务清单

- [ ] 实现 `student_consecutive_exam`：同一学生群体相邻 `period_index` 连续考试时按权重扣分。
- [ ] 实现 `teacher_workload_balance`：教师监考次数偏离平均值时扣分。
- [ ] 实现 `room_utilization`：考场容量利用率过低时扣分。
- [ ] 实现 `exam_distribution_balance`：考试集中在少数日期时扣分。
- [ ] 输出 `ScoreBreakdown(total_score, hard_violation_count, soft_penalty_items)`，分数下限为 0。
- [ ] 报告结构包含考试数、已排考试数、冲突数量、状态、总分、惩罚项列表、考场利用率摘要和教师工作量摘要。
- [ ] 测试中手工构造 `ScheduleResult`，避免依赖 Agent C 的求解器。

## 6. 验证方式

在 `apps/scheduler/` 下运行：

```bash
python -m pytest tests/test_scoring.py tests/test_report.py -q
python -m pytest -q
```

在仓库根目录运行：

```bash
git diff --check
```

## 7. 交付物

- `apps/scheduler/examforge_scheduler/scoring.py`
- `apps/scheduler/examforge_scheduler/report.py`
- `apps/scheduler/tests/test_scoring.py`
- `apps/scheduler/tests/test_report.py`
- 本地提交，建议提交信息：`feat(调度器): 添加评分与报告`
