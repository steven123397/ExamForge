import json

import pytest

from examforge_scheduler.benchmark import benchmark_schedule, main
from examforge_scheduler.generator import generate_scale_dataset
from examforge_scheduler.models import ExamType, validate_schedule_input


def test_scale_dataset_is_deterministic_valid_and_exact_size():
    first = generate_scale_dataset(exam_count=50, seed=20260711)
    second = generate_scale_dataset(exam_count=50, seed=20260711)

    assert first == second
    assert len(first.exam_tasks) == 50
    assert validate_schedule_input(first) == ()


def test_scale_dataset_witness_covers_resources_and_teacher_peak():
    data = generate_scale_dataset(exam_count=50, seed=20260711)
    rooms_by_type = {}
    for room in data.rooms:
        rooms_by_type.setdefault(room.room_type, []).append(room)

    assert {course.exam_type for course in data.courses} == set(ExamType)
    for task in data.exam_tasks:
        matching_rooms = rooms_by_type[task.required_room_type]
        assert any(
            room.capacity >= task.expected_count
            and set(task.required_equipment_tags).issubset(room.equipment_tags)
            for room in matching_rooms
        )
        assert len(task.allowed_slot_ids) == 1

    peak_invigilators = max(
        sum(
            task.invigilator_count
            for task in data.exam_tasks
            if task.allowed_slot_ids == (slot.id,)
        )
        for slot in data.time_slots
    )
    assert len(data.teachers) >= peak_invigilators


def test_scale_dataset_rejects_non_positive_exam_count():
    with pytest.raises(ValueError, match="exam_count must be positive"):
        generate_scale_dataset(exam_count=0, seed=20260711)


def test_benchmark_schedule_returns_fixed_metrics_for_feasible_run():
    metrics = benchmark_schedule(exam_count=24, seed=20260711, time_limit=5)

    assert set(metrics) == {
        "exam_count",
        "status",
        "elapsed_ms",
        "attempted_assignments",
        "score",
        "conflict_count",
        "teacher_max_load",
        "teacher_load_spread",
    }
    assert metrics["exam_count"] == 24
    assert metrics["status"] == "feasible"
    assert metrics["conflict_count"] == 0
    assert metrics["teacher_load_spread"] <= 1


def test_fifty_exam_benchmark_finds_complete_solution_within_five_seconds():
    metrics = benchmark_schedule(exam_count=50, seed=20260711, time_limit=5)

    assert metrics["status"] == "feasible"
    assert metrics["conflict_count"] == 0


def test_benchmark_main_prints_one_json_object_per_size(capsys):
    exit_code = main(["--sizes", "6", "24", "--seed", "7", "--time-limit", "5"])

    output = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert exit_code == 0
    assert [item["exam_count"] for item in output] == [6, 24]
    assert all(item["status"] == "feasible" for item in output)
