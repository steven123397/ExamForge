from collections import Counter
from dataclasses import replace

from examforge_scheduler.models import (
    ConstraintProfile,
    Course,
    ExamTask,
    ExamType,
    FixedAssignment,
    Room,
    RoomType,
    ScheduleInput,
    ScheduledExam,
    SolveStatus,
    StudentGroup,
    Teacher,
    TimeSlot,
)
from examforge_scheduler.solver import solve_schedule
from examforge_scheduler.teacher_assignment import assign_teachers


def test_optimizer_reserves_unique_teacher_for_later_slot():
    schedule_input = _make_input(
        teacher_unavailable={"t2": ("s2",)},
        soft_weights={"teacher_workload_balance": 70},
    )

    result = solve_schedule(schedule_input)

    assert result.statistics.status == SolveStatus.FEASIBLE
    assignments = _assignment_by_exam(result.assignments)
    assert assignments["e1"].teacher_ids == ("t2",)
    assert assignments["e2"].teacher_ids == ("t1",)
    assert Counter(_teacher_ids(result.assignments)) == {"t1": 1, "t2": 1}


def test_optimizer_preserves_fixed_multi_teacher_assignment():
    schedule_input = _make_input(
        exam_count=1,
        teacher_count=3,
        invigilator_counts=(2,),
        fixed_assignments=(
            FixedAssignment("e1", "r1", "s1", ("t2", "t3")),
        ),
    )

    assignments, conflicts = assign_teachers(
        schedule_input,
        (ScheduledExam("e1", "r1", "s1"),),
    )

    assert conflicts == ()
    assert assignments[0].teacher_ids == ("t2", "t3")


def test_optimizer_excludes_unavailable_teacher():
    schedule_input = _make_input(
        exam_count=1,
        teacher_unavailable={"t1": ("s1",)},
    )

    assignments, conflicts = assign_teachers(
        schedule_input,
        (ScheduledExam("e1", "r1", "s1"),),
    )

    assert conflicts == ()
    assert assignments[0].teacher_ids == ("t2",)


def test_optimizer_assigns_teacher_at_most_once_per_slot():
    schedule_input = _make_input(exam_count=2, slot_ids=("s1", "s1"))

    assignments, conflicts = assign_teachers(
        schedule_input,
        (
            ScheduledExam("e1", "r1", "s1"),
            ScheduledExam("e2", "r2", "s1"),
        ),
    )

    assert conflicts == ()
    assert len(set(_teacher_ids(assignments))) == 2


def test_optimizer_reports_teacher_assignment_failed_when_capacity_is_insufficient():
    schedule_input = _make_input(
        exam_count=2,
        teacher_count=1,
        slot_ids=("s1", "s1"),
    )

    assignments, conflicts = assign_teachers(
        schedule_input,
        (
            ScheduledExam("e1", "r1", "s1"),
            ScheduledExam("e2", "r2", "s1"),
        ),
    )

    assert assignments == ()
    assert len(conflicts) == 1
    assert conflicts[0].type == "teacher_assignment_failed"
    assert conflicts[0].affected_ids == ("e1", "e2")


def test_optimizer_returns_stable_output_for_identical_input():
    schedule_input = _make_input(exam_count=3, teacher_count=3)
    room_slot_assignments = tuple(
        ScheduledExam(f"e{index}", f"r{index}", f"s{index}")
        for index in range(1, 4)
    )

    outputs = {
        assign_teachers(schedule_input, room_slot_assignments)[0]
        for _ in range(5)
    }

    assert len(outputs) == 1


def test_consecutive_weight_changes_teacher_selection():
    assignments = (
        ScheduledExam("e1", "r1", "s1"),
        ScheduledExam("e2", "r2", "s2"),
        ScheduledExam("e3", "r3", "s3"),
    )
    fixed_assignments = (
        FixedAssignment("e1", "r1", "s1", ("t1",)),
        FixedAssignment("e3", "r3", "s3", ("t2",)),
    )
    without_weight = _make_input(
        exam_count=3,
        teacher_count=3,
        fixed_assignments=fixed_assignments,
        soft_weights={"teacher_workload_balance": 0},
    )
    with_weight = replace(
        without_weight,
        constraint_profile=replace(
            without_weight.constraint_profile,
            soft_weights={
                "teacher_workload_balance": 0,
                "teacher_consecutive_invigilation": 80,
            },
        ),
    )

    unweighted, unweighted_conflicts = assign_teachers(without_weight, assignments)
    weighted, weighted_conflicts = assign_teachers(with_weight, assignments)

    assert unweighted_conflicts == weighted_conflicts == ()
    assert _assignment_by_exam(unweighted)["e2"].teacher_ids == ("t1",)
    assert _assignment_by_exam(weighted)["e2"].teacher_ids == ("t3",)


def _make_input(
    *,
    exam_count: int = 2,
    teacher_count: int = 2,
    slot_ids: tuple[str, ...] | None = None,
    invigilator_counts: tuple[int, ...] | None = None,
    teacher_unavailable: dict[str, tuple[str, ...]] | None = None,
    fixed_assignments: tuple[FixedAssignment, ...] = (),
    soft_weights: dict[str, int] | None = None,
) -> ScheduleInput:
    slot_ids = slot_ids or tuple(f"s{index}" for index in range(1, exam_count + 1))
    invigilator_counts = invigilator_counts or (1,) * exam_count
    teacher_unavailable = teacher_unavailable or {}
    unique_slot_ids = tuple(dict.fromkeys(slot_ids))

    return ScheduleInput(
        student_groups=tuple(
            StudentGroup(f"g{index}", f"Group {index}", 20, "cs")
            for index in range(1, exam_count + 1)
        ),
        teachers=tuple(
            Teacher(
                f"t{index}",
                f"Teacher {index}",
                "cs",
                teacher_unavailable.get(f"t{index}", ()),
            )
            for index in range(1, teacher_count + 1)
        ),
        courses=tuple(
            Course(f"c{index}", f"Course {index}", "cs", ExamType.WRITTEN)
            for index in range(1, exam_count + 1)
        ),
        rooms=tuple(
            Room(f"r{index}", f"Room {index}", "b1", 40, RoomType.STANDARD)
            for index in range(1, exam_count + 1)
        ),
        time_slots=tuple(
            TimeSlot(slot_id, "2026-07-10", "09:00", "11:00", index)
            for index, slot_id in enumerate(unique_slot_ids)
        ),
        exam_tasks=tuple(
            ExamTask(
                f"e{index}",
                f"c{index}",
                (f"g{index}",),
                20,
                120,
                RoomType.STANDARD,
                allowed_slot_ids=(slot_ids[index - 1],),
                invigilator_count=invigilator_counts[index - 1],
            )
            for index in range(1, exam_count + 1)
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=("room_time_unique", "teacher_time_unique"),
            soft_weights=soft_weights or {},
            time_limit_seconds=5,
        ),
        fixed_assignments=fixed_assignments,
    )


def _assignment_by_exam(
    assignments: tuple[ScheduledExam, ...],
) -> dict[str, ScheduledExam]:
    return {assignment.exam_task_id: assignment for assignment in assignments}


def _teacher_ids(assignments: tuple[ScheduledExam, ...]):
    return (
        teacher_id
        for assignment in assignments
        for teacher_id in assignment.teacher_ids
    )
