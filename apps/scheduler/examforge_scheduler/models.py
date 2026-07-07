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
class ScoreBreakdown:
    total_score: int
    hard_violation_count: int
    soft_penalty_items: tuple[SoftPenaltyItem, ...] = ()


@dataclass(frozen=True)
class SolverStatistics:
    status: SolveStatus
    elapsed_ms: int
    exam_count: int
    room_count: int
    slot_count: int
    attempted_assignments: int


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


@dataclass(frozen=True)
class ScheduleResult:
    assignments: tuple[ScheduledExam, ...]
    conflicts: tuple[ConflictRecord, ...]
    score: ScoreBreakdown
    statistics: SolverStatistics


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

    return tuple(errors)


def _validate_entity_ids(errors: list[str], entity_name: str, ids: object) -> None:
    for entity_id in ids:
        if not entity_id:
            errors.append(f"{entity_name} id must not be empty")
