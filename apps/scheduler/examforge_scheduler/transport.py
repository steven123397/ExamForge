from collections.abc import Mapping
from dataclasses import asdict, is_dataclass
from enum import Enum
from typing import Any

from .conflicts import detect_assignment_conflicts
from .models import (
    ConstraintProfile,
    Course,
    ExamTask,
    ExamType,
    FixedAssignment,
    RescheduleContext,
    Room,
    RoomType,
    ScheduleInput,
    ScheduledExam,
    StudentGroup,
    Teacher,
    TimeSlot,
    validate_schedule_input,
)
from .precheck import run_precheck
from .report import build_schedule_report
from .solver import solve_schedule


class SchedulerValidationError(ValueError):
    code = "scheduler_input_invalid"
    category = "validation"
    retryable = False

    def __init__(self, issues: tuple[str, ...]):
        super().__init__("Schedule input failed semantic validation.")
        self.issues = issues


def parse_schedule_input(payload: Mapping[str, Any]) -> ScheduleInput:
    try:
        reschedule_payload = payload.get("reschedule_context")
        reschedule_context = (
            None
            if reschedule_payload is None
            else RescheduleContext(
                baseline_assignments=tuple(
                    ScheduledExam(
                        exam_task_id=item["exam_task_id"],
                        room_id=item["room_id"],
                        time_slot_id=item["time_slot_id"],
                        teacher_ids=tuple(item.get("teacher_ids", ())),
                    )
                    for item in reschedule_payload["baseline_assignments"]
                ),
                movable_exam_task_ids=tuple(
                    reschedule_payload.get("movable_exam_task_ids", ())
                ),
            )
        )

        schedule_input = ScheduleInput(
            student_groups=tuple(
                StudentGroup(
                    id=item["id"],
                    name=item["name"],
                    size=item["size"],
                    department_id=item["department_id"],
                )
                for item in payload["student_groups"]
            ),
            teachers=tuple(
                Teacher(
                    id=item["id"],
                    name=item["name"],
                    department_id=item["department_id"],
                    unavailable_slot_ids=tuple(
                        item.get("unavailable_slot_ids", ())
                    ),
                )
                for item in payload["teachers"]
            ),
            courses=tuple(
                Course(
                    id=item["id"],
                    name=item["name"],
                    department_id=item["department_id"],
                    exam_type=ExamType(item["exam_type"]),
                )
                for item in payload["courses"]
            ),
            rooms=tuple(
                Room(
                    id=item["id"],
                    name=item["name"],
                    building_id=item["building_id"],
                    capacity=item["capacity"],
                    room_type=RoomType(item["room_type"]),
                    equipment_tags=tuple(item.get("equipment_tags", ())),
                )
                for item in payload["rooms"]
            ),
            time_slots=tuple(
                TimeSlot(
                    id=item["id"],
                    date=item["date"],
                    start_time=item["start_time"],
                    end_time=item["end_time"],
                    period_index=item["period_index"],
                )
                for item in payload["time_slots"]
            ),
            exam_tasks=tuple(
                ExamTask(
                    id=item["id"],
                    course_id=item["course_id"],
                    student_group_ids=tuple(item["student_group_ids"]),
                    expected_count=item["expected_count"],
                    duration_minutes=item["duration_minutes"],
                    required_room_type=RoomType(item["required_room_type"]),
                    required_equipment_tags=tuple(
                        item.get("required_equipment_tags", ())
                    ),
                    allowed_slot_ids=tuple(item.get("allowed_slot_ids", ())),
                    invigilator_count=item["invigilator_count"],
                )
                for item in payload["exam_tasks"]
            ),
            constraint_profile=ConstraintProfile(
                hard_rules=tuple(payload["constraint_profile"]["hard_rules"]),
                soft_weights=dict(
                    payload["constraint_profile"]["soft_weights"]
                ),
                time_limit_seconds=payload["constraint_profile"][
                    "time_limit_seconds"
                ],
            ),
            fixed_assignments=tuple(
                FixedAssignment(
                    exam_task_id=item["exam_task_id"],
                    room_id=item["room_id"],
                    time_slot_id=item["time_slot_id"],
                    teacher_ids=tuple(item.get("teacher_ids", ())),
                )
                for item in payload.get("fixed_assignments", ())
            ),
            reschedule_context=reschedule_context,
        )
    except (AttributeError, KeyError, TypeError, ValueError) as exc:
        raise SchedulerValidationError(
            ("Schedule input structure contains an invalid or missing field.",)
        ) from exc

    issues = validate_schedule_input(schedule_input)
    if issues:
        raise SchedulerValidationError(issues)
    return schedule_input


def solve_payload(payload: Mapping[str, Any]) -> dict[str, Any]:
    return to_jsonable(solve_with_report(parse_schedule_input(payload)))


def solve_with_report(schedule_input: ScheduleInput) -> dict[str, Any]:
    precheck_conflicts = run_precheck(schedule_input)
    result = solve_schedule(schedule_input)
    assignment_conflicts = detect_assignment_conflicts(
        schedule_input,
        result.assignments,
    )
    all_conflicts = (*precheck_conflicts, *result.conflicts, *assignment_conflicts)
    result_with_score = result.__class__(
        assignments=result.assignments,
        conflicts=all_conflicts,
        score=result.score.__class__(
            total_score=0 if all_conflicts else result.score.total_score,
            hard_violation_count=len(all_conflicts),
            soft_penalty_items=result.score.soft_penalty_items,
        ),
        statistics=result.statistics,
    )
    report = build_schedule_report(schedule_input, result_with_score)
    return {
        "assignments": result_with_score.assignments,
        "conflicts": result_with_score.conflicts,
        "score": result_with_score.score,
        "statistics": result_with_score.statistics,
        "report": report,
    }


def to_jsonable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return {
            key: to_jsonable(item)
            for key, item in asdict(value).items()
        }
    if isinstance(value, tuple):
        return [to_jsonable(item) for item in value]
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: to_jsonable(item) for key, item in value.items()}
    return value
