# Agent B 预检与冲突解释实现计划

## 1. 目标

实现第一版确定性预检和求解后冲突解释，使调度器能在不运行求解器的情况下识别明显不可行数据，并能对已有排考结果输出结构化冲突。

## 2. 范围

本轮包含：

- 新增 `examforge_scheduler/precheck.py`。
- 新增 `examforge_scheduler/conflicts.py`。
- 新增 `tests/test_precheck.py` 和 `tests/test_conflicts.py`。
- 基于现有 `ConflictRecord` 和 `ConflictSeverity` 输出业务化冲突说明。

本轮不包含：

- 不实现 `solver.py`。
- 不引入 OR-Tools。
- 不实现软约束评分。
- 不创建 Web、API、数据库或命令行界面。

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

如本机缺少 Python 3.12 或 pytest，先报告环境阻塞，不要声称测试通过。

## 4. 文件职责

- 创建 `apps/scheduler/examforge_scheduler/precheck.py`：提供 `run_precheck(schedule_input: ScheduleInput) -> tuple[ConflictRecord, ...]`。
- 创建 `apps/scheduler/examforge_scheduler/conflicts.py`：提供 `detect_assignment_conflicts(schedule_input: ScheduleInput, assignments: tuple[ScheduledExam, ...]) -> tuple[ConflictRecord, ...]`。
- 创建 `apps/scheduler/tests/test_precheck.py`：覆盖容量、考场条件、时间窗口、学生群体过载和教师不可用预检。
- 创建 `apps/scheduler/tests/test_conflicts.py`：覆盖未排考试、考场时间冲突、学生群体冲突、教师时间冲突、容量不匹配和考场要求不匹配。

除非测试确实需要，不修改 `models.py`、`generator.py` 和 `pyproject.toml`。

## 5. 任务清单

- [ ] 实现候选考场筛选：容量、考场类型、设备标签必须满足考试任务要求。
- [ ] 实现候选时间筛选：`allowed_slot_ids` 为空时视为所有时间段可选；非空时必须引用有效时间段。
- [ ] 实现 `capacity_impossible`、`no_available_room`、`no_allowed_slot`、`student_group_overloaded`、`teacher_unavailable` 五类预检冲突。
- [ ] 实现排考结果冲突检测：未排考试、同一考场同一时间段、同一学生群体同一时间段、同一教师同一时间段、容量不足、考场类型或设备不满足。
- [ ] 每条冲突都填充 `type`、`severity`、`affected_ids`、`message`、`suggestion`。
- [ ] 补充测试，优先复用 `generator.py` 中已有冲突数据，并在测试内构造缺失场景。

## 6. 验证方式

在 `apps/scheduler/` 下运行：

```bash
python -m pytest tests/test_precheck.py tests/test_conflicts.py -q
python -m pytest -q
```

在仓库根目录运行：

```bash
git diff --check
```

## 7. 交付物

- `apps/scheduler/examforge_scheduler/precheck.py`
- `apps/scheduler/examforge_scheduler/conflicts.py`
- `apps/scheduler/tests/test_precheck.py`
- `apps/scheduler/tests/test_conflicts.py`
- 本地提交，建议提交信息：`feat(调度器): 添加预检与冲突解释`
