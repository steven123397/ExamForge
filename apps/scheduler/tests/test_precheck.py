from dataclasses import replace

from examforge_scheduler.generator import (
    generate_conflict_capacity_dataset,
    generate_conflict_equipment_dataset,
    generate_conflict_slot_pressure_dataset,
)
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
)
from examforge_scheduler.precheck import run_precheck


def test_precheck_reports_capacity_impossible():
    conflicts = run_precheck(generate_conflict_capacity_dataset())

    assert _conflict_types(conflicts) == {"capacity_impossible"}
    conflict = conflicts[0]
    assert conflict.affected_ids == ("e001",)
    assert conflict.message
    assert conflict.suggestion


def test_precheck_reports_no_available_room_for_missing_equipment():
    conflicts = run_precheck(generate_conflict_equipment_dataset())

    assert _conflict_types(conflicts) == {"no_available_room"}
    assert conflicts[0].affected_ids == ("e001",)


def test_precheck_treats_empty_allowed_slots_as_all_slots():
    data = _single_exam_input()
    task = replace(data.exam_tasks[0], allowed_slot_ids=())
    data = replace(data, exam_tasks=(task,))

    conflicts = run_precheck(data)

    assert _conflict_types(conflicts) == set()


def test_precheck_reports_no_allowed_slot_for_missing_slot_reference():
    data = _single_exam_input()
    task = replace(data.exam_tasks[0], allowed_slot_ids=("missing-slot",))
    data = replace(data, exam_tasks=(task,))

    conflicts = run_precheck(data)

    assert _conflict_types(conflicts) == {"no_allowed_slot"}
    assert conflicts[0].affected_ids == ("e1", "missing-slot")


def test_precheck_reports_student_group_overloaded():
    conflicts = run_precheck(generate_conflict_slot_pressure_dataset())

    assert _conflict_types(conflicts) == {"student_group_overloaded"}
    assert conflicts[0].affected_ids == ("g001",)


def test_precheck_reports_teacher_unavailable_when_no_slot_has_enough_teachers():
    data = _single_exam_input()
    teachers = (
        Teacher(
            id="t1",
            name="Teacher Zhang",
            department_id="cs",
            unavailable_slot_ids=("s1", "s2"),
        ),
    )
    data = replace(data, teachers=teachers)

    conflicts = run_precheck(data)

    assert _conflict_types(conflicts) == {"teacher_unavailable"}
    assert conflicts[0].affected_ids == ("e1",)


def _single_exam_input() -> ScheduleInput:
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
                equipment_tags=("projector",),
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
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=("room_capacity",),
            soft_weights={},
            time_limit_seconds=30,
        ),
    )


def _conflict_types(conflicts):
    return {conflict.type for conflict in conflicts}
