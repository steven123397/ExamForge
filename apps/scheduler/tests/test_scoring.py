from dataclasses import replace

import pytest

from examforge_scheduler.models import (
    ConstraintProfile,
    Course,
    ExamTask,
    ExamType,
    Room,
    RoomType,
    RescheduleContext,
    ScheduledExam,
    ScheduleInput,
    StudentGroup,
    Teacher,
    TimeSlot,
)
from examforge_scheduler.scoring import calculate_score


def make_schedule_input() -> ScheduleInput:
    return ScheduleInput(
        student_groups=(
            StudentGroup(id="g1", name="CS 2301", size=30, department_id="cs"),
            StudentGroup(id="g2", name="CS 2302", size=24, department_id="cs"),
        ),
        teachers=(
            Teacher(id="t1", name="Teacher 1", department_id="cs"),
            Teacher(id="t2", name="Teacher 2", department_id="cs"),
            Teacher(id="t3", name="Teacher 3", department_id="cs"),
        ),
        courses=(
            Course(id="c1", name="Course 1", department_id="cs", exam_type=ExamType.WRITTEN),
            Course(id="c2", name="Course 2", department_id="cs", exam_type=ExamType.WRITTEN),
            Course(id="c3", name="Course 3", department_id="cs", exam_type=ExamType.WRITTEN),
            Course(id="c4", name="Course 4", department_id="cs", exam_type=ExamType.WRITTEN),
        ),
        rooms=(
            Room(
                id="r1",
                name="Room 1",
                building_id="b1",
                capacity=120,
                room_type=RoomType.STANDARD,
            ),
            Room(
                id="r2",
                name="Room 2",
                building_id="b1",
                capacity=40,
                room_type=RoomType.STANDARD,
            ),
        ),
        time_slots=(
            TimeSlot(id="s1", date="2026-07-10", start_time="09:00", end_time="11:00", period_index=0),
            TimeSlot(id="s2", date="2026-07-10", start_time="14:00", end_time="16:00", period_index=1),
            TimeSlot(id="s3", date="2026-07-11", start_time="09:00", end_time="11:00", period_index=2),
            TimeSlot(id="s4", date="2026-07-12", start_time="09:00", end_time="11:00", period_index=3),
        ),
        exam_tasks=(
            ExamTask(
                id="e1",
                course_id="c1",
                student_group_ids=("g1",),
                expected_count=30,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
            ),
            ExamTask(
                id="e2",
                course_id="c2",
                student_group_ids=("g1",),
                expected_count=30,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
            ),
            ExamTask(
                id="e3",
                course_id="c3",
                student_group_ids=("g2",),
                expected_count=24,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
            ),
            ExamTask(
                id="e4",
                course_id="c4",
                student_group_ids=("g2",),
                expected_count=24,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
            ),
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=("room_time_unique",),
            soft_weights={
                "student_consecutive_exam": 80,
                "teacher_workload_balance": 70,
                "room_utilization": 30,
                "exam_distribution_balance": 50,
            },
        ),
    )


def test_student_consecutive_exam_adds_weighted_penalty():
    data = make_schedule_input()
    score = calculate_score(
        data,
        (
            ScheduledExam("e1", "r2", "s1", ("t1",)),
            ScheduledExam("e2", "r2", "s2", ("t2",)),
        ),
    )

    item = _penalty(score, "student_consecutive_exam")

    assert item.penalty == 80
    assert "g1" in item.message


def test_teacher_workload_balance_penalizes_assignments_above_average():
    data = make_schedule_input()
    score = calculate_score(
        data,
        (
            ScheduledExam("e1", "r2", "s1", ("t1",)),
            ScheduledExam("e2", "r2", "s3", ("t1",)),
            ScheduledExam("e3", "r2", "s4", ("t1",)),
        ),
    )

    item = _penalty(score, "teacher_workload_balance")

    assert item.penalty == 140
    assert "t1" in item.message


def test_teacher_consecutive_invigilation_adds_weighted_penalty():
    data = make_schedule_input()
    data.constraint_profile.soft_weights["teacher_consecutive_invigilation"] = 60

    score = calculate_score(
        data,
        (
            ScheduledExam("e1", "r2", "s1", ("t1",)),
            ScheduledExam("e2", "r2", "s2", ("t1",)),
        ),
    )

    item = _penalty(score, "teacher_consecutive_invigilation")

    assert item.penalty == 60
    assert "t1" in item.message


def test_schedule_stability_penalizes_room_slot_and_teacher_changes():
    data = make_schedule_input()
    data = replace(
        data,
        exam_tasks=data.exam_tasks[:2],
        constraint_profile=replace(
            data.constraint_profile,
            soft_weights={"schedule_stability": 10},
        ),
        reschedule_context=RescheduleContext(
            baseline_assignments=(
                ScheduledExam("e1", "r2", "s1", ("t1",)),
                ScheduledExam("e2", "r2", "s2", ("t2",)),
            ),
            movable_exam_task_ids=("e1", "e2"),
        ),
    )

    score = calculate_score(
        data,
        (
            ScheduledExam("e1", "r1", "s1", ("t3",)),
            ScheduledExam("e2", "r2", "s2", ("t2",)),
        ),
    )

    item = _penalty(score, "schedule_stability")

    assert item.penalty == 30
    assert "e1" in item.message


def test_room_utilization_penalizes_low_capacity_usage():
    data = make_schedule_input()
    score = calculate_score(data, (ScheduledExam("e1", "r1", "s1", ("t1",)),))

    item = _penalty(score, "room_utilization")

    assert item.penalty == 30
    assert "25%" in item.message


def test_exam_distribution_balance_penalizes_same_day_concentration():
    data = make_schedule_input()
    score = calculate_score(
        data,
        (
            ScheduledExam("e1", "r2", "s1", ("t1",)),
            ScheduledExam("e2", "r2", "s2", ("t2",)),
            ScheduledExam("e3", "r2", "s3", ("t3",)),
        ),
    )

    item = _penalty(score, "exam_distribution_balance")

    assert item.penalty == 50
    assert "2026-07-10" in item.message


def test_total_score_never_goes_below_zero():
    data = make_schedule_input()
    score = calculate_score(
        data,
        (
            ScheduledExam("e1", "r1", "s1", ("t1",)),
            ScheduledExam("e2", "r1", "s2", ("t1",)),
            ScheduledExam("e3", "r1", "s3", ("t1",)),
            ScheduledExam("e4", "r1", "s4", ("t1",)),
        ),
    )

    assert score.total_score == 0
    assert score.hard_violation_count == 0


def _penalty(score, rule):
    for item in score.soft_penalty_items:
        if item.rule == rule:
            return item
    pytest.fail(f"missing penalty item for {rule}")
