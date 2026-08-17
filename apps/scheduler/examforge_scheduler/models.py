from dataclasses import dataclass, field
from enum import StrEnum


class RoomType(StrEnum):
    STANDARD = "standard"
    COMPUTER_LAB = "computer_lab"
    LANGUAGE_LAB = "language_lab"


class ExamType(StrEnum):
    WRITTEN = "written"
    COMPUTER = "computer"
    ORAL = "oral"


class ConflictSeverity(StrEnum):
    ERROR = "error"
    WARNING = "warning"


class SolveStatus(StrEnum):
    FEASIBLE = "feasible"
    PARTIAL = "partial"
    INFEASIBLE = "infeasible"
    ERROR = "error"


class ParticipantMode(StrEnum):
    GROUPS_ONLY = "groups_only"
    ENROLLMENTS = "enrollments"


class EnrollmentSource(StrEnum):
    REGULAR = "regular"
    ELECTIVE = "elective"
    RETAKE = "retake"
    OTHER = "other"


MAX_OVERLAP_SAMPLE_PARTICIPANTS = 5


@dataclass(frozen=True)
class StudentGroup:
    id: str
    name: str
    size: int
    department_id: str


@dataclass(frozen=True)
class Teacher:
    id: str
    name: str
    department_id: str
    unavailable_slot_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class Course:
    id: str
    name: str
    department_id: str
    exam_type: ExamType


@dataclass(frozen=True)
class Room:
    id: str
    name: str
    building_id: str
    capacity: int
    room_type: RoomType
    equipment_tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class TimeSlot:
    id: str
    date: str
    start_time: str
    end_time: str
    period_index: int


@dataclass(frozen=True)
class ExamTask:
    id: str
    course_id: str
    student_group_ids: tuple[str, ...]
    expected_count: int
    duration_minutes: int
    required_room_type: RoomType
    required_equipment_tags: tuple[str, ...] = ()
    allowed_slot_ids: tuple[str, ...] = ()
    invigilator_count: int = 1


@dataclass(frozen=True)
class ConstraintProfile:
    hard_rules: tuple[str, ...]
    soft_weights: dict[str, int] = field(default_factory=dict)
    time_limit_seconds: int = 30


@dataclass(frozen=True)
class ScheduledExam:
    exam_task_id: str
    room_id: str
    time_slot_id: str
    teacher_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class RescheduleContext:
    baseline_assignments: tuple[ScheduledExam, ...]
    movable_exam_task_ids: tuple[str, ...]


@dataclass(frozen=True)
class FixedAssignment:
    exam_task_id: str
    room_id: str
    time_slot_id: str
    teacher_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class ConflictRecord:
    type: str
    severity: ConflictSeverity
    affected_ids: tuple[str, ...]
    message: str
    suggestion: str


@dataclass(frozen=True)
class SoftPenaltyItem:
    rule: str
    penalty: int
    message: str


@dataclass(frozen=True)
class NormalizedPenaltyItem:
    rule: str
    violation_count: int
    weight: int
    raw_penalty: int
    weighted_penalty: int
    opportunity_count: int
    normalized_penalty: float


@dataclass(frozen=True)
class ScoreBreakdown:
    total_score: int
    hard_violation_count: int
    soft_penalty_items: tuple[SoftPenaltyItem, ...] = ()
    scoring_contract_version: int = 1
    normalized_score: float = 100.0
    total_raw_penalty: int = 0
    total_weighted_penalty: int = 0
    normalized_penalty_items: tuple[NormalizedPenaltyItem, ...] = ()


@dataclass(frozen=True)
class ScheduleDiagnostic:
    code: str
    severity: ConflictSeverity
    resource_dimension: str
    affected_ids: tuple[str, ...]
    shortfall: int
    message: str
    suggestion: str


@dataclass(frozen=True)
class SolverStatistics:
    status: SolveStatus
    elapsed_ms: int
    exam_count: int
    room_count: int
    slot_count: int
    attempted_assignments: int


