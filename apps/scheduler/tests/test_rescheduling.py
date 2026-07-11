from dataclasses import replace

from examforge_scheduler.models import (
    ConstraintProfile,
    Course,
    ExamTask,
    ExamType,
    RescheduleContext,
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


def test_frozen_exam_keeps_complete_baseline_assignment():
    baseline = ScheduledExam("e1", "large", "s2", ("t2",))
    schedule_input = _make_single_exam_input(
        baseline=baseline,
        movable_exam_task_ids=(),
        soft_weights={
            "room_utilization": 100,
            "teacher_workload_balance": 0,
        },
    )

    result = solve_schedule(schedule_input)

    assert result.statistics.status == SolveStatus.FEASIBLE
    assert result.assignments == (baseline,)


def test_movable_exam_retains_feasible_room_slot_and_teacher_baseline():
    baseline = ScheduledExam("e1", "large", "s2", ("t2",))
    schedule_input = _make_single_exam_input(
        baseline=baseline,
        movable_exam_task_ids=("e1",),
        soft_weights={
            "schedule_stability": 100,
            "teacher_workload_balance": 0,
        },
    )

    result = solve_schedule(schedule_input)

    assert result.statistics.status == SolveStatus.FEASIBLE
    assert result.assignments == (baseline,)


def test_invalid_movable_baseline_moves_without_changing_frozen_exam():
    frozen = ScheduledExam("e1", "small", "s1", ("t1",))
    movable = ScheduledExam("e2", "small", "s2", ("t2",))
    schedule_input = _make_two_exam_capacity_change_input(
        baseline_assignments=(frozen, movable),
        movable_exam_task_ids=("e2",),
    )

    result = solve_schedule(schedule_input)

    assert result.statistics.status == SolveStatus.FEASIBLE
    assignments = _assignment_by_exam(result)
    assert assignments["e1"] == frozen
    assert assignments["e2"].room_id == "large"


def test_invalid_frozen_baseline_returns_specific_conflict():
    frozen = ScheduledExam("e1", "small", "s1", ("t1",))
    schedule_input = _make_two_exam_capacity_change_input(
        baseline_assignments=(
            frozen,
            ScheduledExam("e2", "large", "s2", ("t2",)),
        ),
        movable_exam_task_ids=("e2",),
        first_exam_expected_count=60,
    )

    result = solve_schedule(schedule_input)

    assert result.statistics.status == SolveStatus.INFEASIBLE
    assert result.assignments == ()
    assert len(result.conflicts) == 1
    assert result.conflicts[0].type == "reschedule_frozen_assignment_invalid"
    assert result.conflicts[0].affected_ids == ("e1",)


def test_schedule_stability_weight_can_outweigh_room_utilization():
    baseline = ScheduledExam("e1", "large", "s1", ("t1",))
    without_stability = _make_single_exam_input(
        baseline=baseline,
        movable_exam_task_ids=("e1",),
        soft_weights={
            "room_utilization": 30,
            "schedule_stability": 0,
        },
    )
    with_stability = replace(
        without_stability,
        constraint_profile=replace(
            without_stability.constraint_profile,
            soft_weights={
                "room_utilization": 30,
                "schedule_stability": 100,
            },
        ),
    )

    changed = solve_schedule(without_stability)
    retained = solve_schedule(with_stability)

    assert changed.statistics.status == retained.statistics.status == SolveStatus.FEASIBLE
    assert changed.assignments[0].room_id == "small"
    assert retained.assignments[0].room_id == "large"


def _make_single_exam_input(
    *,
    baseline: ScheduledExam,
    movable_exam_task_ids: tuple[str, ...],
    soft_weights: dict[str, int],
) -> ScheduleInput:
    return ScheduleInput(
        student_groups=(StudentGroup("g1", "Group 1", 30, "cs"),),
        teachers=(
            Teacher("t1", "Teacher 1", "cs"),
            Teacher("t2", "Teacher 2", "cs"),
        ),
        courses=(Course("c1", "Course 1", "cs", ExamType.WRITTEN),),
        rooms=(
            Room("small", "Small Room", "b1", 40, RoomType.STANDARD),
            Room("large", "Large Room", "b1", 200, RoomType.STANDARD),
        ),
        time_slots=(
            TimeSlot("s1", "2026-07-10", "09:00", "11:00", 0),
            TimeSlot("s2", "2026-07-10", "14:00", "16:00", 1),
        ),
        exam_tasks=(
            ExamTask(
                "e1",
                "c1",
                ("g1",),
                30,
                120,
                RoomType.STANDARD,
                invigilator_count=1,
            ),
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=("room_time_unique", "teacher_time_unique"),
            soft_weights=soft_weights,
            time_limit_seconds=5,
        ),
        reschedule_context=RescheduleContext(
            baseline_assignments=(baseline,),
            movable_exam_task_ids=movable_exam_task_ids,
        ),
    )


def _make_two_exam_capacity_change_input(
    *,
    baseline_assignments: tuple[ScheduledExam, ...],
    movable_exam_task_ids: tuple[str, ...],
    first_exam_expected_count: int = 20,
) -> ScheduleInput:
    return ScheduleInput(
        student_groups=(
            StudentGroup("g1", "Group 1", first_exam_expected_count, "cs"),
            StudentGroup("g2", "Group 2", 60, "cs"),
        ),
        teachers=(
            Teacher("t1", "Teacher 1", "cs"),
            Teacher("t2", "Teacher 2", "cs"),
        ),
        courses=(
            Course("c1", "Course 1", "cs", ExamType.WRITTEN),
            Course("c2", "Course 2", "cs", ExamType.WRITTEN),
        ),
        rooms=(
            Room("small", "Small Room", "b1", 40, RoomType.STANDARD),
            Room("large", "Large Room", "b1", 100, RoomType.STANDARD),
        ),
        time_slots=(
            TimeSlot("s1", "2026-07-10", "09:00", "11:00", 0),
            TimeSlot("s2", "2026-07-10", "14:00", "16:00", 1),
        ),
        exam_tasks=(
            ExamTask(
                "e1",
                "c1",
                ("g1",),
                first_exam_expected_count,
                120,
                RoomType.STANDARD,
                allowed_slot_ids=("s1",),
            ),
            ExamTask(
                "e2",
                "c2",
                ("g2",),
                60,
                120,
                RoomType.STANDARD,
                allowed_slot_ids=("s2",),
            ),
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=("room_time_unique", "teacher_time_unique"),
            soft_weights={"schedule_stability": 100},
            time_limit_seconds=5,
        ),
        reschedule_context=RescheduleContext(
            baseline_assignments=baseline_assignments,
            movable_exam_task_ids=movable_exam_task_ids,
        ),
    )


def _assignment_by_exam(result):
    return {assignment.exam_task_id: assignment for assignment in result.assignments}
