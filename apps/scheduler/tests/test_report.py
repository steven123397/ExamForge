import json
from dataclasses import replace

from examforge_scheduler.models import (
    ConflictRecord,
    ConflictSeverity,
    ConstraintProfile,
    Course,
    ExamTask,
    ExamType,
    NormalizedPenaltyItem,
    Room,
    RoomType,
    RescheduleContext,
    ScheduledExam,
    ScheduleInput,
    ScheduleResult,
    ScoreBreakdown,
    SoftPenaltyItem,
    SolveStatus,
    SolverStatistics,
    StudentGroup,
    Teacher,
    TimeSlot,
)
from examforge_scheduler.report import build_schedule_report


def make_report_input() -> ScheduleInput:
    return ScheduleInput(
        student_groups=(
            StudentGroup(id="g1", name="CS 2301", size=30, department_id="cs"),
            StudentGroup(id="g2", name="CS 2302", size=20, department_id="cs"),
        ),
        teachers=(
            Teacher(id="t1", name="Teacher 1", department_id="cs"),
            Teacher(id="t2", name="Teacher 2", department_id="cs"),
        ),
        courses=(
            Course(id="c1", name="Course 1", department_id="cs", exam_type=ExamType.WRITTEN),
            Course(id="c2", name="Course 2", department_id="cs", exam_type=ExamType.WRITTEN),
        ),
        rooms=(
            Room(id="r1", name="Room 1", building_id="b1", capacity=60, room_type=RoomType.STANDARD),
            Room(id="r2", name="Room 2", building_id="b1", capacity=40, room_type=RoomType.STANDARD),
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
                expected_count=30,
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
        ),
        constraint_profile=ConstraintProfile(hard_rules=(), soft_weights={}),
    )


def test_build_schedule_report_contains_summary_score_and_conflicts():
    data = make_report_input()
    result = ScheduleResult(
        assignments=(
            ScheduledExam("e1", "r1", "s1", ("t1",)),
            ScheduledExam("e2", "r2", "s2", ("t1", "t2")),
        ),
        conflicts=(
            ConflictRecord(
                type="student_group_clash",
                severity=ConflictSeverity.ERROR,
                affected_ids=("g1",),
                message="学生群体冲突",
                suggestion="调整时间段",
            ),
        ),
        score=ScoreBreakdown(
            total_score=75,
            hard_violation_count=1,
            soft_penalty_items=(
                SoftPenaltyItem(
                    rule="room_utilization",
                    penalty=30,
                    message="考场利用率偏低",
                ),
            ),
            normalized_score=75.0,
            total_raw_penalty=1,
            total_weighted_penalty=30,
            normalized_penalty_items=(
                NormalizedPenaltyItem(
                    rule="room_utilization",
                    violation_count=1,
                    weight=30,
                    raw_penalty=1,
                    weighted_penalty=30,
                    opportunity_count=4,
                    normalized_penalty=0.25,
                ),
            ),
        ),
        statistics=SolverStatistics(
            status=SolveStatus.PARTIAL,
            elapsed_ms=1250,
            exam_count=2,
            room_count=2,
            slot_count=2,
            attempted_assignments=8,
        ),
    )

    report = build_schedule_report(data, result)

    assert report["summary"] == {
        "exam_count": 2,
        "scheduled_exam_count": 2,
        "conflict_count": 1,
        "status": "partial",
    }
    assert report["score"] == {
        "total_score": 75,
        "hard_violation_count": 1,
        "soft_penalty_items": [
            {
                "rule": "room_utilization",
                "penalty": 30,
                "message": "考场利用率偏低",
            }
        ],
        "scoring_contract_version": 1,
        "normalized_score": 75.0,
        "total_raw_penalty": 1,
        "total_weighted_penalty": 30,
        "normalized_penalty_items": [
            {
                "rule": "room_utilization",
                "violation_count": 1,
                "weight": 30,
                "raw_penalty": 1,
                "weighted_penalty": 30,
                "opportunity_count": 4,
                "normalized_penalty": 0.25,
            }
        ],
    }
    assert report["conflicts"] == [
        {
            "type": "student_group_clash",
            "severity": "error",
            "affected_ids": ["g1"],
            "message": "学生群体冲突",
            "suggestion": "调整时间段",
        }
    ]
    assert "reschedule" not in report


