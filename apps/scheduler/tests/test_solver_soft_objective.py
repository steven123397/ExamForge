from collections import Counter
from dataclasses import replace

from examforge_scheduler.models import (
    ConstraintProfile,
    Course,
    ExamTask,
    ExamType,
    Room,
    RoomType,
    RescheduleContext,
    ScheduleInput,
    ScheduledExam,
    SolveStatus,
    StudentGroup,
    Teacher,
    TimeSlot,
)
from examforge_scheduler.solver import solve_schedule


def test_room_utilization_weight_prefers_better_fit_room():
    data = _make_room_utilization_input({"room_utilization": 1000})

    result = solve_schedule(data)

    assert result.statistics.status == SolveStatus.FEASIBLE
    assert _assignment_by_exam(result)["e1"].room_id == "small"


def test_student_consecutive_exam_weight_prefers_non_adjacent_slots():
    data = _make_student_consecutive_input({"student_consecutive_exam": 1000})

    result = solve_schedule(data)

    assert result.statistics.status == SolveStatus.FEASIBLE
    assigned_slots = {
        assignment.time_slot_id for assignment in result.assignments
    }
    assert assigned_slots != {"s1", "s2"}
    assert all(
        item.rule != "student_consecutive_exam"
        for item in result.score.soft_penalty_items
    )


def test_student_consecutive_exam_weight_does_not_avoid_the_next_day():
    data = _make_student_consecutive_input({"student_consecutive_exam": 1000})
    data = replace(
        data,
        time_slots=tuple(
            replace(
                slot,
                date="2026-07-10" if slot.id == "s1" else "2026-07-11",
            )
            for slot in data.time_slots
        ),
        exam_tasks=(
            replace(data.exam_tasks[0], allowed_slot_ids=("s1",)),
            replace(data.exam_tasks[1], allowed_slot_ids=("s2", "s3")),
        ),
        constraint_profile=replace(
            data.constraint_profile,
            soft_weights={
                "student_consecutive_exam": 1000,
                "schedule_stability": 1,
            },
        ),
        reschedule_context=RescheduleContext(
            baseline_assignments=(
                ScheduledExam("e1", "r1", "s1", ("t1",)),
                ScheduledExam("e2", "r2", "s2", ("t2",)),
            ),
            movable_exam_task_ids=("e2",),
        ),
    )

    result = solve_schedule(data)

    assert result.statistics.status == SolveStatus.FEASIBLE
    assert {assignment.time_slot_id for assignment in result.assignments} == {"s1", "s2"}


def test_exam_distribution_weight_reduces_single_day_concentration():
    data = _make_distribution_input({"exam_distribution_balance": 1000})

    result = solve_schedule(data)

    assert result.statistics.status == SolveStatus.FEASIBLE
    slot_by_id = {slot.id: slot for slot in data.time_slots}
    date_counts = Counter(
        slot_by_id[assignment.time_slot_id].date
        for assignment in result.assignments
    )
    assert max(date_counts.values()) < len(result.assignments)


def test_solve_schedule_returns_soft_score_breakdown_for_final_assignments():
    data = _make_room_utilization_input({"room_utilization": 30})

    result = solve_schedule(data)

    assert result.statistics.status == SolveStatus.FEASIBLE
    assert result.score.total_score == 100
    assert result.score.soft_penalty_items == ()

    low_utilization_data = _make_room_utilization_input({"room_utilization": 30})
    low_utilization_result = solve_schedule(
        ScheduleInput(
            student_groups=low_utilization_data.student_groups,
            teachers=low_utilization_data.teachers,
            courses=low_utilization_data.courses,
            rooms=(low_utilization_data.rooms[1],),
            time_slots=low_utilization_data.time_slots,
            exam_tasks=low_utilization_data.exam_tasks,
            constraint_profile=low_utilization_data.constraint_profile,
        )
    )

    assert low_utilization_result.statistics.status == SolveStatus.FEASIBLE
    assert low_utilization_result.score.total_score == 70
    assert [item.rule for item in low_utilization_result.score.soft_penalty_items] == [
        "room_utilization"
    ]


def _assignment_by_exam(result):
    return {assignment.exam_task_id: assignment for assignment in result.assignments}


