from dataclasses import replace

from examforge_scheduler.conflicts import detect_assignment_conflicts
from examforge_scheduler.models import (
    ConstraintProfile,
    ConflictSeverity,
    Course,
    ExamTask,
    ExamType,
    Room,
    RoomType,
    ScheduleInput,
    ScheduledExam,
    StudentGroup,
    Teacher,
    TimeSlot,
)


def test_detect_assignment_conflicts_reports_unscheduled_exam():
    data = _two_exam_input()
    assignments = (
        ScheduledExam(
            exam_task_id="e1",
            room_id="r1",
            time_slot_id="s1",
            teacher_ids=("t1",),
        ),
    )

    conflicts = detect_assignment_conflicts(data, assignments)

    conflict = _only_conflict_of_type(conflicts, "unscheduled_exam")
    assert conflict.severity == ConflictSeverity.ERROR
    assert conflict.affected_ids == ("e2",)
    assert conflict.message
    assert conflict.suggestion


def test_detect_assignment_conflicts_reports_room_time_conflict():
    data = _two_exam_input()
    assignments = (
        ScheduledExam("e1", "r1", "s1", ("t1",)),
        ScheduledExam("e2", "r1", "s1", ("t2",)),
    )

    conflicts = detect_assignment_conflicts(data, assignments)

    conflict = _only_conflict_of_type(conflicts, "room_time_conflict")
    assert conflict.affected_ids == ("r1", "s1", "e1", "e2")


def test_detect_assignment_conflicts_reports_student_group_clash():
    data = _two_exam_input()
    assignments = (
        ScheduledExam("e1", "r1", "s1", ("t1",)),
        ScheduledExam("e2", "r2", "s1", ("t2",)),
    )

    conflicts = detect_assignment_conflicts(data, assignments)

    conflict = _only_conflict_of_type(conflicts, "student_group_clash")
    assert conflict.affected_ids == ("g1", "s1", "e1", "e2")


def test_detect_assignment_conflicts_reports_teacher_time_clash():
    data = _two_exam_input()
    assignments = (
        ScheduledExam("e1", "r1", "s1", ("t1",)),
        ScheduledExam("e2", "r2", "s1", ("t1",)),
    )

    conflicts = detect_assignment_conflicts(data, assignments)

    conflict = _only_conflict_of_type(conflicts, "teacher_time_clash")
    assert conflict.affected_ids == ("t1", "s1", "e1", "e2")


def test_detect_assignment_conflicts_reports_room_capacity_mismatch():
    data = _two_exam_input()
    rooms = (replace(data.rooms[0], capacity=20), data.rooms[1])
    data = replace(data, rooms=rooms)
    assignments = (
        ScheduledExam("e1", "r1", "s1", ("t1",)),
        ScheduledExam("e2", "r2", "s2", ("t2",)),
    )

    conflicts = detect_assignment_conflicts(data, assignments)

    conflict = _only_conflict_of_type(conflicts, "room_capacity_mismatch")
    assert conflict.affected_ids == ("e1", "r1")


def test_detect_assignment_conflicts_reports_room_requirement_mismatch():
    data = _two_exam_input()
    task = replace(
        data.exam_tasks[0],
        required_room_type=RoomType.COMPUTER_LAB,
        required_equipment_tags=("lab_pc",),
    )
    data = replace(data, exam_tasks=(task, data.exam_tasks[1]))
    assignments = (
        ScheduledExam("e1", "r1", "s1", ("t1",)),
        ScheduledExam("e2", "r2", "s2", ("t2",)),
    )

    conflicts = detect_assignment_conflicts(data, assignments)

    conflict = _only_conflict_of_type(conflicts, "room_requirement_mismatch")
    assert conflict.affected_ids == ("e1", "r1")


def _two_exam_input() -> ScheduleInput:
    return ScheduleInput(
        student_groups=(
            StudentGroup(id="g1", name="CS 2301", size=35, department_id="cs"),
        ),
        teachers=(
            Teacher(id="t1", name="Teacher Zhang", department_id="cs"),
            Teacher(id="t2", name="Teacher Wang", department_id="cs"),
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
                name="Operating Systems",
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
            Room(
                id="r2",
                name="Room 102",
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
            ExamTask(
                id="e2",
                course_id="c2",
                student_group_ids=("g1",),
                expected_count=35,
                duration_minutes=120,
                required_room_type=RoomType.STANDARD,
                allowed_slot_ids=("s1", "s2"),
                invigilator_count=1,
            ),
        ),
        constraint_profile=ConstraintProfile(
            hard_rules=("room_time_unique",),
            soft_weights={},
            time_limit_seconds=30,
        ),
    )


def _only_conflict_of_type(conflicts, conflict_type):
    matched = [conflict for conflict in conflicts if conflict.type == conflict_type]
    assert len(matched) == 1
    return matched[0]
