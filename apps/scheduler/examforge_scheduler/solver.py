from dataclasses import dataclass
from time import perf_counter

from ortools.sat.python import cp_model

from .models import (
    ConflictRecord,
    ConflictSeverity,
    ScheduleInput,
    ScheduleResult,
    ScheduledExam,
    ScoreBreakdown,
    SolveStatus,
    SolverStatistics,
    Teacher,
    validate_schedule_input,
)
from .scoring import LOW_ROOM_UTILIZATION_THRESHOLD, calculate_score


@dataclass(frozen=True)
class _Candidate:
    exam_task_id: str
    room_id: str
    slot_id: str


def solve_schedule(schedule_input: ScheduleInput) -> ScheduleResult:
    started_at = perf_counter()
    validation_errors = validate_schedule_input(schedule_input)
    if validation_errors:
        conflicts = tuple(
            ConflictRecord(
                type="input_validation_error",
                severity=ConflictSeverity.ERROR,
                affected_ids=(),
                message=error,
                suggestion="请修正输入数据后重新排考。",
            )
            for error in validation_errors
        )
        return _build_result(
            schedule_input=schedule_input,
            status=SolveStatus.ERROR,
            started_at=started_at,
            attempted_assignments=0,
            conflicts=conflicts,
        )

    candidates_by_task = _build_candidates(schedule_input)
    attempted_assignments = sum(
        len(candidates) for candidates in candidates_by_task.values()
    )
    missing_candidate_conflicts = _missing_candidate_conflicts(
        schedule_input, candidates_by_task
    )
    fixed_assignment_conflicts = _fixed_assignment_conflicts(
        schedule_input, candidates_by_task
    )
    if missing_candidate_conflicts or fixed_assignment_conflicts:
        return _build_result(
            schedule_input=schedule_input,
            status=SolveStatus.INFEASIBLE,
            started_at=started_at,
            attempted_assignments=attempted_assignments,
            conflicts=missing_candidate_conflicts + fixed_assignment_conflicts,
        )

    model = cp_model.CpModel()
    variables: dict[_Candidate, cp_model.IntVar] = {}
    for candidates in candidates_by_task.values():
        for candidate in candidates:
            variables[candidate] = model.NewBoolVar(
                f"x_{candidate.exam_task_id}_{candidate.room_id}_{candidate.slot_id}"
            )

    _add_exam_assignment_constraints(model, candidates_by_task, variables)
    _add_room_time_constraints(model, variables)
    _add_student_group_constraints(schedule_input, model, variables)
    _add_fixed_assignment_constraints(schedule_input, model, variables)
    objective_terms = _build_soft_objective_terms(schedule_input, model, variables)
    if objective_terms:
        model.Minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(
        1, schedule_input.constraint_profile.time_limit_seconds
    )
    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        conflict_type = "solver_infeasible"
        result_status = SolveStatus.INFEASIBLE
        suggestion = "请增加考场、时间段或放宽考试允许时间后重新排考。"
        if status == cp_model.UNKNOWN:
            conflict_type = "solver_no_solution_within_time_limit"
            result_status = SolveStatus.PARTIAL
            suggestion = "请提高求解时间限制或缩小排考批次后重新尝试。"
        conflicts = (
            ConflictRecord(
                type=conflict_type,
                severity=ConflictSeverity.ERROR,
                affected_ids=tuple(task.id for task in schedule_input.exam_tasks),
                message="CP-SAT 未能找到满足硬约束的考场与时间安排。",
                suggestion=suggestion,
            ),
        )
        return _build_result(
            schedule_input=schedule_input,
            status=result_status,
            started_at=started_at,
            attempted_assignments=attempted_assignments,
            conflicts=conflicts,
        )

    assignments = _extract_assignments(schedule_input, variables, solver)
    assignments_with_teachers, teacher_conflicts = _assign_teachers(
        schedule_input, assignments
    )
    if teacher_conflicts:
        return _build_result(
            schedule_input=schedule_input,
            status=SolveStatus.PARTIAL,
            started_at=started_at,
            attempted_assignments=attempted_assignments,
            conflicts=teacher_conflicts,
        )

    return _build_result(
        schedule_input=schedule_input,
        status=SolveStatus.FEASIBLE,
        started_at=started_at,
        attempted_assignments=attempted_assignments,
        assignments=tuple(assignments_with_teachers),
    )


