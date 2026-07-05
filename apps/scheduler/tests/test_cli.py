import json
import subprocess
import sys

from examforge_scheduler.generator import generate_small_dataset


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
