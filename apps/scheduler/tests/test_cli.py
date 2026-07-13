import json
import subprocess
import sys

from examforge_scheduler.generator import generate_small_dataset
from examforge_scheduler.models import RescheduleContext, ScheduledExam
from examforge_scheduler.transport import parse_schedule_input


def test_cli_solves_schedule_input_from_json():
    payload = _to_jsonable(generate_small_dataset(seed=20260705))

    completed = subprocess.run(
        [sys.executable, "-m", "examforge_scheduler.cli", "solve"],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=True,
    )

    result = json.loads(completed.stdout)

    assert result["statistics"]["status"] in {"feasible", "partial", "infeasible"}
    assert result["statistics"]["exam_count"] == len(payload["exam_tasks"])
    assert "assignments" in result
    assert "conflicts" in result
    assert "score" in result
    assert "report" in result


def test_cli_returns_json_error_for_invalid_solve_payload():
    completed = subprocess.run(
        [sys.executable, "-m", "examforge_scheduler.cli", "solve"],
        input="{not-json",
        text=True,
        capture_output=True,
        check=False,
    )

    assert completed.returncode == 1
    payload = json.loads(completed.stdout)
    assert payload["error"]["category"] == "validation"
    assert payload["error"]["code"] == "scheduler_payload_invalid"
    assert payload["error"]["retryable"] is False
    assert payload["error"]["message"]


def test_cli_rejects_unknown_commands_on_stderr():
    completed = subprocess.run(
        [sys.executable, "-m", "examforge_scheduler.cli", "unknown"],
        text=True,
        capture_output=True,
        check=False,
    )

    assert completed.returncode == 2
    assert "invalid choice" in completed.stderr


def test_schedule_input_from_json_parses_reschedule_context():
    payload = _to_jsonable(generate_small_dataset(seed=20260705))
    baseline_assignments = [
        {
            "exam_task_id": task["id"],
            "room_id": payload["rooms"][0]["id"],
            "time_slot_id": payload["time_slots"][0]["id"],
            "teacher_ids": [payload["teachers"][0]["id"]],
        }
        for task in payload["exam_tasks"]
    ]
    payload["reschedule_context"] = {
        "baseline_assignments": baseline_assignments,
        "movable_exam_task_ids": ["e001"],
    }

    schedule_input = parse_schedule_input(payload)

    assert schedule_input.reschedule_context is not None
    assert schedule_input.reschedule_context.movable_exam_task_ids == ("e001",)
    assert schedule_input.reschedule_context.baseline_assignments[0] == ScheduledExam(
        "e001",
        payload["rooms"][0]["id"],
        payload["time_slots"][0]["id"],
        (payload["teachers"][0]["id"],),
    )
    assert len(schedule_input.reschedule_context.baseline_assignments) == len(
        payload["exam_tasks"]
    )


def _to_jsonable(value):
    if hasattr(value, "value"):
        return value.value
    if hasattr(value, "__dataclass_fields__"):
        return {
            field: _to_jsonable(getattr(value, field))
            for field in value.__dataclass_fields__
        }
    if isinstance(value, tuple):
        return [_to_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: _to_jsonable(item) for key, item in value.items()}
    return value