def _build_candidates(
    schedule_input: ScheduleInput,
) -> dict[str, tuple[_Candidate, ...]]:
    all_slot_ids = tuple(slot.id for slot in schedule_input.time_slots)
    candidates_by_task: dict[str, tuple[_Candidate, ...]] = {}

    for task in schedule_input.exam_tasks:
        allowed_slot_ids = set(task.allowed_slot_ids or all_slot_ids)
        task_candidates: list[_Candidate] = []
        for room in schedule_input.rooms:
            if room.capacity < task.expected_count:
                continue
            if room.room_type != task.required_room_type:
                continue
            if not set(task.required_equipment_tags).issubset(room.equipment_tags):
                continue
            for slot in schedule_input.time_slots:
                if slot.id not in allowed_slot_ids:
                    continue
                task_candidates.append(
                    _Candidate(
                        exam_task_id=task.id,
                        room_id=room.id,
                        slot_id=slot.id,
                    )
                )
        candidates_by_task[task.id] = tuple(task_candidates)

    return candidates_by_task


def _missing_candidate_conflicts(
    schedule_input: ScheduleInput,
    candidates_by_task: dict[str, tuple[_Candidate, ...]],
) -> tuple[ConflictRecord, ...]:
    conflicts: list[ConflictRecord] = []
    for task in schedule_input.exam_tasks:
        if candidates_by_task[task.id]:
            continue
        conflicts.append(
            ConflictRecord(
                type="no_candidate_assignment",
                severity=ConflictSeverity.ERROR,
                affected_ids=(task.id,),
                message=f"考试 {task.id} 没有满足容量、类型、设备和允许时间的候选安排。",
                suggestion="请调整考场容量、考场类型设备或该考试的允许时间段。",
            )
        )
    return tuple(conflicts)


def _fixed_assignment_conflicts(
    schedule_input: ScheduleInput,
    candidates_by_task: dict[str, tuple[_Candidate, ...]],
) -> tuple[ConflictRecord, ...]:
    conflicts: list[ConflictRecord] = []
    for fixed_assignment in schedule_input.fixed_assignments:
        expected_candidate = _Candidate(
            exam_task_id=fixed_assignment.exam_task_id,
            room_id=fixed_assignment.room_id,
            slot_id=fixed_assignment.time_slot_id,
        )
        if expected_candidate in candidates_by_task.get(
            fixed_assignment.exam_task_id, ()
        ):
            continue
        conflicts.append(
            ConflictRecord(
                type="fixed_assignment_no_candidate",
                severity=ConflictSeverity.ERROR,
                affected_ids=(fixed_assignment.exam_task_id,),
                message=(
                    f"固定安排 {fixed_assignment.exam_task_id} 无法映射到满足容量、"
                    "类型、设备和允许时间的候选安排。"
                ),
                suggestion="请调整固定考场、固定时间或该考试的约束条件。",
            )
        )
    return tuple(conflicts)


def _add_exam_assignment_constraints(
    model: cp_model.CpModel,
    candidates_by_task: dict[str, tuple[_Candidate, ...]],
    variables: dict[_Candidate, cp_model.IntVar],
) -> None:
    for candidates in candidates_by_task.values():
        model.AddExactlyOne(variables[candidate] for candidate in candidates)


def _add_room_time_constraints(
    model: cp_model.CpModel,
    variables: dict[_Candidate, cp_model.IntVar],
) -> None:
    room_slot_pairs = {
        (candidate.room_id, candidate.slot_id) for candidate in variables
    }
    for room_id, slot_id in room_slot_pairs:
        model.Add(
            sum(
                variable
                for candidate, variable in variables.items()
                if candidate.room_id == room_id and candidate.slot_id == slot_id
            )
            <= 1
        )


