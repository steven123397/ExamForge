from .models import (
    ConflictRecord,
    ExamTask,
    ScheduleDiagnostic,
    ScheduleInput,
)


_CONFLICT_CLASSIFICATION = {
    "no_available_room": ("room_capacity_shortage", "room"),
    "capacity_impossible": ("room_capacity_shortage", "room"),
    "room_capacity_mismatch": ("room_capacity_shortage", "room"),
    "room_requirement_mismatch": ("room_capacity_shortage", "room"),
    "no_candidate_assignment": ("room_capacity_shortage", "room"),
    "no_allowed_slot": ("time_slot_shortage", "time_slot"),
    "teacher_unavailable": ("teacher_shortage", "teacher"),
    "teacher_assignment_failed": ("teacher_shortage", "teacher"),
    "fixed_assignment_no_candidate": (
        "fixed_assignment_conflict",
        "fixed_assignment",
    ),
    "reschedule_frozen_assignment_invalid": (
        "fixed_assignment_conflict",
        "fixed_assignment",
    ),
    "student_group_overloaded": (
        "student_group_slot_conflict",
        "student_group",
    ),
    "student_group_clash": ("student_group_slot_conflict", "student_group"),
    "input_validation_error": ("invalid_reference", "input"),
    "solver_infeasible": ("solver_infeasible", "solver"),
    "solver_no_solution_within_time_limit": ("solver_infeasible", "solver"),
}


def build_diagnostics(
    schedule_input: ScheduleInput,
    conflicts: tuple[ConflictRecord, ...],
) -> tuple[ScheduleDiagnostic, ...]:
    diagnostics = tuple(
        _diagnostic_from_conflict(schedule_input, conflict)
        for conflict in conflicts
    )
    return tuple(sorted(
        diagnostics,
        key=lambda item: (
            item.code,
            item.resource_dimension,
            item.affected_ids,
            item.message,
        ),
    ))


def _diagnostic_from_conflict(
    schedule_input: ScheduleInput,
    conflict: ConflictRecord,
) -> ScheduleDiagnostic:
    code, resource_dimension = _CONFLICT_CLASSIFICATION.get(
        conflict.type,
        ("unclassified_conflict", "input"),
    )
    return ScheduleDiagnostic(
        code=code,
        severity=conflict.severity,
        resource_dimension=resource_dimension,
        affected_ids=tuple(sorted(conflict.affected_ids)),
        shortfall=_shortfall(schedule_input, conflict, code),
        message=conflict.message,
        suggestion=conflict.suggestion,
    )


def _shortfall(
    schedule_input: ScheduleInput,
    conflict: ConflictRecord,
    code: str,
) -> int:
    if code == "room_capacity_shortage":
        task = _affected_task(schedule_input, conflict)
        if task is None:
            return 1
        required_equipment = set(task.required_equipment_tags)
        capacities = [
            room.capacity
            for room in schedule_input.rooms
            if room.room_type == task.required_room_type
            and required_equipment.issubset(room.equipment_tags)
        ]
        return max(0, task.expected_count - max(capacities, default=0))
    if code == "teacher_shortage":
        task = _affected_task(schedule_input, conflict)
        if task is None:
            return 1
        slot_ids = task.allowed_slot_ids or tuple(
            slot.id for slot in schedule_input.time_slots
        )
        maximum_available = max((
            sum(
                slot_id not in teacher.unavailable_slot_ids
                for teacher in schedule_input.teachers
            )
            for slot_id in slot_ids
        ), default=0)
        return max(0, task.invigilator_count - maximum_available)
    if code == "student_group_slot_conflict":
        group_id = conflict.affected_ids[0] if conflict.affected_ids else None
        if group_id is None:
            return 1
        all_slots = {slot.id for slot in schedule_input.time_slots}
        task_count = 0
        available_slots: set[str] = set()
        for task in schedule_input.exam_tasks:
            if group_id not in task.student_group_ids:
                continue
            task_count += 1
            available_slots.update(task.allowed_slot_ids or all_slots)
        return max(0, task_count - len(available_slots))
    if code in {
        "time_slot_shortage",
        "fixed_assignment_conflict",
        "invalid_reference",
        "solver_infeasible",
        "unclassified_conflict",
    }:
        return 1
    return 0


def _affected_task(
    schedule_input: ScheduleInput,
    conflict: ConflictRecord,
) -> ExamTask | None:
    task_by_id = {task.id: task for task in schedule_input.exam_tasks}
    return next(
        (task_by_id[item_id] for item_id in conflict.affected_ids if item_id in task_by_id),
        None,
    )
