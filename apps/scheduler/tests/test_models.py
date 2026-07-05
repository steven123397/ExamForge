from examforge_scheduler.models import (
    ConstraintProfile,
    Course,
    ExamTask,
    ExamType,
    Room,
    RoomType,
    ScheduleInput,
    StudentGroup,
    Teacher,
    TimeSlot,
    validate_schedule_input,
)


def make_valid_input() -> ScheduleInput:
    return ScheduleInput(
        student_groups=(
            StudentGroup(id="g1", name="CS 2301", size=35, department_id="cs"),
        ),
        teachers=(Teacher(id="t1", name="Teacher Zhang", department_id="cs"),),
        courses=(
            Course(
                id="c1",
                name="Data Structures",
                department_id="cs",
                exam_type=ExamType.WRITTEN,
            ),
        ),
        rooms=(
            Room(
                id="r1",
                name="Room 101",
                building_id="b1",
                capacity=60,
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
                expected_count=35,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
                allowed_slot_ids=("s1",),
                invigilator_count=1,
            ),
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=("room_time_unique", "student_group_no_overlap"),
            soft_weights={"student_consecutive_exam": 80},
            time_limit_seconds=30,
        ),
    )


def test_valid_schedule_input_has_no_validation_errors():
    assert validate_schedule_input(make_valid_input()) == ()


def test_validation_reports_missing_references():
    data = make_valid_input()
    bad_task = ExamTask(
        id="e2",
        course_id="missing-course",
        student_group_ids=("missing-group",),
        expected_count=10,
        duration_minutes=120,
        required_room_type=RoomType.STANDARD,
        allowed_slot_ids=("missing-slot",),
    )
    invalid = ScheduleInput(
        student_groups=data.student_groups,
        teachers=data.teachers,
        courses=data.courses,
        rooms=data.rooms,
        time_slots=data.time_slots,
        exam_tasks=(bad_task,),
        constraint_profile=data.constraint_profile,
    )

    errors = validate_schedule_input(invalid)

    assert any("missing-course" in error for error in errors)
    assert any("missing-group" in error for error in errors)
    assert any("missing-slot" in error for error in errors)


def test_validation_reports_invalid_scalar_fields():
    data = make_valid_input()
    invalid = ScheduleInput(
        student_groups=(
            StudentGroup(id="g1", name="CS 2301", size=0, department_id="cs"),
        ),
        teachers=data.teachers,
        courses=data.courses,
        rooms=(
            Room(
                id="r1",
                name="Room 101",
                building_id="b1",
                capacity=0,
                room_type=RoomType.STANDARD,
            ),
        ),
        time_slots=(
            TimeSlot(
                id="s1",
                date="2026-07-10",
                start_time="09:00",
                end_time="11:00",
                period_index=-1,
            ),
        ),
        exam_tasks=(
            ExamTask(
                id="e1",
                course_id="c1",
                student_group_ids=(),
                expected_count=0,
                duration_minutes=0,
                required_room_type=RoomType.STANDARD,
                allowed_slot_ids=("s1",),
                invigilator_count=0,
            ),
        ),
        constraint_profile=data.constraint_profile,
    )

    errors = validate_schedule_input(invalid)

    assert any("student_group g1 size must be > 0" in error for error in errors)
    assert any("room r1 capacity must be > 0" in error for error in errors)
    assert any("time_slot s1 period_index must be >= 0" in error for error in errors)
    assert any("exam_task e1 expected_count must be > 0" in error for error in errors)
    assert any("exam_task e1 duration_minutes must be > 0" in error for error in errors)
    assert any("exam_task e1 student_group_ids must not be empty" in error for error in errors)
    assert any("exam_task e1 invigilator_count must be > 0" in error for error in errors)