def _add_student_group_constraints(
    schedule_input: ScheduleInput,
    model: cp_model.CpModel,
    variables: dict[_Candidate, cp_model.IntVar],
) -> None:
    tasks_by_id = {task.id: task for task in schedule_input.exam_tasks}
    group_ids = {group.id for group in schedule_input.student_groups}
    slot_ids = {slot.id for slot in schedule_input.time_slots}

    for group_id in group_ids:
        for slot_id in slot_ids:
            group_slot_variables = [
                variable
                for candidate, variable in variables.items()
                if candidate.slot_id == slot_id
                and group_id in tasks_by_id[candidate.exam_task_id].student_group_ids
            ]
            if group_slot_variables:
                model.Add(sum(group_slot_variables) <= 1)


def _add_fixed_assignment_constraints(
    schedule_input: ScheduleInput,
    model: cp_model.CpModel,
    variables: dict[_Candidate, cp_model.IntVar],
) -> None:
    for fixed_assignment in schedule_input.fixed_assignments:
        candidate = _Candidate(
            exam_task_id=fixed_assignment.exam_task_id,
            room_id=fixed_assignment.room_id,
            slot_id=fixed_assignment.time_slot_id,
        )
        if candidate in variables:
            model.Add(variables[candidate] == 1)


def _build_soft_objective_terms(
    schedule_input: ScheduleInput,
    model: cp_model.CpModel,
    variables: dict[_Candidate, cp_model.IntVar],
) -> list:
    return [
        *_room_utilization_terms(schedule_input, variables),
        *_student_consecutive_exam_terms(schedule_input, model, variables),
        *_exam_distribution_balance_terms(schedule_input, model, variables),
    ]


def _room_utilization_terms(
    schedule_input: ScheduleInput,
    variables: dict[_Candidate, cp_model.IntVar],
) -> list:
    weight = schedule_input.constraint_profile.soft_weights.get("room_utilization", 0)
    if weight <= 0:
        return []

    tasks_by_id = {task.id: task for task in schedule_input.exam_tasks}
    rooms_by_id = {room.id: room for room in schedule_input.rooms}
    terms = []

    for candidate, variable in variables.items():
        task = tasks_by_id[candidate.exam_task_id]
        room = rooms_by_id[candidate.room_id]
        if room.capacity <= 0:
            continue
        utilization = task.expected_count / room.capacity
        if utilization < LOW_ROOM_UTILIZATION_THRESHOLD:
            terms.append(variable * weight)

    return terms


def _student_consecutive_exam_terms(
    schedule_input: ScheduleInput,
    model: cp_model.CpModel,
    variables: dict[_Candidate, cp_model.IntVar],
) -> list:
    weight = schedule_input.constraint_profile.soft_weights.get(
        "student_consecutive_exam", 0
    )
    if weight <= 0:
        return []

    tasks_by_id = {task.id: task for task in schedule_input.exam_tasks}
    slots_by_id = {slot.id: slot for slot in schedule_input.time_slots}
    terms = []
    penalty_index = 0

    task_pairs: set[tuple[str, str]] = set()
    for group in schedule_input.student_groups:
        group_task_ids = [
            task.id
            for task in schedule_input.exam_tasks
            if group.id in task.student_group_ids
        ]
        for left_index, left_task_id in enumerate(group_task_ids):
            for right_task_id in group_task_ids[left_index + 1 :]:
                task_pairs.add((left_task_id, right_task_id))

    for left_task_id, right_task_id in task_pairs:
        for left_candidate, left_variable in variables.items():
            if left_candidate.exam_task_id != left_task_id:
                continue
            left_slot = slots_by_id[left_candidate.slot_id]
            for right_candidate, right_variable in variables.items():
                if right_candidate.exam_task_id != right_task_id:
                    continue
                right_slot = slots_by_id[right_candidate.slot_id]
                if abs(left_slot.period_index - right_slot.period_index) != 1:
                    continue
                penalty = model.NewBoolVar(
                    "student_consecutive_exam"
                    f"_{left_task_id}_{right_task_id}_{penalty_index}"
                )
                model.Add(penalty <= left_variable)
                model.Add(penalty <= right_variable)
                model.Add(penalty >= left_variable + right_variable - 1)
                terms.append(penalty * weight)
                penalty_index += 1

    return terms


