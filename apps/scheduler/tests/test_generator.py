from examforge_scheduler.generator import (
    generate_conflict_capacity_dataset,
    generate_conflict_equipment_dataset,
    generate_conflict_slot_pressure_dataset,
    generate_medium_dataset,
    generate_small_dataset,
)
from examforge_scheduler.models import validate_schedule_input


def test_small_dataset_is_deterministic_for_same_seed():
    first = generate_small_dataset(seed=123)
    second = generate_small_dataset(seed=123)

    assert first == second
    assert validate_schedule_input(first) == ()
    assert 6 <= len(first.exam_tasks) <= 10
    assert 3 <= len(first.student_groups) <= 5
    assert 4 <= len(first.teachers) <= 6
    assert 4 <= len(first.rooms) <= 6
    assert 4 <= len(first.time_slots) <= 6


def test_medium_dataset_matches_expected_scale():
    data = generate_medium_dataset(seed=456)

    assert validate_schedule_input(data) == ()
    assert 30 <= len(data.exam_tasks) <= 80
    assert 15 <= len(data.student_groups) <= 30
    assert 20 <= len(data.teachers) <= 40
    assert 10 <= len(data.rooms) <= 20
    assert 10 <= len(data.time_slots) <= 20


def test_conflict_capacity_dataset_contains_oversized_exam():
    data = generate_conflict_capacity_dataset()

    assert validate_schedule_input(data) == ()
    max_capacity = max(room.capacity for room in data.rooms)
    assert any(task.expected_count > max_capacity for task in data.exam_tasks)


def test_conflict_slot_pressure_dataset_has_more_group_exams_than_slots():
    data = generate_conflict_slot_pressure_dataset()

    assert validate_schedule_input(data) == ()
    group_id = data.student_groups[0].id
    group_exam_count = sum(group_id in task.student_group_ids for task in data.exam_tasks)
    assert group_exam_count > len(data.time_slots)


def test_conflict_equipment_dataset_requires_missing_equipment():
    data = generate_conflict_equipment_dataset()

    assert validate_schedule_input(data) == ()
    all_equipment = set().union(*(room.equipment_tags for room in data.rooms))
    required = set().union(*(task.required_equipment_tags for task in data.exam_tasks))
    assert "lab_pc" in required
    assert "lab_pc" not in all_equipment
