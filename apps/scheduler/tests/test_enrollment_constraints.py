from dataclasses import replace

from examforge_scheduler.conflicts import detect_assignment_conflicts
from examforge_scheduler.diagnostics import build_diagnostics
from examforge_scheduler.models import (
    ConstraintProfile,
    Course,
    EnrollmentSource,
    ExamTask,
    ExamType,
    OverlapSampleParticipant,
    ParticipantMode,
    Room,
    RoomType,
    ScheduleInput,
    ScheduledExam,
    SolveStatus,
    StudentGroup,
    StudentOverlapEdge,
    Teacher,
    TimeSlot,
)
from examforge_scheduler.solver import solve_schedule


def test_cross_major_elective_overlap_blocks_the_same_slot():
    schedule_input = _enrollment_input(_overlap_edge("elective", "regular"))

    result = solve_schedule(schedule_input)

    assert result.statistics.status is SolveStatus.FEASIBLE
    assert _slot_by_exam(result.assignments)["exam-a"] != _slot_by_exam(result.assignments)["exam-b"]


def test_retake_cross_grade_overlap_blocks_the_same_slot():
    schedule_input = _enrollment_input(_overlap_edge("retake", "regular"))

    result = solve_schedule(schedule_input)

    assert result.statistics.status is SolveStatus.FEASIBLE
    assert _slot_by_exam(result.assignments)["exam-a"] != _slot_by_exam(result.assignments)["exam-b"]


def test_same_group_disjoint_rosters_can_share_a_slot():
    schedule_input = _enrollment_input((), slots=1, same_group=True)

    result = solve_schedule(schedule_input)

    assert result.statistics.status is SolveStatus.FEASIBLE
    assert _slot_by_exam(result.assignments) == {"exam-a": "slot-1", "exam-b": "slot-1"}


def test_manual_enrollment_clash_has_a_stable_diagnostic():
    schedule_input = _enrollment_input(_overlap_edge("regular", "retake"))
    assignments = (
        ScheduledExam("exam-a", "room-1", "slot-1", ("teacher-1",)),
        ScheduledExam("exam-b", "room-2", "slot-1", ("teacher-2",)),
    )

    conflicts = detect_assignment_conflicts(schedule_input, assignments)
    clash = next(conflict for conflict in conflicts if conflict.type == "student_exam_clash")
    diagnostics = build_diagnostics(schedule_input, (clash,))

    assert clash.affected_ids == ("exam-a", "exam-b", "slot-1")
    assert diagnostics[0].code == "student_exam_clash"
    assert diagnostics[0].severity.value == "error"
    assert diagnostics[0].resource_dimension == "student"
    assert diagnostics[0].affected_ids == ("exam-a", "exam-b", "slot-1")
    assert diagnostics[0].shortfall == 1


def test_groups_only_keeps_the_group_hard_constraint():
    schedule_input = replace(
        _enrollment_input((), slots=1, same_group=True),
        participant_mode=ParticipantMode.GROUPS_ONLY,
    )

    result = solve_schedule(schedule_input)

    assert result.statistics.status is SolveStatus.INFEASIBLE


def test_invalid_enrollment_edge_has_a_stable_diagnostic():
    edge = _overlap_edge("regular", "retake")
    schedule_input = replace(
        _enrollment_input(edge),
        student_overlap_edges=(replace(edge, exam_task_id_b="exam-a"),),
    )

    result = solve_schedule(schedule_input)

    assert result.statistics.status is SolveStatus.ERROR
    assert result.diagnostics[0].code == "student_overlap_edge_invalid"
    assert result.diagnostics[0].severity.value == "error"
    assert result.diagnostics[0].resource_dimension == "input"


def _enrollment_input(
    edges: StudentOverlapEdge | tuple[StudentOverlapEdge, ...],
    *,
    slots: int = 2,
    same_group: bool = False,
) -> ScheduleInput:
    if isinstance(edges, StudentOverlapEdge):
        edges = (edges,)
    groups = (
        StudentGroup("group-cs", "CS", 40, "cs"),
        StudentGroup("group-math", "Math", 40, "math"),
    )
    time_slots = tuple(
        TimeSlot(
            f"slot-{index}",
            "2026-08-03",
            f"0{index + 7}:00",
            f"0{index + 9}:00",
            index - 1,
        )
        for index in range(1, slots + 1)
    )
    return ScheduleInput(
        student_groups=groups,
        teachers=(
            Teacher("teacher-1", "Teacher 1", "cs"),
            Teacher("teacher-2", "Teacher 2", "math"),
        ),
        courses=(
            Course("course-a", "Course A", "cs", ExamType.WRITTEN),
            Course("course-b", "Course B", "math", ExamType.WRITTEN),
        ),
        rooms=(
            Room("room-1", "Room 1", "building", 60, RoomType.STANDARD),
            Room("room-2", "Room 2", "building", 60, RoomType.STANDARD),
        ),
        time_slots=time_slots,
        exam_tasks=(
            ExamTask(
                "exam-a",
                "course-a",
                ("group-cs",),
                30,
                120,
                RoomType.STANDARD,
                allowed_slot_ids=tuple(slot.id for slot in time_slots),
                invigilator_count=1,
            ),
            ExamTask(
                "exam-b",
                "course-b",
                ("group-cs" if same_group else "group-math",),
                30,
                120,
                RoomType.STANDARD,
                allowed_slot_ids=tuple(slot.id for slot in time_slots),
                invigilator_count=1,
            ),
        ),
        constraint_profile=ConstraintProfile((), {}, 5),
        participant_mode=ParticipantMode.ENROLLMENTS,
        student_overlap_edges=edges,
    )


def _overlap_edge(
    exam_a_source: str,
    exam_b_source: str,
) -> StudentOverlapEdge:
    return StudentOverlapEdge(
        "exam-a",
        "exam-b",
        1,
        (
            OverlapSampleParticipant(
                "S000001",
                EnrollmentSource(exam_a_source),
                EnrollmentSource(exam_b_source),
            ),
        ),
    )


def _slot_by_exam(assignments: tuple[ScheduledExam, ...]) -> dict[str, str]:
    return {assignment.exam_task_id: assignment.time_slot_id for assignment in assignments}