def _exam_distribution_balance_terms(
    schedule_input: ScheduleInput,
    model: cp_model.CpModel,
    variables: dict[_Candidate, cp_model.IntVar],
) -> list:
    weight = schedule_input.constraint_profile.soft_weights.get(
        "exam_distribution_balance", 0
    )
    dates = sorted({slot.date for slot in schedule_input.time_slots})
    if weight <= 0 or not dates or not schedule_input.exam_tasks:
        return []

    date_by_slot_id = {slot.id: slot.date for slot in schedule_input.time_slots}
    exam_count = len(schedule_input.exam_tasks)
    date_count = len(dates)
    terms = []

    for date in dates:
        date_variables = [
            variable
            for candidate, variable in variables.items()
            if date_by_slot_id[candidate.slot_id] == date
        ]
        if not date_variables:
            continue
        selected_count = sum(date_variables)
        scaled_excess = model.NewIntVar(
            0,
            exam_count * date_count,
            f"exam_distribution_scaled_excess_{date}",
        )
        penalty_units = model.NewIntVar(
            0,
            exam_count,
            f"exam_distribution_penalty_{date}",
        )
        model.Add(scaled_excess >= selected_count * date_count - exam_count)
        model.Add(penalty_units * date_count >= scaled_excess)
        terms.append(penalty_units * weight)

    return terms


def _extract_assignments(
    schedule_input: ScheduleInput,
    variables: dict[_Candidate, cp_model.IntVar],
    solver: cp_model.CpSolver,
) -> tuple[ScheduledExam, ...]:
    assignment_by_task: dict[str, ScheduledExam] = {}
    for candidate, variable in variables.items():
        if solver.BooleanValue(variable):
            assignment_by_task[candidate.exam_task_id] = ScheduledExam(
                exam_task_id=candidate.exam_task_id,
                room_id=candidate.room_id,
                time_slot_id=candidate.slot_id,
            )

    return tuple(
        assignment_by_task[task.id] for task in schedule_input.exam_tasks
    )


def _assign_teachers(
    schedule_input: ScheduleInput,
    assignments: tuple[ScheduledExam, ...],
) -> tuple[tuple[ScheduledExam, ...], tuple[ConflictRecord, ...]]:
    tasks_by_id = {task.id: task for task in schedule_input.exam_tasks}
    teachers_by_id = {teacher.id: teacher for teacher in schedule_input.teachers}
    fixed_assignments_by_task = {
        assignment.exam_task_id: assignment
        for assignment in schedule_input.fixed_assignments
    }
    busy_teacher_slots: set[tuple[str, str]] = set()
    teacher_workload = {teacher.id: 0 for teacher in schedule_input.teachers}
    assignments_with_teachers: list[ScheduledExam] = []
    conflicts: list[ConflictRecord] = []

    for assignment in sorted(
        assignments, key=lambda item: (item.time_slot_id, item.exam_task_id)
    ):
        task = tasks_by_id[assignment.exam_task_id]
        fixed_assignment = fixed_assignments_by_task.get(assignment.exam_task_id)
        fixed_teacher_ids = (
            tuple(fixed_assignment.teacher_ids) if fixed_assignment else ()
        )
        if fixed_teacher_ids:
            teacher_ids = list(fixed_teacher_ids)
            fixed_teacher_conflict = _fixed_teacher_conflict(
                assignment=assignment,
                task_invigilator_count=task.invigilator_count,
                teacher_ids=teacher_ids,
                teachers_by_id=teachers_by_id,
                busy_teacher_slots=busy_teacher_slots,
            )
            if fixed_teacher_conflict:
                conflicts.append(fixed_teacher_conflict)
                continue
        else:
            teacher_ids = []
            for teacher in sorted(
                schedule_input.teachers,
                key=lambda item: (teacher_workload[item.id], item.id),
            ):
                if assignment.time_slot_id in teacher.unavailable_slot_ids:
                    continue
                teacher_slot = (teacher.id, assignment.time_slot_id)
                if teacher_slot in busy_teacher_slots:
                    continue
                teacher_ids.append(teacher.id)
                if len(teacher_ids) == task.invigilator_count:
                    break

        if len(teacher_ids) < task.invigilator_count:
            conflicts.append(
                ConflictRecord(
                    type="teacher_assignment_failed",
                    severity=ConflictSeverity.ERROR,
                    affected_ids=(assignment.exam_task_id,),
                    message=f"考试 {assignment.exam_task_id} 无法分配足够的可用监考教师。",
                    suggestion="请增加可用教师、调整教师不可用时间或减少同时间段考试数量。",
                )
            )
            continue

        for teacher_id in teacher_ids:
            busy_teacher_slots.add((teacher_id, assignment.time_slot_id))
            teacher_workload[teacher_id] += 1

        assignments_with_teachers.append(
            ScheduledExam(
                exam_task_id=assignment.exam_task_id,
                room_id=assignment.room_id,
                time_slot_id=assignment.time_slot_id,
                teacher_ids=tuple(teacher_ids),
            )
        )

    if conflicts:
        return (), tuple(conflicts)

    return tuple(assignments_with_teachers), ()


