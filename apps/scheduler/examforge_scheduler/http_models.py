from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


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


class ScoreBreakdownModel(ContractModel):
    total_score: int = Field(ge=0)
    hard_violation_count: int = Field(ge=0)
    soft_penalty_items: list[SoftPenaltyItemModel]


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
