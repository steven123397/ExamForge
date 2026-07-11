from math import ceil

from ortools.sat.python import cp_model

from .models import (
    ConflictRecord,
    ConflictSeverity,
    ScheduleInput,
    ScheduledExam,
    Teacher,
)


def assign_teachers(
    schedule_input: ScheduleInput,
    assignments: tuple[ScheduledExam, ...],
) -> tuple[tuple[ScheduledExam, ...], tuple[ConflictRecord, ...]]:
    if not assignments:
        return (), ()

    tasks_by_id = {task.id: task for task in schedule_input.exam_tasks}
    teachers = tuple(sorted(schedule_input.teachers, key=lambda item: item.id))
    fixed_by_exam = {
        assignment.exam_task_id: assignment
        for assignment in schedule_input.fixed_assignments
        if assignment.teacher_ids
    }
    reschedule_context = schedule_input.reschedule_context
    baseline_by_exam = (
        {
            assignment.exam_task_id: assignment
            for assignment in reschedule_context.baseline_assignments
        }
        if reschedule_context is not None
        else {}
    )
    movable_exam_ids = (
        set(reschedule_context.movable_exam_task_ids)
        if reschedule_context is not None
        else set()
    )

    model = cp_model.CpModel()
    variables: dict[tuple[str, str], cp_model.IntVar] = {}
    for assignment in assignments:
        for teacher in teachers:
            variable = model.NewBoolVar(
                f"teacher_{assignment.exam_task_id}_{teacher.id}"
            )
            variables[(assignment.exam_task_id, teacher.id)] = variable
            if assignment.time_slot_id in teacher.unavailable_slot_ids:
                model.Add(variable == 0)

    for assignment in assignments:
        task = tasks_by_id[assignment.exam_task_id]
        model.Add(
            sum(
                variables[(assignment.exam_task_id, teacher.id)]
                for teacher in teachers
            )
            == task.invigilator_count
        )

        fixed_assignment = fixed_by_exam.get(assignment.exam_task_id)
        if fixed_assignment is not None:
            fixed_teacher_ids = set(fixed_assignment.teacher_ids)
            for teacher in teachers:
                model.Add(
                    variables[(assignment.exam_task_id, teacher.id)]
                    == (1 if teacher.id in fixed_teacher_ids else 0)
                )

        baseline = baseline_by_exam.get(assignment.exam_task_id)
        if baseline is not None and assignment.exam_task_id not in movable_exam_ids:
            baseline_teacher_ids = set(baseline.teacher_ids)
            for teacher in teachers:
                model.Add(
                    variables[(assignment.exam_task_id, teacher.id)]
                    == (1 if teacher.id in baseline_teacher_ids else 0)
                )

    slot_ids = {assignment.time_slot_id for assignment in assignments}
    for teacher in teachers:
        for slot_id in slot_ids:
            same_slot_variables = [
                variables[(assignment.exam_task_id, teacher.id)]
                for assignment in assignments
                if assignment.time_slot_id == slot_id
            ]
            if same_slot_variables:
                model.Add(sum(same_slot_variables) <= 1)

    tie_break_terms = _tie_break_terms(assignments, teachers, variables)
    business_scale = sum(
        coefficient for _, coefficient in tie_break_terms
    ) + 1
    business_terms = [
        *_workload_balance_terms(
            schedule_input,
            assignments,
            teachers,
            variables,
            model,
            business_scale,
        ),
        *_consecutive_invigilation_terms(
            schedule_input,
            assignments,
            teachers,
            variables,
            model,
            business_scale,
        ),
        *_reschedule_stability_terms(
            schedule_input,
            assignments,
            teachers,
            variables,
            business_scale,
        ),
    ]
    objective_terms = [
        *business_terms,
        *(variable * coefficient for variable, coefficient in tie_break_terms),
    ]
    if objective_terms:
        model.Minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = max(
        1, schedule_input.constraint_profile.time_limit_seconds
    )
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        affected_ids = tuple(
            sorted(assignment.exam_task_id for assignment in assignments)
        )
        return (), (
            ConflictRecord(
                type="teacher_assignment_failed",
                severity=ConflictSeverity.ERROR,
                affected_ids=affected_ids,
                message="教师优化模型无法为全部考试分配满足硬约束的监考教师。",
                suggestion="请增加可用教师、调整教师不可用时间或减少同时间段考试数量。",
            ),
        )

    assignments_with_teachers = tuple(
        ScheduledExam(
            exam_task_id=assignment.exam_task_id,
            room_id=assignment.room_id,
            time_slot_id=assignment.time_slot_id,
            teacher_ids=tuple(
                teacher.id
                for teacher in teachers
                if solver.BooleanValue(
                    variables[(assignment.exam_task_id, teacher.id)]
                )
            ),
        )
        for assignment in assignments
    )
    return assignments_with_teachers, ()


