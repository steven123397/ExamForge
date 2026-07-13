import json
import subprocess
import sys
from dataclasses import replace

from fastapi.testclient import TestClient

from examforge_scheduler.generator import generate_small_dataset
from examforge_scheduler.http_api import create_app
from examforge_scheduler.transport import solve_payload, to_jsonable


def test_cli_http_and_application_pipeline_return_equivalent_results():
    base_input = generate_small_dataset(seed=20260705)
    baseline = solve_payload(to_jsonable(base_input))["assignments"]
    cases = {
        "feasible": to_jsonable(base_input),
        "infeasible": to_jsonable(
            replace(
                base_input,
                rooms=tuple(replace(room, capacity=1) for room in base_input.rooms),
            )
        ),
        "fixed": {
            **to_jsonable(base_input),
            "fixed_assignments": [baseline[0]],
        },
        "reschedule": {
            **to_jsonable(base_input),
            "reschedule_context": {
                "baseline_assignments": baseline,
                "movable_exam_task_ids": [baseline[0]["exam_task_id"]],
            },
        },
    }
    client = TestClient(create_app())

    for name, payload in cases.items():
        application_result = solve_payload(payload)
        http_response = client.post("/solve", json=payload)
        cli = subprocess.run(
            [sys.executable, "-m", "examforge_scheduler.cli", "solve"],
            input=json.dumps(payload),
            text=True,
            capture_output=True,
            check=True,
        )

        assert http_response.status_code == 200, name
        assert _canonicalize(http_response.json()) == _canonicalize(
            application_result
        ), name
        assert _canonicalize(json.loads(cli.stdout)) == _canonicalize(
            application_result
        ), name


def _canonicalize(result):
    result = json.loads(json.dumps(result))
    result["statistics"].pop("elapsed_ms", None)
    result.get("report", {}).get("statistics", {}).pop("elapsed_ms", None)
    return result
