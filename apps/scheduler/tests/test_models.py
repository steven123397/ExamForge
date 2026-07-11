from dataclasses import replace

from examforge_scheduler.models import (
    ConstraintProfile,
    Course,
    ExamTask,
    ExamType,
    FixedAssignment,
    RescheduleContext,
    Room,
    RoomType,
    ScheduleInput,
    ScheduledExam,
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


def test_valid_reschedule_context_has_no_validation_errors():
    context = RescheduleContext(
        baseline_assignments=(
            ScheduledExam("e1", "r1", "s1", ("t1",)),
        ),
        movable_exam_task_ids=("e1",),
    )

    assert (
        validate_schedule_input(
            replace(make_valid_input(), reschedule_context=context)
        )
        == ()
    )


def test_reschedule_context_rejects_duplicate_baseline_exam_ids():
    assignment = ScheduledExam("e1", "r1", "s1", ("t1",))
    context = RescheduleContext(
        baseline_assignments=(assignment, assignment),
        movable_exam_task_ids=("e1",),
    )

    errors = validate_schedule_input(
        replace(make_valid_input(), reschedule_context=context)
    )

    assert errors == (
        "reschedule_context baseline_assignments references duplicate exam_task_id e1",
    )


def test_reschedule_context_rejects_missing_and_unknown_baseline_exams():
    data = make_valid_input()
    missing_context = RescheduleContext(
        baseline_assignments=(
            ScheduledExam("e1", "r1", "s1", ("t1",)),
        ),
        movable_exam_task_ids=(),
    )
    unknown_context = RescheduleContext(
        baseline_assignments=(
            ScheduledExam("e1", "r1", "s1", ("t1",)),
            ScheduledExam("e2", "r1", "s1", ("t1",)),
        ),
        movable_exam_task_ids=("e1",),
    )

    assert validate_schedule_input(
        replace(
            data,
            exam_tasks=(
                *data.exam_tasks,
                replace(data.exam_tasks[0], id="e2"),
            ),
            reschedule_context=missing_context,
        )
    ) == (
        "reschedule_context baseline_assignments missing exam_task_id e2",
    )
    assert validate_schedule_input(
        replace(make_valid_input(), reschedule_context=unknown_context)
    ) == (
        "reschedule_context baseline_assignment references missing exam_task_id e2",
    )


def test_reschedule_context_rejects_empty_baseline_with_no_exam_tasks():
    context = RescheduleContext(
        baseline_assignments=(),
        movable_exam_task_ids=(),
    )

    errors = validate_schedule_input(
        replace(make_valid_input(), exam_tasks=(), reschedule_context=context)
    )

    assert errors == (
        "reschedule_context baseline_assignments must not be empty",
    )


def test_reschedule_context_rejects_unknown_assignment_references():
    context = RescheduleContext(
        baseline_assignments=(
            ScheduledExam(
                "e1",
                "missing-room",
                "missing-slot",
                ("missing-teacher",),
            ),
        ),
        movable_exam_task_ids=("e1",),
    )

    errors = validate_schedule_input(
        replace(make_valid_input(), reschedule_context=context)
    )

    assert errors == (
        "reschedule_context baseline_assignment e1 references missing room_id missing-room",
        "reschedule_context baseline_assignment e1 references missing time_slot_id missing-slot",
        "reschedule_context baseline_assignment e1 references missing teacher_id missing-teacher",
    )


def test_reschedule_context_rejects_duplicate_and_unknown_movable_exam_ids():
    context = RescheduleContext(
        baseline_assignments=(
            ScheduledExam("e1", "r1", "s1", ("t1",)),
        ),
        movable_exam_task_ids=("e1", "e1", "missing-exam"),
    )

    errors = validate_schedule_input(
        replace(make_valid_input(), reschedule_context=context)
    )

    assert errors == (
        "reschedule_context movable_exam_task_ids contains duplicate exam_task_id e1",
        "reschedule_context movable_exam_task_ids references missing baseline exam_task_id missing-exam",
    )


def test_reschedule_context_rejects_fixed_assignment_conflict_for_frozen_exam():
    data = make_valid_input()
    context = RescheduleContext(
        baseline_assignments=(
            ScheduledExam("e1", "r1", "s1", ("t1",)),
        ),
        movable_exam_task_ids=(),
    )
    invalid = replace(
        data,
        teachers=(
            *data.teachers,
            Teacher(id="t2", name="Teacher Li", department_id="cs"),
        ),
        rooms=(
            *data.rooms,
            Room(
                id="r2",
                name="Room 102",
                building_id="b1",
                capacity=60,
                room_type=RoomType.STANDARD,
            ),
        ),
        time_slots=(
            *data.time_slots,
            TimeSlot(
                id="s2",
                date="2026-07-10",
                start_time="14:00",
                end_time="16:00",
                period_index=1,
            ),
        ),
        fixed_assignments=(
            FixedAssignment("e1", "r2", "s2", ("t2",)),
        ),
        reschedule_context=context,
    )

    errors = validate_schedule_input(invalid)

    assert errors == (
        "reschedule_context frozen exam_task_id e1 conflicts with fixed_assignment fields room_id, time_slot_id, teacher_ids",
    )


def test_reschedule_context_allows_unfixed_teachers_for_frozen_exam():
    data = make_valid_input()
    context = RescheduleContext(
        baseline_assignments=(
            ScheduledExam("e1", "r1", "s1", ("t1",)),
        ),
        movable_exam_task_ids=(),
    )

    schedule_input = replace(
        data,
        fixed_assignments=(FixedAssignment("e1", "r1", "s1", ()),),
        reschedule_context=context,
    )

    assert validate_schedule_input(schedule_input) == ()


def test_reschedule_context_compares_fixed_teachers_as_an_unordered_set():
    data = make_valid_input()
    context = RescheduleContext(
        baseline_assignments=(
            ScheduledExam("e1", "r1", "s1", ("t1", "t2")),
        ),
        movable_exam_task_ids=(),
    )
    schedule_input = replace(
        data,
        teachers=(
            *data.teachers,
            Teacher(id="t2", name="Teacher Li", department_id="cs"),
        ),
        fixed_assignments=(
            FixedAssignment("e1", "r1", "s1", ("t2", "t1")),
        ),
        reschedule_context=context,
    )

    assert validate_schedule_input(schedule_input) == ()


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