@dataclass(frozen=True)
class OverlapSampleParticipant:
    student_id: str
    exam_a_source: EnrollmentSource
    exam_b_source: EnrollmentSource


@dataclass(frozen=True)
class StudentOverlapEdge:
    exam_task_id_a: str
    exam_task_id_b: str
    overlap_count: int
    sample_participants: tuple[OverlapSampleParticipant, ...] = ()


@dataclass(frozen=True)
class ScheduleInput:
    student_groups: tuple[StudentGroup, ...]
    teachers: tuple[Teacher, ...]
    courses: tuple[Course, ...]
    rooms: tuple[Room, ...]
    time_slots: tuple[TimeSlot, ...]
    exam_tasks: tuple[ExamTask, ...]
    constraint_profile: ConstraintProfile
    fixed_assignments: tuple[FixedAssignment, ...] = ()
    reschedule_context: RescheduleContext | None = None
    participant_mode: ParticipantMode = ParticipantMode.GROUPS_ONLY
    student_overlap_edges: tuple[StudentOverlapEdge, ...] = ()


@dataclass(frozen=True)
class ScheduleResult:
    assignments: tuple[ScheduledExam, ...]
    conflicts: tuple[ConflictRecord, ...]
    score: ScoreBreakdown
    statistics: SolverStatistics
    diagnostics: tuple[ScheduleDiagnostic, ...] = ()


def validate_schedule_input(schedule_input: ScheduleInput) -> tuple[str, ...]:
    errors: list[str] = []

    student_group_ids = {group.id for group in schedule_input.student_groups}
    course_ids = {course.id for course in schedule_input.courses}
    teacher_ids = {teacher.id for teacher in schedule_input.teachers}
    room_ids = {room.id for room in schedule_input.rooms}
    slot_ids = {slot.id for slot in schedule_input.time_slots}
    task_ids = {task.id for task in schedule_input.exam_tasks}

    _validate_entity_ids(
        errors,
        "student_group",
        (group.id for group in schedule_input.student_groups),
    )
    _validate_entity_ids(
        errors,
        "teacher",
        (teacher.id for teacher in schedule_input.teachers),
    )
    _validate_entity_ids(
        errors,
        "course",
        (course.id for course in schedule_input.courses),
    )
    _validate_entity_ids(errors, "room", (room.id for room in schedule_input.rooms))
    _validate_entity_ids(
        errors,
        "time_slot",
        (slot.id for slot in schedule_input.time_slots),
    )
    _validate_entity_ids(
        errors,
        "exam_task",
        (task.id for task in schedule_input.exam_tasks),
    )

    for group in schedule_input.student_groups:
        if group.size <= 0:
            errors.append(f"student_group {group.id} size must be > 0")

    for room in schedule_input.rooms:
        if room.capacity <= 0:
            errors.append(f"room {room.id} capacity must be > 0")

    for slot in schedule_input.time_slots:
        if slot.period_index < 0:
            errors.append(f"time_slot {slot.id} period_index must be >= 0")

    for teacher in schedule_input.teachers:
        for slot_id in teacher.unavailable_slot_ids:
            if slot_id not in slot_ids:
                errors.append(
                    f"teacher {teacher.id} references missing unavailable_slot_id {slot_id}"
                )

    for task in schedule_input.exam_tasks:
        if task.expected_count <= 0:
            errors.append(f"exam_task {task.id} expected_count must be > 0")
        if task.duration_minutes <= 0:
            errors.append(f"exam_task {task.id} duration_minutes must be > 0")
        if not task.student_group_ids:
            errors.append(f"exam_task {task.id} student_group_ids must not be empty")
        if task.invigilator_count <= 0:
            errors.append(f"exam_task {task.id} invigilator_count must be > 0")
        if task.course_id not in course_ids:
            errors.append(
                f"exam_task {task.id} references missing course_id {task.course_id}"
            )

        for group_id in task.student_group_ids:
            if group_id not in student_group_ids:
                errors.append(
                    f"exam_task {task.id} references missing student_group_id {group_id}"
                )

        for slot_id in task.allowed_slot_ids:
            if slot_id not in slot_ids:
                errors.append(
                    f"exam_task {task.id} references missing allowed_slot_id {slot_id}"
                )

    fixed_task_ids: set[str] = set()
    for fixed_assignment in schedule_input.fixed_assignments:
        if fixed_assignment.exam_task_id in fixed_task_ids:
            errors.append(
                "fixed_assignment references duplicate exam_task_id "
                f"{fixed_assignment.exam_task_id}"
            )
        fixed_task_ids.add(fixed_assignment.exam_task_id)
        if fixed_assignment.exam_task_id not in task_ids:
            errors.append(
                "fixed_assignment references missing exam_task_id "
                f"{fixed_assignment.exam_task_id}"
            )
        if fixed_assignment.room_id not in room_ids:
            errors.append(
                f"fixed_assignment {fixed_assignment.exam_task_id} "
                f"references missing room_id {fixed_assignment.room_id}"
            )
        if fixed_assignment.time_slot_id not in slot_ids:
            errors.append(
                f"fixed_assignment {fixed_assignment.exam_task_id} "
                f"references missing time_slot_id {fixed_assignment.time_slot_id}"
            )
        for teacher_id in fixed_assignment.teacher_ids:
            if teacher_id not in teacher_ids:
                errors.append(
                    f"fixed_assignment {fixed_assignment.exam_task_id} "
                    f"references missing teacher_id {teacher_id}"
                )

    _validate_student_overlap_edges(errors, schedule_input, task_ids)

    if schedule_input.reschedule_context is not None:
        _validate_reschedule_context(
            errors,
            schedule_input,
            task_ids,
            room_ids,
            slot_ids,
            teacher_ids,
        )

    return tuple(errors)


