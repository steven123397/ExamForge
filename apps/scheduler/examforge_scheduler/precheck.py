from collections import defaultdict

from .models import ConflictRecord, ConflictSeverity, ExamTask, Room, ScheduleInput


def run_precheck(schedule_input: ScheduleInput) -> tuple[ConflictRecord, ...]:
    conflicts: list[ConflictRecord] = []
    slot_ids = {slot.id for slot in schedule_input.time_slots}

    for task in schedule_input.exam_tasks:
        allowed_slot_ids, invalid_slot_ids = _allowed_slot_ids(task, slot_ids)
        if invalid_slot_ids or not allowed_slot_ids:
            affected_ids = (task.id, *invalid_slot_ids)
            conflicts.append(
                _conflict(
                    "no_allowed_slot",
                    affected_ids,
                    f"考试 {task.id} 没有可用考试时间段。",
                    "请为空时间窗口补充时间段，或修正考试任务的允许时间段配置。",
                )
            )

        requirement_rooms = _rooms_matching_requirement(schedule_input.rooms, task)
        if not requirement_rooms:
            conflicts.append(
                _conflict(
                    "no_available_room",
                    (task.id,),
                    f"考试 {task.id} 没有满足类型和设备要求的考场。",
                    "请调整考场类型、补充设备标签，或降低该考试的考场要求。",
                )
            )
        elif all(room.capacity < task.expected_count for room in requirement_rooms):
            conflicts.append(
                _conflict(
                    "capacity_impossible",
                    (task.id,),
                    f"考试 {task.id} 人数 {task.expected_count} 超过所有候选考场容量。",
                    "请拆分考试、调整考场容量，或分配更大的候选考场。",
                )
            )

        if allowed_slot_ids and _no_slot_has_enough_available_teachers(
            schedule_input,
            task,
            allowed_slot_ids,
        ):
            conflicts.append(
                _conflict(
                    "teacher_unavailable",
                    (task.id,),
                    f"考试 {task.id} 在候选时间段内没有足够可用监考教师。",
                    "请调整教师不可用时间、补充监考教师，或放宽该考试的时间窗口。",
                )
            )

    conflicts.extend(_student_group_overload_conflicts(schedule_input, slot_ids))
    return tuple(conflicts)


def _allowed_slot_ids(
    task: ExamTask,
    all_slot_ids: set[str],
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    if not task.allowed_slot_ids:
        return tuple(sorted(all_slot_ids)), ()

    invalid_slot_ids = tuple(
        slot_id for slot_id in task.allowed_slot_ids if slot_id not in all_slot_ids
    )
    allowed_slot_ids = tuple(
        slot_id for slot_id in task.allowed_slot_ids if slot_id in all_slot_ids
    )
    return allowed_slot_ids, invalid_slot_ids


def _rooms_matching_requirement(
    rooms: tuple[Room, ...],
    task: ExamTask,
) -> tuple[Room, ...]:
    required_equipment = set(task.required_equipment_tags)
    return tuple(
        room
        for room in rooms
        if room.room_type == task.required_room_type
        and required_equipment.issubset(room.equipment_tags)
    )


def _no_slot_has_enough_available_teachers(
    schedule_input: ScheduleInput,
    task: ExamTask,
    allowed_slot_ids: tuple[str, ...],
) -> bool:
    for slot_id in allowed_slot_ids:
        available_count = sum(
            slot_id not in teacher.unavailable_slot_ids
            for teacher in schedule_input.teachers
        )
        if available_count >= task.invigilator_count:
            return False
    return True


def _student_group_overload_conflicts(
    schedule_input: ScheduleInput,
    all_slot_ids: set[str],
) -> tuple[ConflictRecord, ...]:
    exam_count_by_group: dict[str, int] = defaultdict(int)
    slot_ids_by_group: dict[str, set[str]] = defaultdict(set)

    for task in schedule_input.exam_tasks:
        allowed_slot_ids, invalid_slot_ids = _allowed_slot_ids(task, all_slot_ids)
        if invalid_slot_ids or not allowed_slot_ids:
            continue
        for group_id in task.student_group_ids:
            exam_count_by_group[group_id] += 1
            slot_ids_by_group[group_id].update(allowed_slot_ids)

    conflicts: list[ConflictRecord] = []
    for group_id, exam_count in sorted(exam_count_by_group.items()):
        available_slot_count = len(slot_ids_by_group[group_id])
        if exam_count > available_slot_count:
            conflicts.append(
                _conflict(
                    "student_group_overloaded",
                    (group_id,),
                    f"学生群体 {group_id} 有 {exam_count} 场考试，但只有 {available_slot_count} 个可用时间段。",
                    "请增加考试时间段、拆分学生群体，或放宽相关考试的时间窗口。",
                )
            )

    return tuple(conflicts)


def _conflict(
    conflict_type: str,
    affected_ids: tuple[str, ...],
    message: str,
    suggestion: str,
) -> ConflictRecord:
    return ConflictRecord(
        type=conflict_type,
        severity=ConflictSeverity.ERROR,
        affected_ids=affected_ids,
        message=message,
        suggestion=suggestion,
    )
