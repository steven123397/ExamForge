from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StudentGroupModel(ContractModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    size: int = Field(gt=0)
    department_id: str = Field(min_length=1)


class TeacherModel(ContractModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    department_id: str = Field(min_length=1)
    unavailable_slot_ids: list[str] = Field(default_factory=list)


class CourseModel(ContractModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    department_id: str = Field(min_length=1)
    exam_type: Literal["written", "computer", "oral"]


class RoomModel(ContractModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    building_id: str = Field(min_length=1)
    capacity: int = Field(gt=0)
    room_type: Literal["standard", "computer_lab", "language_lab"]
    equipment_tags: list[str] = Field(default_factory=list)


class TimeSlotModel(ContractModel):
    id: str = Field(min_length=1)
    date: str = Field(min_length=1)
    start_time: str = Field(min_length=1)
    end_time: str = Field(min_length=1)
    period_index: int = Field(ge=0)


class ExamTaskModel(ContractModel):
    id: str = Field(min_length=1)
    course_id: str = Field(min_length=1)
    student_group_ids: list[str] = Field(min_length=1)
    expected_count: int = Field(gt=0)
    duration_minutes: int = Field(gt=0)
    required_room_type: Literal["standard", "computer_lab", "language_lab"]
    required_equipment_tags: list[str] = Field(default_factory=list)
    allowed_slot_ids: list[str] = Field(default_factory=list)
    invigilator_count: int = Field(gt=0)


class ConstraintProfileModel(ContractModel):
    hard_rules: list[str]
    soft_weights: dict[str, int]
    time_limit_seconds: int = Field(gt=0)


class AssignmentModel(ContractModel):
    exam_task_id: str = Field(min_length=1)
    room_id: str = Field(min_length=1)
    time_slot_id: str = Field(min_length=1)
    teacher_ids: list[str] = Field(default_factory=list)


class RescheduleContextModel(ContractModel):
    baseline_assignments: list[AssignmentModel] = Field(min_length=1)
    movable_exam_task_ids: list[str] = Field(default_factory=list)


class OverlapSampleParticipantModel(ContractModel):
    student_id: str = Field(min_length=1)
    exam_a_source: Literal["regular", "elective", "retake", "other"]
    exam_b_source: Literal["regular", "elective", "retake", "other"]


class StudentOverlapEdgeModel(ContractModel):
    exam_task_id_a: str = Field(min_length=1)
    exam_task_id_b: str = Field(min_length=1)
    overlap_count: int = Field(gt=0)
    sample_participants: list[OverlapSampleParticipantModel] = Field(
        default_factory=list,
        max_length=5,
    )


class ScheduleInputModel(ContractModel):
    student_groups: list[StudentGroupModel]
    teachers: list[TeacherModel]
    courses: list[CourseModel]
    rooms: list[RoomModel]
    time_slots: list[TimeSlotModel]
    exam_tasks: list[ExamTaskModel]
    constraint_profile: ConstraintProfileModel
    fixed_assignments: list[AssignmentModel] = Field(default_factory=list)
    reschedule_context: RescheduleContextModel | None = None
    participant_mode: Literal["groups_only", "enrollments"] = "groups_only"
    student_overlap_edges: list[StudentOverlapEdgeModel] = Field(default_factory=list)


class ConflictRecordModel(ContractModel):
    type: str
    severity: Literal["error", "warning"]
    affected_ids: list[str]
    message: str
    suggestion: str


class SoftPenaltyItemModel(ContractModel):
    rule: str
    penalty: int = Field(ge=0)
    message: str


class NormalizedPenaltyItemModel(ContractModel):
    rule: str = Field(min_length=1)
    violation_count: int = Field(ge=0)
    weight: int = Field(gt=0)
    raw_penalty: int = Field(ge=0)
    weighted_penalty: int = Field(ge=0)
    opportunity_count: int = Field(ge=0)
    normalized_penalty: float = Field(ge=0, le=1)


class ScoreBreakdownModel(ContractModel):
    total_score: int = Field(ge=0)
    hard_violation_count: int = Field(ge=0)
    soft_penalty_items: list[SoftPenaltyItemModel]
    scoring_contract_version: Literal[1] = 1
    normalized_score: float = Field(default=100.0, ge=0, le=100)
    total_raw_penalty: int = Field(default=0, ge=0)
    total_weighted_penalty: int = Field(default=0, ge=0)
    normalized_penalty_items: list[NormalizedPenaltyItemModel] = Field(default_factory=list)


class ScheduleDiagnosticModel(ContractModel):
    code: Literal[
        "room_capacity_shortage",
        "time_slot_shortage",
        "teacher_shortage",
        "fixed_assignment_conflict",
        "student_group_slot_conflict",
        "invalid_reference",
        "solver_infeasible",
        "unclassified_conflict",
        "participant_mode_invalid",
        "participant_data_incomplete",
        "participant_snapshot_stale",
        "expected_count_exceeds_group_size",
        "expected_count_lower_than_group_size",
        "expected_count_mismatch",
        "student_enrollment_reference_invalid",
        "student_overlap_edge_invalid",
        "student_exam_clash",
    ]
    severity: Literal["error", "warning"]
    resource_dimension: Literal[
        "room",
        "time_slot",
        "teacher",
        "fixed_assignment",
        "student_group",
        "input",
        "solver",
        "participant_data",
        "student",
        "exam_task",
    ]
    affected_ids: list[str]
    shortfall: int = Field(ge=0)
    message: str
    suggestion: str

    @model_validator(mode="after")
    def validate_participant_diagnostic_contract(self):
        if self.code == "student_exam_clash":
            if (
                self.severity != "error"
                or self.resource_dimension != "student"
                or len(self.affected_ids) != 3
                or self.affected_ids[0] >= self.affected_ids[1]
            ):
                raise ValueError(
                    "student_exam_clash requires error/student and "
                    "(exam_task_id_a, exam_task_id_b, time_slot_id)"
                )
        elif self.code == "student_overlap_edge_invalid":
            if self.severity != "error" or self.resource_dimension != "input":
                raise ValueError("student_overlap_edge_invalid is an input error")
        elif self.code == "participant_snapshot_stale":
            if (
                self.severity != "error"
                or self.resource_dimension != "participant_data"
            ):
                raise ValueError(
                    "participant_snapshot_stale is a participant-data error"
                )
        return self


class SolverStatisticsModel(ContractModel):
    status: Literal["feasible", "partial", "infeasible", "error"]
    elapsed_ms: int = Field(ge=0)
    exam_count: int = Field(ge=0)
    room_count: int = Field(ge=0)
    slot_count: int = Field(ge=0)
    attempted_assignments: int = Field(ge=0)


class ScheduleResultModel(ContractModel):
    assignments: list[AssignmentModel]
    conflicts: list[ConflictRecordModel]
    score: ScoreBreakdownModel
    statistics: SolverStatisticsModel
    diagnostics: list[ScheduleDiagnosticModel] = Field(default_factory=list)
    report: dict[str, Any] | None = None


class ServiceStatusModel(ContractModel):
    ok: Literal[True]
    service: Literal["examforge-scheduler"]
    version: str


class ErrorDetailModel(ContractModel):
    category: Literal["validation", "internal"]
    code: str
    message: str
    retryable: bool


class ErrorResponseModel(ContractModel):
    error: ErrorDetailModel
    request_id: str
    issues: list[Any] | None = None
