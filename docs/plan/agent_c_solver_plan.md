# Agent C 硬约束求解器实现计划

## 1. 目标

实现第一版 CP-SAT 硬约束求解器，为可行测试数据生成 `ScheduleResult`，并在小规模数据上证明排考结果不违反核心硬约束。

## 2. 范围

本轮包含：

- 新增 `examforge_scheduler/solver.py`。
- 在 `pyproject.toml` 引入 OR-Tools 依赖。
- 新增 `tests/test_solver_hard_constraints.py`。
- 实现考试到 `(room, slot)` 的布尔变量模型，并用简单贪心策略补齐监考教师。

本轮不包含：

- 不实现预检规则和完整冲突解释。
- 不实现软约束评分。
- 不实现报告生成。
- 不创建 Web、API、数据库或队列。

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

如果 OR-Tools 安装失败，记录 Python 版本、安装命令和失败原因，不要改用手写暴力搜索替代 CP-SAT。

## 4. 文件职责

- 创建 `apps/scheduler/examforge_scheduler/solver.py`：提供 `solve_schedule(schedule_input: ScheduleInput) -> ScheduleResult`。
- 修改 `apps/scheduler/pyproject.toml`：添加 `ortools` 运行时依赖。
- 创建 `apps/scheduler/tests/test_solver_hard_constraints.py`：覆盖小规模可行数据和典型不可行数据。

不要依赖 Agent B 的 `precheck.py` 或 Agent D 的 `scoring.py`，保持本分支可独立测试。

## 5. 任务清单

- [ ] 为每个合法 `(exam_task, room, time_slot)` 组合创建布尔变量 `x[exam_id, room_id, slot_id]`。
- [ ] 对每场考试添加“必须且只能选择一个组合”的约束。
- [ ] 添加同一考场同一时间段最多一场考试的约束。
- [ ] 添加同一学生群体同一时间段最多一场考试的约束。
- [ ] 在变量候选阶段排除容量不足、考场类型不匹配、设备不满足和不在允许时间段内的组合。
- [ ] 求解后为每场考试分配满足不可用时间和同时间唯一性的监考教师；无法满足时返回 `PARTIAL` 或 `INFEASIBLE`。
- [ ] 返回 `ScheduleResult`，其中 `statistics` 包含状态、耗时、考试数、考场数、时间段数和候选组合数。
- [ ] 不计算正式软约束分数，先返回空惩罚项和基准分。

## 6. 验证方式

在 `apps/scheduler/` 下运行：

```bash
python -m pytest tests/test_solver_hard_constraints.py -q
python -m pytest -q
```

在仓库根目录运行：

```bash
git diff --check
```

## 7. 交付物

- `apps/scheduler/examforge_scheduler/solver.py`
- `apps/scheduler/tests/test_solver_hard_constraints.py`
- `apps/scheduler/pyproject.toml`
- 本地提交，建议提交信息：`feat(调度器): 添加硬约束求解器`
