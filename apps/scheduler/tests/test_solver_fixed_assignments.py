from collections import Counter

from examforge_scheduler.models import (
    ConstraintProfile,
    Course,
    ExamTask,
    ExamType,
    FixedAssignment,
    Room,
    RoomType,
    ScheduleInput,
    SolveStatus,
    StudentGroup,
    Teacher,
    TimeSlot,
)
from examforge_scheduler.solver import solve_schedule


def test_solver_respects_fixed_room_slot_assignment():
    data = _make_fixed_assignment_input(
        fixed_assignments=(
            FixedAssignment(
                exam_task_id="e1",
                room_id="r1",
                time_slot_id="s1",
            ),
        )
    )

    result = solve_schedule(data)

    assert result.statistics.status == SolveStatus.FEASIBLE
    fixed = _assignment_by_exam(result)["e1"]
    assert fixed.room_id == "r1"
    assert fixed.time_slot_id == "s1"


def test_solver_reports_conflict_when_fixed_assignment_has_no_candidate():
    data = _make_fixed_assignment_input(
        fixed_assignments=(
            FixedAssignment(
                exam_task_id="e1",
                room_id="r2",
                time_slot_id="s1",
            ),
        )
    )

    result = solve_schedule(data)

    assert result.statistics.status == SolveStatus.INFEASIBLE
    assert result.assignments == ()
    assert any(
        conflict.type == "fixed_assignment_no_candidate"
        and conflict.affected_ids == ("e1",)
        for conflict in result.conflicts
    )


def test_solver_preserves_fixed_teacher_assignment():
    data = _make_fixed_assignment_input(
        fixed_assignments=(
            FixedAssignment(
                exam_task_id="e1",
                room_id="r1",
                time_slot_id="s1",
                teacher_ids=("t3",),
            ),
        )
    )

    result = solve_schedule(data)

    assert result.statistics.status == SolveStatus.FEASIBLE
    assert _assignment_by_exam(result)["e1"].teacher_ids == ("t3",)


def test_teacher_assignment_is_load_aware_when_not_fixed():
    data = _make_teacher_load_input()

    result = solve_schedule(data)

    assert result.statistics.status == SolveStatus.FEASIBLE
    workloads = Counter(
        teacher_id
        for assignment in result.assignments
        for teacher_id in assignment.teacher_ids
    )
    assert workloads == {"t1": 2, "t2": 2}


def _assignment_by_exam(result):
    return {assignment.exam_task_id: assignment for assignment in result.assignments}


def _make_fixed_assignment_input(
    *, fixed_assignments: tuple[FixedAssignment, ...]
) -> ScheduleInput:
    return ScheduleInput(
        student_groups=(
            StudentGroup(id="g1", name="CS 2301", size=35, department_id="cs"),
            StudentGroup(id="g2", name="Math 2301", size=30, department_id="math"),
        ),
        teachers=(
            Teacher(id="t1", name="Teacher 1", department_id="cs"),
            Teacher(id="t2", name="Teacher 2", department_id="math"),
            Teacher(id="t3", name="Teacher 3", department_id="cs"),
        ),
        courses=(
            Course(id="c1", name="Algorithms", department_id="cs", exam_type=ExamType.WRITTEN),
            Course(id="c2", name="Algebra", department_id="math", exam_type=ExamType.WRITTEN),
            Course(id="c3", name="Programming", department_id="cs", exam_type=ExamType.COMPUTER),
        ),
        rooms=(
            Room(id="r1", name="Room 1", building_id="b1", capacity=60, room_type=RoomType.STANDARD),
            Room(id="r2", name="Lab 1", building_id="b1", capacity=50, room_type=RoomType.COMPUTER_LAB),
        ),
        time_slots=(
            TimeSlot(id="s1", date="2026-07-10", start_time="09:00", end_time="11:00", period_index=0),
            TimeSlot(id="s2", date="2026-07-10", start_time="14:00", end_time="16:00", period_index=1),
        ),
        exam_tasks=(
            ExamTask(
                id="e1",
                course_id="c1",
                student_group_ids=("g1",),
                expected_count=35,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
                allowed_slot_ids=("s1", "s2"),
                invigilator_count=1,
            ),
            ExamTask(
                id="e2",
                course_id="c2",
                student_group_ids=("g2",),
                expected_count=30,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
                allowed_slot_ids=("s1", "s2"),
                invigilator_count=1,
            ),
            ExamTask(
                id="e3",
                course_id="c3",
                student_group_ids=("g1",),
                expected_count=35,
                duration_minutes=120,
                required_room_type=RoomType.COMPUTER_LAB,
                allowed_slot_ids=("s1", "s2"),
                invigilator_count=1,
            ),
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=("room_time_unique", "student_group_time_unique"),
            soft_weights={},
            time_limit_seconds=5,
        ),
        fixed_assignments=fixed_assignments,
    )


def _make_teacher_load_input() -> ScheduleInput:
    return ScheduleInput(
        student_groups=tuple(
            StudentGroup(id=f"g{index}", name=f"Group {index}", size=20, department_id="cs")
            for index in range(1, 5)
        ),
        teachers=(
            Teacher(id="t1", name="Teacher 1", department_id="cs"),
            Teacher(id="t2", name="Teacher 2", department_id="cs"),
        ),
        courses=tuple(
            Course(id=f"c{index}", name=f"Course {index}", department_id="cs", exam_type=ExamType.WRITTEN)
            for index in range(1, 5)
        ),
        rooms=(
            Room(id="r1", name="Room 1", building_id="b1", capacity=40, room_type=RoomType.STANDARD),
        ),
        time_slots=tuple(
            TimeSlot(
                id=f"s{index}",
                date=f"2026-07-{10 + index}",
                start_time="09:00",
                end_time="11:00",
                period_index=index,
            )
            for index in range(1, 5)
        ),
        exam_tasks=tuple(
            ExamTask(
                id=f"e{index}",
                course_id=f"c{index}",
                student_group_ids=(f"g{index}",),
                expected_count=20,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
                allowed_slot_ids=(f"s{index}",),
                invigilator_count=1,
            )
            for index in range(1, 5)
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=("room_time_unique",),
            soft_weights={},
            time_limit_seconds=5,
        ),
    )
