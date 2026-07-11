import json
import subprocess
import sys

from examforge_scheduler.generator import generate_small_dataset
from examforge_scheduler.cli import _schedule_input_from_json
from examforge_scheduler.models import RescheduleContext, ScheduledExam


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
    assert payload["error"]["type"] == "JSONDecodeError"
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
    payload["reschedule_context"] = {
        "baseline_assignments": [
            {
                "exam_task_id": "e001",
                "room_id": "r001",
                "time_slot_id": "s001",
                "teacher_ids": ["t001"],
            },
        ],
        "movable_exam_task_ids": ["e001"],
    }

    schedule_input = _schedule_input_from_json(payload)

    assert schedule_input.reschedule_context == RescheduleContext(
        baseline_assignments=(
            ScheduledExam("e001", "r001", "s001", ("t001",)),
        ),
        movable_exam_task_ids=("e001",),
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
