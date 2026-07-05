from examforge_scheduler.models import (
    ConflictSeverity,
    ConstraintProfile,
    Course,
    ExamTask,
    ExamType,
    Room,
    RoomType,
    ScheduleInput,
    SolveStatus,
    StudentGroup,
    Teacher,
    TimeSlot,
)
from examforge_scheduler.solver import solve_schedule


def test_feasible_schedule_satisfies_core_hard_constraints():
    data = _make_feasible_input()

    result = solve_schedule(data)

    assert result.statistics.status == SolveStatus.FEASIBLE
    assert result.conflicts == ()
    assert result.statistics.exam_count == 3
    assert result.statistics.room_count == 2
    assert result.statistics.slot_count == 2
    assert result.statistics.attempted_assignments > 0
    assert {assignment.exam_task_id for assignment in result.assignments} == {
        task.id for task in data.exam_tasks
    }

    room_slot_pairs = set()
    group_slot_pairs = set()
    teacher_slot_pairs = set()
    tasks_by_id = {task.id: task for task in data.exam_tasks}
    rooms_by_id = {room.id: room for room in data.rooms}
    teachers_by_id = {teacher.id: teacher for teacher in data.teachers}

    for assignment in result.assignments:
        task = tasks_by_id[assignment.exam_task_id]
        room = rooms_by_id[assignment.room_id]

        assert room.capacity >= task.expected_count
        assert room.room_type == task.required_room_type
        assert set(task.required_equipment_tags).issubset(room.equipment_tags)
        assert assignment.time_slot_id in task.allowed_slot_ids
        assert len(assignment.teacher_ids) == task.invigilator_count

        assert (assignment.room_id, assignment.time_slot_id) not in room_slot_pairs
        room_slot_pairs.add((assignment.room_id, assignment.time_slot_id))

        for group_id in task.student_group_ids:
            assert (group_id, assignment.time_slot_id) not in group_slot_pairs
            group_slot_pairs.add((group_id, assignment.time_slot_id))

        for teacher_id in assignment.teacher_ids:
            teacher = teachers_by_id[teacher_id]
            assert assignment.time_slot_id not in teacher.unavailable_slot_ids
            assert (teacher_id, assignment.time_slot_id) not in teacher_slot_pairs
            teacher_slot_pairs.add((teacher_id, assignment.time_slot_id))


def test_infeasible_when_no_room_can_satisfy_candidate_requirements():
    data = _make_feasible_input()
    oversized_task = ExamTask(
        id="e1",
        course_id="c1",
        student_group_ids=("g1",),
        expected_count=500,
        duration_minutes=120,
        required_room_type=RoomType.STANDARD,
        allowed_slot_ids=("s1", "s2"),
        invigilator_count=1,
    )
    impossible = ScheduleInput(
        student_groups=data.student_groups,
        teachers=data.teachers,
        courses=data.courses,
        rooms=data.rooms,
        time_slots=data.time_slots,
        exam_tasks=(oversized_task,),
        constraint_profile=data.constraint_profile,
    )

    result = solve_schedule(impossible)

    assert result.statistics.status == SolveStatus.INFEASIBLE
    assert result.assignments == ()
    assert result.score.hard_violation_count >= 1
    assert any(conflict.type == "no_candidate_assignment" for conflict in result.conflicts)


def test_partial_when_teacher_assignment_cannot_satisfy_hard_constraints():
    data = _make_feasible_input()
    unavailable_teachers = tuple(
        Teacher(
            id=teacher.id,
            name=teacher.name,
            department_id=teacher.department_id,
            unavailable_slot_ids=("s1", "s2"),
        )
        for teacher in data.teachers
    )
    impossible_teachers = ScheduleInput(
        student_groups=data.student_groups,
        teachers=unavailable_teachers,
        courses=data.courses,
        rooms=data.rooms,
        time_slots=data.time_slots,
        exam_tasks=data.exam_tasks,
        constraint_profile=data.constraint_profile,
    )

    result = solve_schedule(impossible_teachers)

    assert result.statistics.status == SolveStatus.PARTIAL
    assert result.assignments == ()
    assert result.score.hard_violation_count >= 1
    assert any(conflict.type == "teacher_assignment_failed" for conflict in result.conflicts)
    assert all(conflict.severity == ConflictSeverity.ERROR for conflict in result.conflicts)


def _make_feasible_input() -> ScheduleInput:
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
            Course(
                id="c1",
                name="Data Structures",
                department_id="cs",
                exam_type=ExamType.WRITTEN,
            ),
            Course(
                id="c2",
                name="Linear Algebra",
                department_id="math",
                exam_type=ExamType.WRITTEN,
            ),
            Course(
                id="c3",
                name="Programming Lab",
                department_id="cs",
                exam_type=ExamType.COMPUTER,
            ),
        ),
        rooms=(
            Room(
                id="r1",
                name="Room 101",
                building_id="b1",
                capacity=60,
                room_type=RoomType.STANDARD,
                equipment_tags=("projector",),
            ),
            Room(
                id="r2",
                name="Lab 201",
                building_id="b1",
                capacity=50,
                room_type=RoomType.COMPUTER_LAB,
                equipment_tags=("lab_pc", "projector"),
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
                required_equipment_tags=("lab_pc",),
                allowed_slot_ids=("s1", "s2"),
                invigilator_count=1,
            ),
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=(
                "exam_single_room_slot",
                "room_time_unique",
                "student_group_no_overlap",
                "room_capacity",
                "room_requirement",
                "allowed_slot",
                "teacher_unavailable",
                "teacher_time_unique",
            ),
            soft_weights={},
            time_limit_seconds=5,
        ),
    )
