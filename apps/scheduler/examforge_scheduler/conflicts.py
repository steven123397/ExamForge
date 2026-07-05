from collections import defaultdict

from .models import (
    ConflictRecord,
    ConflictSeverity,
    ExamTask,
    Room,
    ScheduledExam,
    ScheduleInput,
)


def detect_assignment_conflicts(
    schedule_input: ScheduleInput,
    assignments: tuple[ScheduledExam, ...],
) -> tuple[ConflictRecord, ...]:
    task_by_id = {task.id: task for task in schedule_input.exam_tasks}
    room_by_id = {room.id: room for room in schedule_input.rooms}
    assigned_exam_ids = {assignment.exam_task_id for assignment in assignments}

    conflicts: list[ConflictRecord] = []
    conflicts.extend(_unscheduled_exam_conflicts(schedule_input, assigned_exam_ids))
    conflicts.extend(_room_time_conflicts(assignments))
    conflicts.extend(_student_group_clash_conflicts(assignments, task_by_id))
    conflicts.extend(_teacher_time_clash_conflicts(assignments))
    conflicts.extend(_assignment_requirement_conflicts(assignments, task_by_id, room_by_id))
    return tuple(conflicts)


def _unscheduled_exam_conflicts(
    schedule_input: ScheduleInput,
    assigned_exam_ids: set[str],
) -> tuple[ConflictRecord, ...]:
    conflicts: list[ConflictRecord] = []
    for task in schedule_input.exam_tasks:
        if task.id not in assigned_exam_ids:
            conflicts.append(
                _conflict(
                    "unscheduled_exam",
                    (task.id,),
                    f"考试 {task.id} 尚未排入任何考场和时间段。",
                    "请重新运行求解器，或人工为该考试补充考场、时间段和监考教师。",
                )
            )
    return tuple(conflicts)


def _room_time_conflicts(
    assignments: tuple[ScheduledExam, ...],
) -> tuple[ConflictRecord, ...]:
    by_room_slot: dict[tuple[str, str], list[ScheduledExam]] = defaultdict(list)
    for assignment in assignments:
        by_room_slot[(assignment.room_id, assignment.time_slot_id)].append(assignment)

    conflicts: list[ConflictRecord] = []
    for (room_id, slot_id), duplicated in sorted(by_room_slot.items()):
        if len(duplicated) > 1:
            exam_ids = tuple(assignment.exam_task_id for assignment in duplicated)
            conflicts.append(
                _conflict(
                    "room_time_conflict",
                    (room_id, slot_id, *exam_ids),
                    f"考场 {room_id} 在时间段 {slot_id} 被安排了多场考试。",
                    "请将其中部分考试调整到其他考场或时间段。",
                )
            )
    return tuple(conflicts)


def _student_group_clash_conflicts(
    assignments: tuple[ScheduledExam, ...],
    task_by_id: dict[str, ExamTask],
) -> tuple[ConflictRecord, ...]:
    by_group_slot: dict[tuple[str, str], list[str]] = defaultdict(list)
    for assignment in assignments:
        task = task_by_id.get(assignment.exam_task_id)
        if task is None:
            continue
        for group_id in task.student_group_ids:
            by_group_slot[(group_id, assignment.time_slot_id)].append(task.id)

    conflicts: list[ConflictRecord] = []
    for (group_id, slot_id), exam_ids in sorted(by_group_slot.items()):
        if len(exam_ids) > 1:
            conflicts.append(
                _conflict(
                    "student_group_clash",
                    (group_id, slot_id, *exam_ids),
                    f"学生群体 {group_id} 在时间段 {slot_id} 有多场考试。",
                    "请错开这些考试的时间段，避免同一学生群体同时参加多场考试。",
                )
            )
    return tuple(conflicts)


def _teacher_time_clash_conflicts(
    assignments: tuple[ScheduledExam, ...],
) -> tuple[ConflictRecord, ...]:
    by_teacher_slot: dict[tuple[str, str], list[str]] = defaultdict(list)
    for assignment in assignments:
        for teacher_id in assignment.teacher_ids:
            by_teacher_slot[(teacher_id, assignment.time_slot_id)].append(
                assignment.exam_task_id
            )

    conflicts: list[ConflictRecord] = []
    for (teacher_id, slot_id), exam_ids in sorted(by_teacher_slot.items()):
        if len(exam_ids) > 1:
            conflicts.append(
                _conflict(
                    "teacher_time_clash",
                    (teacher_id, slot_id, *exam_ids),
                    f"教师 {teacher_id} 在时间段 {slot_id} 被安排了多场监考。",
                    "请更换监考教师，或调整其中部分考试的时间段。",
                )
            )
    return tuple(conflicts)


def _assignment_requirement_conflicts(
    assignments: tuple[ScheduledExam, ...],
    task_by_id: dict[str, ExamTask],
    room_by_id: dict[str, Room],
) -> tuple[ConflictRecord, ...]:
    conflicts: list[ConflictRecord] = []
    for assignment in assignments:
        task = task_by_id.get(assignment.exam_task_id)
        room = room_by_id.get(assignment.room_id)
        if task is None or room is None:
            continue

        if room.capacity < task.expected_count:
            conflicts.append(
                _conflict(
                    "room_capacity_mismatch",
                    (task.id, room.id),
                    f"考试 {task.id} 人数 {task.expected_count} 超过考场 {room.id} 容量 {room.capacity}。",
                    "请改用容量更大的考场，或拆分该考试。",
                )
            )

        required_equipment = set(task.required_equipment_tags)
        if (
            room.room_type != task.required_room_type
            or not required_equipment.issubset(room.equipment_tags)
        ):
            conflicts.append(
                _conflict(
                    "room_requirement_mismatch",
                    (task.id, room.id),
                    f"考场 {room.id} 不满足考试 {task.id} 的类型或设备要求。",
                    "请更换符合要求的考场，或调整该考试的考场条件。",
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
