from collections import Counter, defaultdict
from math import ceil

from .models import (
    ExamTask,
    Room,
    ScheduledExam,
    ScheduleInput,
    ScoreBreakdown,
    SoftPenaltyItem,
    TimeSlot,
)


BASE_SCORE = 100
LOW_ROOM_UTILIZATION_THRESHOLD = 0.5


def calculate_score(
    schedule_input: ScheduleInput,
    assignments: tuple[ScheduledExam, ...],
) -> ScoreBreakdown:
    task_by_id = {task.id: task for task in schedule_input.exam_tasks}
    room_by_id = {room.id: room for room in schedule_input.rooms}
    slot_by_id = {slot.id: slot for slot in schedule_input.time_slots}
    weights = schedule_input.constraint_profile.soft_weights

    penalty_items = (
        _student_consecutive_exam_penalty(assignments, task_by_id, slot_by_id, weights),
        _teacher_workload_balance_penalty(schedule_input, assignments, weights),
        _teacher_consecutive_invigilation_penalty(assignments, slot_by_id, weights),
        _room_utilization_penalty(assignments, task_by_id, room_by_id, weights),
        _exam_distribution_balance_penalty(schedule_input, assignments, slot_by_id, weights),
    )
    active_penalty_items = tuple(item for item in penalty_items if item is not None)
    total_penalty = sum(item.penalty for item in active_penalty_items)

    return ScoreBreakdown(
        total_score=max(0, BASE_SCORE - total_penalty),
        hard_violation_count=0,
        soft_penalty_items=active_penalty_items,
    )


def _student_consecutive_exam_penalty(
    assignments: tuple[ScheduledExam, ...],
    task_by_id: dict[str, ExamTask],
    slot_by_id: dict[str, TimeSlot],
    weights: dict[str, int],
) -> SoftPenaltyItem | None:
    weight = weights.get("student_consecutive_exam", 0)
    if weight <= 0:
        return None

    group_slots: dict[str, list[TimeSlot]] = defaultdict(list)
    for assignment in assignments:
        task = task_by_id.get(assignment.exam_task_id)
        slot = slot_by_id.get(assignment.time_slot_id)
        if task is None or slot is None:
            continue
        for group_id in task.student_group_ids:
            group_slots[group_id].append(slot)

    consecutive_pairs: list[str] = []
    for group_id, slots in group_slots.items():
        ordered_slots = sorted(slots, key=lambda slot: slot.period_index)
        for previous, current in zip(ordered_slots, ordered_slots[1:]):
            if current.period_index - previous.period_index == 1:
                consecutive_pairs.append(group_id)

    if not consecutive_pairs:
        return None

    count = len(consecutive_pairs)
    affected_groups = ", ".join(sorted(set(consecutive_pairs)))
    return SoftPenaltyItem(
        rule="student_consecutive_exam",
        penalty=count * weight,
        message=f"学生群体 {affected_groups} 存在 {count} 次连续考试",
    )


def _teacher_workload_balance_penalty(
    schedule_input: ScheduleInput,
    assignments: tuple[ScheduledExam, ...],
    weights: dict[str, int],
) -> SoftPenaltyItem | None:
    weight = weights.get("teacher_workload_balance", 0)
    if weight <= 0 or not schedule_input.teachers:
        return None

    workload = Counter(
        teacher_id for assignment in assignments for teacher_id in assignment.teacher_ids
    )
    total_assignments = sum(workload.values())
    if total_assignments == 0:
        return None

    average = total_assignments / len(schedule_input.teachers)
    allowed_load = ceil(average)
    overloaded = {
        teacher.id: workload.get(teacher.id, 0) - allowed_load
        for teacher in schedule_input.teachers
        if workload.get(teacher.id, 0) > allowed_load
    }
    if not overloaded:
        return None

    excess_count = sum(overloaded.values())
    teacher_ids = ", ".join(sorted(overloaded))
    return SoftPenaltyItem(
        rule="teacher_workload_balance",
        penalty=excess_count * weight,
        message=f"教师 {teacher_ids} 监考工作量高于平均水平 {average:.2f}",
    )


def _teacher_consecutive_invigilation_penalty(
    assignments: tuple[ScheduledExam, ...],
    slot_by_id: dict[str, TimeSlot],
    weights: dict[str, int],
) -> SoftPenaltyItem | None:
    weight = weights.get("teacher_consecutive_invigilation", 0)
    if weight <= 0:
        return None

    teacher_slots: dict[str, list[TimeSlot]] = defaultdict(list)
    for assignment in assignments:
        slot = slot_by_id.get(assignment.time_slot_id)
        if slot is None:
            continue
        for teacher_id in assignment.teacher_ids:
            teacher_slots[teacher_id].append(slot)

    consecutive_teachers: list[str] = []
    for teacher_id, slots in teacher_slots.items():
        ordered_slots = sorted(slots, key=lambda slot: slot.period_index)
        for previous, current in zip(ordered_slots, ordered_slots[1:]):
            if current.period_index - previous.period_index == 1:
                consecutive_teachers.append(teacher_id)

    if not consecutive_teachers:
        return None

    count = len(consecutive_teachers)
    teacher_ids = ", ".join(sorted(set(consecutive_teachers)))
    return SoftPenaltyItem(
        rule="teacher_consecutive_invigilation",
        penalty=count * weight,
        message=f"教师 {teacher_ids} 存在 {count} 次连续监考",
    )


def _room_utilization_penalty(
    assignments: tuple[ScheduledExam, ...],
    task_by_id: dict[str, ExamTask],
    room_by_id: dict[str, Room],
    weights: dict[str, int],
) -> SoftPenaltyItem | None:
    weight = weights.get("room_utilization", 0)
    if weight <= 0:
        return None

    low_utilization: list[str] = []
    for assignment in assignments:
        task = task_by_id.get(assignment.exam_task_id)
        room = room_by_id.get(assignment.room_id)
        if task is None or room is None or room.capacity <= 0:
            continue
        utilization = task.expected_count / room.capacity
        if utilization < LOW_ROOM_UTILIZATION_THRESHOLD:
            low_utilization.append(f"{assignment.exam_task_id}:{utilization:.0%}")

    if not low_utilization:
        return None

    return SoftPenaltyItem(
        rule="room_utilization",
        penalty=len(low_utilization) * weight,
        message=f"考场容量利用率偏低：{', '.join(low_utilization)}",
    )


def _exam_distribution_balance_penalty(
    schedule_input: ScheduleInput,
    assignments: tuple[ScheduledExam, ...],
    slot_by_id: dict[str, TimeSlot],
    weights: dict[str, int],
) -> SoftPenaltyItem | None:
    weight = weights.get("exam_distribution_balance", 0)
    all_dates = sorted({slot.date for slot in schedule_input.time_slots})
    if weight <= 0 or not all_dates or not assignments:
        return None

    date_counts = Counter(
        slot_by_id[assignment.time_slot_id].date
        for assignment in assignments
        if assignment.time_slot_id in slot_by_id
    )
    if not date_counts:
        return None

    ideal_daily_count = len(assignments) / len(all_dates)
    concentrated_dates = {
        date: ceil(count - ideal_daily_count)
        for date, count in date_counts.items()
        if count > ideal_daily_count
    }
    if not concentrated_dates:
        return None

    excess_count = sum(concentrated_dates.values())
    dates = ", ".join(sorted(concentrated_dates))
    return SoftPenaltyItem(
        rule="exam_distribution_balance",
        penalty=excess_count * weight,
        message=f"考试集中在 {dates}，高于平均每日 {ideal_daily_count:.2f} 场",
    )
