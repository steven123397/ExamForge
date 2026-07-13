import json

from examforge_scheduler.http_benchmark import benchmark_http_schedule, main


def test_http_benchmark_separates_solver_and_transport_elapsed_time():
    captured = {}

    def request(base_url, payload, timeout_seconds):
        captured["base_url"] = base_url
        captured["exam_count"] = len(payload["exam_tasks"])
        captured["timeout_seconds"] = timeout_seconds
        return {
            "assignments": [
                {
                    "exam_task_id": f"exam-{index}",
                    "room_id": "room-1",
                    "time_slot_id": "slot-1",
                    "teacher_ids": ["teacher-1"],
                }
                for index in range(6)
            ],
            "conflicts": [],
            "score": {
                "total_score": 100,
                "hard_violation_count": 0,
                "soft_penalty_items": [],
            },
            "statistics": {
                "status": "feasible",
                "elapsed_ms": 7,
                "attempted_assignments": 6,
            },
            "report": {},
        }

    metrics = benchmark_http_schedule(
        exam_count=6,
        seed=20260711,
        time_limit=5,
        base_url="http://scheduler.test:8000/",
        request=request,
    )

    assert captured == {
        "base_url": "http://scheduler.test:8000",
        "exam_count": 6,
        "timeout_seconds": 10,
    }
    assert metrics["exam_count"] == 6
    assert metrics["status"] == "feasible"
    assert metrics["solver_elapsed_ms"] == 7
    assert metrics["http_elapsed_ms"] >= 0
    assert metrics["http_overhead_ms"] == max(
        0,
        metrics["http_elapsed_ms"] - metrics["solver_elapsed_ms"],
    )
    assert metrics["assignment_count"] == 6
    assert metrics["conflict_count"] == 0


def test_http_benchmark_main_prints_one_json_object_per_size(monkeypatch, capsys):
    def fake_benchmark_http_schedule(**kwargs):
        return {
            "exam_count": kwargs["exam_count"],
            "status": "feasible",
            "solver_elapsed_ms": 5,
            "http_elapsed_ms": 8,
            "http_overhead_ms": 3,
            "assignment_count": kwargs["exam_count"],
            "conflict_count": 0,
        }

    monkeypatch.setattr(
        "examforge_scheduler.http_benchmark.benchmark_http_schedule",
        fake_benchmark_http_schedule,
    )

    exit_code = main(
        [
            "--base-url",
            "http://127.0.0.1:8000",
            "--sizes",
            "6",
            "24",
            "--seed",
            "7",
            "--time-limit",
            "5",
        ]
    )

    output = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert exit_code == 0
    assert [item["exam_count"] for item in output] == [6, 24]