def _validate_student_overlap_edges(
    errors: list[str],
    schedule_input: ScheduleInput,
    task_ids: set[str],
) -> None:
    """校验 exam-exam 重叠边的规范形式。

    第六版第一阶段只冻结边的合同，个体互斥约束在第二阶段实现。
    """
    if schedule_input.participant_mode is ParticipantMode.GROUPS_ONLY:
        if schedule_input.student_overlap_edges:
            errors.append(
                "participant_mode groups_only must not carry student_overlap_edges"
            )
        return

    previous_key: tuple[str, str] | None = None
    for edge in schedule_input.student_overlap_edges:
        key = (edge.exam_task_id_a, edge.exam_task_id_b)
        if edge.exam_task_id_a >= edge.exam_task_id_b:
            errors.append(
                "student_overlap_edge requires exam_task_id_a < exam_task_id_b, got "
                f"{edge.exam_task_id_a}/{edge.exam_task_id_b}"
            )
        if previous_key is not None and previous_key == key:
            errors.append(
                "student_overlap_edge references duplicate exam pair "
                f"{edge.exam_task_id_a}/{edge.exam_task_id_b}"
            )
        elif previous_key is not None and previous_key > key:
            errors.append(
                "student_overlap_edges must be sorted by (exam_task_id_a, exam_task_id_b)"
            )
        previous_key = key

        for exam_task_id in (edge.exam_task_id_a, edge.exam_task_id_b):
            if exam_task_id not in task_ids:
                errors.append(
                    "student_overlap_edge references missing exam_task_id "
                    f"{exam_task_id}"
                )

        if edge.overlap_count <= 0:
            errors.append(
                "student_overlap_edge "
                f"{edge.exam_task_id_a}/{edge.exam_task_id_b} overlap_count must be > 0"
            )

        if len(edge.sample_participants) > MAX_OVERLAP_SAMPLE_PARTICIPANTS:
            errors.append(
                "student_overlap_edge "
                f"{edge.exam_task_id_a}/{edge.exam_task_id_b} keeps at most "
                f"{MAX_OVERLAP_SAMPLE_PARTICIPANTS} sample_participants"
            )
        if len(edge.sample_participants) > edge.overlap_count:
            errors.append(
                "student_overlap_edge "
                f"{edge.exam_task_id_a}/{edge.exam_task_id_b} "
                "sample_participants cannot exceed overlap_count"
            )

        previous_student_id: str | None = None
        for participant in edge.sample_participants:
            if (
                previous_student_id is not None
                and previous_student_id >= participant.student_id
            ):
                errors.append(
                    "student_overlap_edge "
                    f"{edge.exam_task_id_a}/{edge.exam_task_id_b} "
                    "sample_participants must be sorted by student_id"
                )
            previous_student_id = participant.student_id


