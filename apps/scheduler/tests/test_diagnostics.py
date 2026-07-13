from examforge_scheduler.diagnostics import build_diagnostics
from examforge_scheduler.models import ConflictRecord, ConflictSeverity

from test_scoring import make_schedule_input


def test_build_diagnostics_maps_resource_shortfalls_and_sorts_stably():
    schedule_input = make_schedule_input()
    conflicts = (
        ConflictRecord(
            type="teacher_unavailable",
            severity=ConflictSeverity.ERROR,
            affected_ids=("e1",),
            message="No teachers are available.",
            suggestion="Add teachers.",
        ),
        ConflictRecord(
            type="capacity_impossible",
            severity=ConflictSeverity.ERROR,
            affected_ids=("e1",),
            message="Room capacity is insufficient.",
            suggestion="Add a larger room.",
        ),
        ConflictRecord(
            type="student_group_overloaded",
            severity=ConflictSeverity.ERROR,
            affected_ids=("g1",),
            message="Too many exams share too few slots.",
            suggestion="Add slots.",
        ),
    )

    diagnostics = build_diagnostics(schedule_input, conflicts)

    assert [item.code for item in diagnostics] == [
        "room_capacity_shortage",
        "student_group_slot_conflict",
        "teacher_shortage",
    ]
    assert diagnostics[0].resource_dimension == "room"
    assert diagnostics[0].shortfall == 0
    assert diagnostics[1].resource_dimension == "student_group"
    assert diagnostics[1].shortfall == 0
    assert diagnostics[2].resource_dimension == "teacher"
    assert diagnostics[2].shortfall == 0


def test_build_diagnostics_maps_fixed_and_invalid_reference_conflicts():
    schedule_input = make_schedule_input()
    diagnostics = build_diagnostics(
        schedule_input,
        (
            ConflictRecord(
                type="input_validation_error",
                severity=ConflictSeverity.ERROR,
                affected_ids=("e-missing",),
                message="Input reference is invalid.",
                suggestion="Correct the input.",
            ),
            ConflictRecord(
                type="fixed_assignment_no_candidate",
                severity=ConflictSeverity.ERROR,
                affected_ids=("e1",),
                message="Fixed assignment is invalid.",
                suggestion="Change the fixed assignment.",
            ),
        ),
    )

    assert [item.code for item in diagnostics] == [
        "fixed_assignment_conflict",
        "invalid_reference",
    ]
    assert all(item.shortfall == 1 for item in diagnostics)
