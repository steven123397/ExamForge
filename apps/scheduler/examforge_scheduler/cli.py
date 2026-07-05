import argparse
import json
import sys
from dataclasses import asdict, is_dataclass
from enum import Enum
from typing import Any

from .conflicts import detect_assignment_conflicts
from .models import (
    ConstraintProfile,
    Course,
    ExamTask,
    ExamType,
    Room,
    RoomType,
    ScheduleInput,
    Teacher,
    TimeSlot,
    StudentGroup,
)
from .precheck import run_precheck
from .report import build_schedule_report
from .scoring import calculate_score
from .solver import solve_schedule


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ExamForge scheduler JSON CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("solve", help="Read ScheduleInput JSON from stdin and solve")
    args = parser.parse_args(argv)

    if args.command == "solve":
        return _solve_from_stdin()

    parser.error(f"unsupported command {args.command}")
    return 2


def _solve_from_stdin() -> int:
    try:
        raw_input = json.load(sys.stdin)
        schedule_input = _schedule_input_from_json(raw_input)
        result = _solve_with_report(schedule_input)
    except Exception as exc:
        error_payload = {
            "error": {
                "type": exc.__class__.__name__,
                "message": str(exc),
            }
        }
        print(json.dumps(error_payload, ensure_ascii=False))
        return 1

    print(json.dumps(_to_jsonable(result), ensure_ascii=False))
    return 0


def _solve_with_report(schedule_input: ScheduleInput) -> dict[str, Any]:
    precheck_conflicts = run_precheck(schedule_input)
    result = solve_schedule(schedule_input)
    assignment_conflicts = detect_assignment_conflicts(schedule_input, result.assignments)
    all_conflicts = (*precheck_conflicts, *result.conflicts, *assignment_conflicts)
    score = calculate_score(schedule_input, result.assignments)
    result_with_score = result.__class__(
        assignments=result.assignments,
        conflicts=all_conflicts,
        score=score.__class__(
            total_score=0 if all_conflicts else score.total_score,
            hard_violation_count=len(all_conflicts),
            soft_penalty_items=score.soft_penalty_items,
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


def _schedule_input_from_json(payload: dict[str, Any]) -> ScheduleInput:
    return ScheduleInput(
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
                unavailable_slot_ids=tuple(item.get("unavailable_slot_ids", ())),
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
                required_equipment_tags=tuple(item.get("required_equipment_tags", ())),
                allowed_slot_ids=tuple(item.get("allowed_slot_ids", ())),
                invigilator_count=item["invigilator_count"],
            )
            for item in payload["exam_tasks"]
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=tuple(payload["constraint_profile"]["hard_rules"]),
            soft_weights=dict(payload["constraint_profile"]["soft_weights"]),
            time_limit_seconds=payload["constraint_profile"]["time_limit_seconds"],
        ),
    )


def _to_jsonable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value):
        return {
            key: _to_jsonable(item)
            for key, item in asdict(value).items()
        }
    if isinstance(value, tuple):
        return [_to_jsonable(item) for item in value]
    if isinstance(value, list):
        return [_to_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: _to_jsonable(item) for key, item in value.items()}
    return value


if __name__ == "__main__":
    raise SystemExit(main())
