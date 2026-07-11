from collections import Counter, defaultdict

from .models import ExamTask, Room, ScheduledExam, ScheduleInput, ScheduleResult


def build_schedule_report(
    schedule_input: ScheduleInput,
    result: ScheduleResult,
) -> dict[str, object]:
    task_by_id = {task.id: task for task in schedule_input.exam_tasks}
    room_by_id = {room.id: room for room in schedule_input.rooms}

    report = {
        "summary": _build_summary(schedule_input, result),
        "statistics": _build_statistics(result),
        "score": _build_score(result),
        "conflicts": _build_conflicts(result),
        "room_utilization": _build_room_utilization(result, task_by_id, room_by_id),
        "teacher_workload": _build_teacher_workload(schedule_input, result),
    }
    if schedule_input.reschedule_context is not None:
        report["reschedule"] = _build_reschedule_summary(schedule_input, result)
    return report


def _build_summary(
    schedule_input: ScheduleInput,
    result: ScheduleResult,
) -> dict[str, object]:
    return {
        "exam_count": len(schedule_input.exam_tasks),
        "scheduled_exam_count": len(result.assignments),
        "conflict_count": len(result.conflicts),
        "status": result.statistics.status.value,
    }


def _build_statistics(result: ScheduleResult) -> dict[str, object]:
    statistics = result.statistics
    return {
        "status": statistics.status.value,
        "elapsed_ms": statistics.elapsed_ms,
        "exam_count": statistics.exam_count,
        "room_count": statistics.room_count,
        "slot_count": statistics.slot_count,
        "attempted_assignments": statistics.attempted_assignments,
    }


def _build_score(result: ScheduleResult) -> dict[str, object]:
    return {
        "total_score": result.score.total_score,
        "hard_violation_count": result.score.hard_violation_count,
        "soft_penalty_items": [
            {
                "rule": item.rule,
                "penalty": item.penalty,
                "message": item.message,
            }
            for item in result.score.soft_penalty_items
        ],
    }


def _build_conflicts(result: ScheduleResult) -> list[dict[str, object]]:
    return [
        {
            "type": conflict.type,
            "severity": conflict.severity.value,
            "affected_ids": list(conflict.affected_ids),
            "message": conflict.message,
            "suggestion": conflict.suggestion,
        }
        for conflict in result.conflicts
    ]


def _build_room_utilization(
    result: ScheduleResult,
    task_by_id: dict[str, ExamTask],
    room_by_id: dict[str, Room],
) -> dict[str, object]:
    room_utilizations: dict[str, list[float]] = defaultdict(list)
    assignment_utilizations: list[float] = []

    for assignment in result.assignments:
        task = task_by_id.get(assignment.exam_task_id)
        room = room_by_id.get(assignment.room_id)
        if task is None or room is None or room.capacity <= 0:
            continue
        utilization = task.expected_count / room.capacity
        room_utilizations[room.id].append(utilization)
        assignment_utilizations.append(utilization)

    return {
        "average_utilization": _round_ratio(_average(assignment_utilizations)),
        "rooms": [
            {
                "room_id": room_id,
                "exam_count": len(values),
                "average_utilization": _round_ratio(_average(values)),
            }
            for room_id, values in sorted(room_utilizations.items())
        ],
    }


def _build_teacher_workload(
    schedule_input: ScheduleInput,
    result: ScheduleResult,
) -> dict[str, object]:
    workload = Counter(
        teacher_id for assignment in result.assignments for teacher_id in assignment.teacher_ids
    )
    teacher_count = len(schedule_input.teachers)
    total_assignments = sum(workload.values())
    average_assignments = total_assignments / teacher_count if teacher_count else 0.0

    return {
        "average_assignments": _round_ratio(average_assignments),
        "teachers": [
            {
                "teacher_id": teacher.id,
                "assignment_count": workload.get(teacher.id, 0),
            }
            for teacher in schedule_input.teachers
        ],
    }


def _build_reschedule_summary(
    schedule_input: ScheduleInput,
    result: ScheduleResult,
) -> dict[str, object]:
    context = schedule_input.reschedule_context
    if context is None:
        return {}

    baseline_by_exam = {
        assignment.exam_task_id: assignment
        for assignment in context.baseline_assignments
    }
    result_by_exam = {
        assignment.exam_task_id: assignment
        for assignment in result.assignments
    }
    movable_exam_ids = set(context.movable_exam_task_ids)
    retained_exam_ids = sorted(
        exam_id
        for exam_id, baseline in baseline_by_exam.items()
        if _assignments_match(result_by_exam.get(exam_id), baseline)
    )
    changed_exam_ids = sorted(set(baseline_by_exam) - set(retained_exam_ids))

    return {
        "baseline_exam_count": len(baseline_by_exam),
        "frozen_exam_task_ids": sorted(
            set(baseline_by_exam) - movable_exam_ids
        ),
        "retained_exam_task_ids": retained_exam_ids,
        "changed_exam_task_ids": changed_exam_ids,
    }


def _assignments_match(
    assignment: ScheduledExam | None,
    baseline: ScheduledExam,
) -> bool:
    return (
        assignment is not None
        and assignment.room_id == baseline.room_id
        and assignment.time_slot_id == baseline.time_slot_id
        and set(assignment.teacher_ids) == set(baseline.teacher_ids)
    )


def _average(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _round_ratio(value: float) -> float:
    return round(value, 4)