def _validate_reschedule_context(
    errors: list[str],
    schedule_input: ScheduleInput,
    task_ids: set[str],
    room_ids: set[str],
    slot_ids: set[str],
    teacher_ids: set[str],
) -> None:
    context = schedule_input.reschedule_context
    if context is None:
        return

    if not context.baseline_assignments:
        errors.append(
            "reschedule_context baseline_assignments must not be empty"
        )

    baseline_by_task_id: dict[str, ScheduledExam] = {}
    for assignment in context.baseline_assignments:
        if assignment.exam_task_id in baseline_by_task_id:
            errors.append(
                "reschedule_context baseline_assignments references duplicate "
                f"exam_task_id {assignment.exam_task_id}"
            )
        else:
            baseline_by_task_id[assignment.exam_task_id] = assignment

        if assignment.exam_task_id not in task_ids:
            errors.append(
                "reschedule_context baseline_assignment references missing "
                f"exam_task_id {assignment.exam_task_id}"
            )
        if assignment.room_id not in room_ids:
            errors.append(
                "reschedule_context baseline_assignment "
                f"{assignment.exam_task_id} references missing room_id "
                f"{assignment.room_id}"
            )
        if assignment.time_slot_id not in slot_ids:
            errors.append(
                "reschedule_context baseline_assignment "
                f"{assignment.exam_task_id} references missing time_slot_id "
                f"{assignment.time_slot_id}"
            )
        for teacher_id in assignment.teacher_ids:
            if teacher_id not in teacher_ids:
                errors.append(
                    "reschedule_context baseline_assignment "
                    f"{assignment.exam_task_id} references missing teacher_id "
                    f"{teacher_id}"
                )

    for task in schedule_input.exam_tasks:
        if task.id not in baseline_by_task_id:
            errors.append(
                "reschedule_context baseline_assignments missing exam_task_id "
                f"{task.id}"
            )

    movable_task_ids: set[str] = set()
    for task_id in context.movable_exam_task_ids:
        if task_id in movable_task_ids:
            errors.append(
                "reschedule_context movable_exam_task_ids contains duplicate "
                f"exam_task_id {task_id}"
            )
        movable_task_ids.add(task_id)
        if task_id not in baseline_by_task_id:
            errors.append(
                "reschedule_context movable_exam_task_ids references missing "
                f"baseline exam_task_id {task_id}"
            )

    for fixed_assignment in schedule_input.fixed_assignments:
        baseline_assignment = baseline_by_task_id.get(fixed_assignment.exam_task_id)
        if (
            baseline_assignment is None
            or fixed_assignment.exam_task_id in movable_task_ids
        ):
            continue

        conflicting_fields: list[str] = []
        if fixed_assignment.room_id != baseline_assignment.room_id:
            conflicting_fields.append("room_id")
        if fixed_assignment.time_slot_id != baseline_assignment.time_slot_id:
            conflicting_fields.append("time_slot_id")
        if fixed_assignment.teacher_ids and set(fixed_assignment.teacher_ids) != set(
            baseline_assignment.teacher_ids
        ):
            conflicting_fields.append("teacher_ids")
        if conflicting_fields:
            errors.append(
                f"reschedule_context frozen exam_task_id {fixed_assignment.exam_task_id} "
                "conflicts with fixed_assignment fields "
                f"{', '.join(conflicting_fields)}"
            )


def _validate_entity_ids(errors: list[str], entity_name: str, ids: object) -> None:
    for entity_id in ids:
        if not entity_id:
            errors.append(f"{entity_name} id must not be empty")