def _workload_balance_terms(
    schedule_input: ScheduleInput,
    assignments: tuple[ScheduledExam, ...],
    teachers: tuple[Teacher, ...],
    variables: dict[tuple[str, str], cp_model.IntVar],
    model: cp_model.CpModel,
    business_scale: int,
) -> list:
    weight = schedule_input.constraint_profile.soft_weights.get(
        "teacher_workload_balance", 1
    )
    if weight <= 0 or not teachers:
        return []

    assigned_exam_ids = {
        assignment.exam_task_id for assignment in assignments
    }
    total_positions = sum(
        task.invigilator_count
        for task in schedule_input.exam_tasks
        if task.id in assigned_exam_ids
    )
    allowed_load = ceil(total_positions / len(teachers))
    max_load = model.NewIntVar(0, total_positions, "teacher_max_workload")
    min_load = model.NewIntVar(0, total_positions, "teacher_min_workload")
    excess_terms = []
    for teacher in teachers:
        workload = model.NewIntVar(
            0, total_positions, f"teacher_workload_{teacher.id}"
        )
        model.Add(
            workload
            == sum(
                variables[(assignment.exam_task_id, teacher.id)]
                for assignment in assignments
            )
        )
        model.Add(max_load >= workload)
        model.Add(min_load <= workload)
        excess = model.NewIntVar(
            0, total_positions, f"teacher_excess_workload_{teacher.id}"
        )
        model.Add(excess >= workload - allowed_load)
        excess_terms.append(excess)

    coefficient = weight * business_scale
    load_spread = model.NewIntVar(0, total_positions, "teacher_workload_spread")
    model.Add(load_spread == max_load - min_load)
    return [
        max_load * coefficient,
        load_spread * coefficient,
        *(term * coefficient for term in excess_terms),
    ]


def _consecutive_invigilation_terms(
    schedule_input: ScheduleInput,
    assignments: tuple[ScheduledExam, ...],
    teachers: tuple[Teacher, ...],
    variables: dict[tuple[str, str], cp_model.IntVar],
    model: cp_model.CpModel,
    business_scale: int,
) -> list:
    weight = schedule_input.constraint_profile.soft_weights.get(
        "teacher_consecutive_invigilation", 0
    )
    if weight <= 0:
        return []

    slots_by_id = {slot.id: slot for slot in schedule_input.time_slots}
    assignments_by_slot: dict[str, list[ScheduledExam]] = {}
    for assignment in assignments:
        assignments_by_slot.setdefault(assignment.time_slot_id, []).append(assignment)
    used_slot_ids = sorted(
        assignments_by_slot,
        key=lambda slot_id: slots_by_id[slot_id].period_index,
    )
    consecutive_terms = []
    for left_index, left_slot_id in enumerate(used_slot_ids):
        left_slot = slots_by_id[left_slot_id]
        for right_slot_id in used_slot_ids[left_index + 1 :]:
            right_slot = slots_by_id[right_slot_id]
            if right_slot.period_index - left_slot.period_index != 1:
                continue
            for teacher in teachers:
                pair = model.NewBoolVar(
                    f"teacher_consecutive_{left_slot_id}_{right_slot_id}_{teacher.id}"
                )
                left_assigned = sum(
                    variables[(assignment.exam_task_id, teacher.id)]
                    for assignment in assignments_by_slot[left_slot_id]
                )
                right_assigned = sum(
                    variables[(assignment.exam_task_id, teacher.id)]
                    for assignment in assignments_by_slot[right_slot_id]
                )
                model.Add(pair <= left_assigned)
                model.Add(pair <= right_assigned)
                model.Add(pair >= left_assigned + right_assigned - 1)
                consecutive_terms.append(pair * weight * business_scale)
    return consecutive_terms


def _tie_break_terms(
    assignments: tuple[ScheduledExam, ...],
    teachers: tuple[Teacher, ...],
    variables: dict[tuple[str, str], cp_model.IntVar],
) -> list[tuple[cp_model.IntVar, int]]:
    return [
        (
            variables[(assignment.exam_task_id, teacher.id)],
            teacher_index + 1,
        )
        for assignment in assignments
        for teacher_index, teacher in enumerate(teachers)
    ]


def _reschedule_stability_terms(
    schedule_input: ScheduleInput,
    assignments: tuple[ScheduledExam, ...],
    teachers: tuple[Teacher, ...],
    variables: dict[tuple[str, str], cp_model.IntVar],
    business_scale: int,
) -> list:
    context = schedule_input.reschedule_context
    weight = schedule_input.constraint_profile.soft_weights.get(
        "schedule_stability", 0
    )
    if context is None or weight <= 0:
        return []

    baseline_by_exam = {
        assignment.exam_task_id: assignment
        for assignment in context.baseline_assignments
    }
    movable_exam_ids = set(context.movable_exam_task_ids)
    terms = []
    coefficient = weight * business_scale
    for assignment in assignments:
        if assignment.exam_task_id not in movable_exam_ids:
            continue
        baseline = baseline_by_exam[assignment.exam_task_id]
        baseline_teacher_ids = set(baseline.teacher_ids)
        for teacher in teachers:
            variable = variables[(assignment.exam_task_id, teacher.id)]
            if teacher.id in baseline_teacher_ids:
                terms.append((1 - variable) * coefficient)
            else:
                terms.append(variable * coefficient)
    return terms