def test_build_schedule_report_contains_utilization_and_workload_summaries():
    data = make_report_input()
    result = ScheduleResult(
        assignments=(
            ScheduledExam("e1", "r1", "s1", ("t1",)),
            ScheduledExam("e2", "r2", "s2", ("t1", "t2")),
        ),
        conflicts=(),
        score=ScoreBreakdown(total_score=100, hard_violation_count=0),
        statistics=SolverStatistics(
            status=SolveStatus.FEASIBLE,
            elapsed_ms=500,
            exam_count=2,
            room_count=2,
            slot_count=2,
            attempted_assignments=4,
        ),
    )

    report = build_schedule_report(data, result)

    assert report["room_utilization"] == {
        "average_utilization": 0.5,
        "rooms": [
            {"room_id": "r1", "exam_count": 1, "average_utilization": 0.5},
            {"room_id": "r2", "exam_count": 1, "average_utilization": 0.5},
        ],
    }
    assert report["teacher_workload"] == {
        "average_assignments": 1.5,
        "teachers": [
            {"teacher_id": "t1", "assignment_count": 2},
            {"teacher_id": "t2", "assignment_count": 1},
        ],
    }


def test_build_schedule_report_returns_json_serializable_data():
    data = make_report_input()
    result = ScheduleResult(
        assignments=(),
        conflicts=(),
        score=ScoreBreakdown(total_score=100, hard_violation_count=0),
        statistics=SolverStatistics(
            status=SolveStatus.FEASIBLE,
            elapsed_ms=0,
            exam_count=2,
            room_count=2,
            slot_count=2,
            attempted_assignments=0,
        ),
    )

    report = build_schedule_report(data, result)

    json.dumps(report, ensure_ascii=False)


def test_build_schedule_report_contains_reschedule_summary():
    data = make_report_input()
    third_exam = ExamTask(
        id="e3",
        course_id="c3",
        student_group_ids=("g3",),
        expected_count=20,
        duration_minutes=120,
        required_room_type=RoomType.STANDARD,
    )
    data = replace(
        data,
        student_groups=data.student_groups
        + (StudentGroup("g3", "CS 2303", 20, "cs"),),
        courses=data.courses
        + (Course("c3", "Course 3", "cs", ExamType.WRITTEN),),
        exam_tasks=(
            data.exam_tasks[0],
            replace(data.exam_tasks[1], invigilator_count=2),
            third_exam,
        ),
        reschedule_context=RescheduleContext(
            baseline_assignments=(
                ScheduledExam("e1", "r1", "s1", ("t1",)),
                ScheduledExam("e2", "r2", "s2", ("t2", "t1")),
                ScheduledExam("e3", "r1", "s2", ("t1",)),
            ),
            movable_exam_task_ids=("e2", "e3"),
        ),
    )
    result = ScheduleResult(
        assignments=(
            ScheduledExam("e1", "r1", "s1", ("t1",)),
            ScheduledExam("e2", "r2", "s2", ("t1", "t2")),
            ScheduledExam("e3", "r2", "s1", ("t2",)),
        ),
        conflicts=(),
        score=ScoreBreakdown(total_score=90, hard_violation_count=0),
        statistics=SolverStatistics(
            status=SolveStatus.FEASIBLE,
            elapsed_ms=50,
            exam_count=3,
            room_count=2,
            slot_count=2,
            attempted_assignments=6,
        ),
    )

    report = build_schedule_report(data, result)

    assert report["reschedule"] == {
        "baseline_exam_count": 3,
        "frozen_exam_task_ids": ["e1"],
        "retained_exam_task_ids": ["e1", "e2"],
        "changed_exam_task_ids": ["e3"],
    }