def _make_room_utilization_input(soft_weights: dict[str, int]) -> ScheduleInput:
    return ScheduleInput(
        student_groups=(
            StudentGroup(id="g1", name="CS 2301", size=30, department_id="cs"),
        ),
        teachers=(Teacher(id="t1", name="Teacher 1", department_id="cs"),),
        courses=(
            Course(
                id="c1",
                name="Algorithms",
                department_id="cs",
                exam_type=ExamType.WRITTEN,
            ),
        ),
        rooms=(
            Room(
                id="small",
                name="Small Room",
                building_id="b1",
                capacity=40,
                room_type=RoomType.STANDARD,
            ),
            Room(
                id="large",
                name="Large Room",
                building_id="b1",
                capacity=200,
                room_type=RoomType.STANDARD,
            ),
        ),
        time_slots=(
            TimeSlot(
                id="s1",
                date="2026-07-10",
                start_time="09:00",
                end_time="11:00",
                period_index=0,
            ),
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
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=("room_time_unique",),
            soft_weights=soft_weights,
            time_limit_seconds=5,
        ),
    )


def _make_student_consecutive_input(soft_weights: dict[str, int]) -> ScheduleInput:
    return ScheduleInput(
        student_groups=(
            StudentGroup(id="g1", name="CS 2301", size=20, department_id="cs"),
        ),
        teachers=(
            Teacher(id="t1", name="Teacher 1", department_id="cs"),
            Teacher(id="t2", name="Teacher 2", department_id="cs"),
        ),
        courses=(
            Course(
                id="c1",
                name="Algorithms",
                department_id="cs",
                exam_type=ExamType.WRITTEN,
            ),
            Course(
                id="c2",
                name="Databases",
                department_id="cs",
                exam_type=ExamType.WRITTEN,
            ),
        ),
        rooms=(
            Room(
                id="r1",
                name="Room 1",
                building_id="b1",
                capacity=40,
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
            TimeSlot(
                id="s1",
                date="2026-07-10",
                start_time="09:00",
                end_time="11:00",
                period_index=0,
            ),
            TimeSlot(
                id="s2",
                date="2026-07-10",
                start_time="14:00",
                end_time="16:00",
                period_index=1,
            ),
            TimeSlot(
                id="s3",
                date="2026-07-11",
                start_time="09:00",
                end_time="11:00",
                period_index=2,
            ),
        ),
        exam_tasks=(
            ExamTask(
                id="e1",
                course_id="c1",
                student_group_ids=("g1",),
                expected_count=20,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
            ),
            ExamTask(
                id="e2",
                course_id="c2",
                student_group_ids=("g1",),
                expected_count=20,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
            ),
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=("room_time_unique",),
            soft_weights=soft_weights,
            time_limit_seconds=5,
        ),
    )


def _make_distribution_input(soft_weights: dict[str, int]) -> ScheduleInput:
    return ScheduleInput(
        student_groups=(
            StudentGroup(id="g1", name="CS 2301", size=20, department_id="cs"),
            StudentGroup(id="g2", name="CS 2302", size=20, department_id="cs"),
            StudentGroup(id="g3", name="CS 2303", size=20, department_id="cs"),
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
        ),
        rooms=(
            Room(id="r1", name="Room 1", building_id="b1", capacity=40, room_type=RoomType.STANDARD),
            Room(id="r2", name="Room 2", building_id="b1", capacity=40, room_type=RoomType.STANDARD),
            Room(id="r3", name="Room 3", building_id="b1", capacity=40, room_type=RoomType.STANDARD),
        ),
        time_slots=(
            TimeSlot(id="s1", date="2026-07-10", start_time="09:00", end_time="11:00", period_index=0),
            TimeSlot(id="s2", date="2026-07-10", start_time="14:00", end_time="16:00", period_index=1),
            TimeSlot(id="s3", date="2026-07-10", start_time="18:00", end_time="20:00", period_index=2),
            TimeSlot(id="s4", date="2026-07-11", start_time="09:00", end_time="11:00", period_index=3),
            TimeSlot(id="s5", date="2026-07-11", start_time="14:00", end_time="16:00", period_index=4),
            TimeSlot(id="s6", date="2026-07-11", start_time="18:00", end_time="20:00", period_index=5),
        ),
        exam_tasks=(
            ExamTask(
                id="e1",
                course_id="c1",
                student_group_ids=("g1",),
                expected_count=20,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
            ),
            ExamTask(
                id="e2",
                course_id="c2",
                student_group_ids=("g2",),
                expected_count=20,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
            ),
            ExamTask(
                id="e3",
                course_id="c3",
                student_group_ids=("g3",),
                expected_count=20,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
            ),
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=("room_time_unique",),
            soft_weights=soft_weights,
            time_limit_seconds=5,
        ),
    )