def _fixed_teacher_conflict(
    *,
    assignment: ScheduledExam,
    task_invigilator_count: int,
    teacher_ids: list[str],
    teachers_by_id: dict[str, Teacher],
    busy_teacher_slots: set[tuple[str, str]],
) -> ConflictRecord | None:
    if len(set(teacher_ids)) != len(teacher_ids):
        return ConflictRecord(
            type="fixed_teacher_assignment_conflict",
            severity=ConflictSeverity.ERROR,
            affected_ids=(assignment.exam_task_id,),
            message=f"考试 {assignment.exam_task_id} 的固定监考教师存在重复。",
            suggestion="请为固定安排选择不重复的监考教师。",
        )
    if len(teacher_ids) < task_invigilator_count:
        return ConflictRecord(
            type="fixed_teacher_assignment_conflict",
            severity=ConflictSeverity.ERROR,
            affected_ids=(assignment.exam_task_id,),
            message=f"考试 {assignment.exam_task_id} 的固定监考教师数量不足。",
            suggestion="请补齐固定监考教师或移除固定教师约束。",
        )
    for teacher_id in teacher_ids:
        teacher = teachers_by_id[teacher_id]
        if assignment.time_slot_id in teacher.unavailable_slot_ids:
            return ConflictRecord(
                type="fixed_teacher_assignment_conflict",
                severity=ConflictSeverity.ERROR,
                affected_ids=(assignment.exam_task_id, teacher_id),
                message=f"固定监考教师 {teacher_id} 在时间段 {assignment.time_slot_id} 不可用。",
                suggestion="请调整固定监考教师或考试时间。",
            )
        if (teacher_id, assignment.time_slot_id) in busy_teacher_slots:
            return ConflictRecord(
                type="fixed_teacher_assignment_conflict",
                severity=ConflictSeverity.ERROR,
                affected_ids=(assignment.exam_task_id, teacher_id),
                message=f"固定监考教师 {teacher_id} 在时间段 {assignment.time_slot_id} 已有监考安排。",
                suggestion="请调整固定监考教师或考试时间。",
            )
    return None


def _build_result(
    *,
    schedule_input: ScheduleInput,
    status: SolveStatus,
    started_at: float,
    attempted_assignments: int,
    assignments: tuple[ScheduledExam, ...] = (),
    conflicts: tuple[ConflictRecord, ...] = (),
) -> ScheduleResult:
    hard_violation_count = len(conflicts)
    if hard_violation_count > 0:
        score = ScoreBreakdown(
            total_score=0,
            hard_violation_count=hard_violation_count,
            soft_penalty_items=(),
        )
    elif assignments:
        score = calculate_score(schedule_input, assignments)
    else:
        score = ScoreBreakdown(
            total_score=100,
            hard_violation_count=0,
            soft_penalty_items=(),
        )
    return ScheduleResult(
        assignments=assignments,
        conflicts=conflicts,
        score=score,
        statistics=SolverStatistics(
            status=status,
            elapsed_ms=max(0, int((perf_counter() - started_at) * 1000)),
            exam_count=len(schedule_input.exam_tasks),
            room_count=len(schedule_input.rooms),
            slot_count=len(schedule_input.time_slots),
            attempted_assignments=attempted_assignments,
        ),
    )
