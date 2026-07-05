import random

from .models import (
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


DEFAULT_SEED = 20260705


def generate_small_dataset(seed: int = DEFAULT_SEED) -> ScheduleInput:
    rng = random.Random(seed)
    return _generate_dataset(
        rng=rng,
        group_count=rng.randint(3, 5),
        teacher_count=rng.randint(4, 6),
        room_count=rng.randint(4, 6),
        slot_count=rng.randint(4, 6),
        exam_count=rng.randint(6, 10),
        group_size_range=(24, 45),
        room_capacity_range=(48, 90),
        time_limit_seconds=10,
    )


def generate_medium_dataset(seed: int = DEFAULT_SEED) -> ScheduleInput:
    rng = random.Random(seed)
    return _generate_dataset(
        rng=rng,
        group_count=rng.randint(15, 30),
        teacher_count=rng.randint(20, 40),
        room_count=rng.randint(10, 20),
        slot_count=rng.randint(10, 20),
        exam_count=rng.randint(30, 80),
        group_size_range=(24, 80),
        room_capacity_range=(70, 140),
        time_limit_seconds=30,
    )


def generate_conflict_capacity_dataset() -> ScheduleInput:
    student_groups = (
        StudentGroup(id="g001", name="Group 001", size=120, department_id="cs"),
    )
    teachers = (Teacher(id="t001", name="Teacher 001", department_id="cs"),)
    courses = (
        Course(
            id="c001",
            name="Course 001",
            department_id="cs",
            exam_type=ExamType.WRITTEN,
        ),
    )
    rooms = (
        Room(
            id="r001",
            name="Room 001",
            building_id="b001",
            capacity=40,
            room_type=RoomType.STANDARD,
        ),
        Room(
            id="r002",
            name="Room 002",
            building_id="b001",
            capacity=60,
            room_type=RoomType.STANDARD,
        ),
    )
    time_slots = _build_time_slots(2)
    exam_tasks = (
        ExamTask(
            id="e001",
            course_id="c001",
            student_group_ids=("g001",),
            expected_count=120,
            duration_minutes=120,
            required_room_type=RoomType.STANDARD,
            allowed_slot_ids=("s001", "s002"),
            invigilator_count=1,
        ),
    )
    return ScheduleInput(
        student_groups=student_groups,
        teachers=teachers,
        courses=courses,
        rooms=rooms,
        time_slots=time_slots,
        exam_tasks=exam_tasks,
        constraint_profile=_default_constraint_profile(),
    )


def generate_conflict_slot_pressure_dataset() -> ScheduleInput:
    student_groups = (
        StudentGroup(id="g001", name="Group 001", size=35, department_id="cs"),
    )
    teachers = tuple(
        Teacher(id=f"t{index:03d}", name=f"Teacher {index:03d}", department_id="cs")
        for index in range(1, 4)
    )
    courses = tuple(
        Course(
            id=f"c{index:03d}",
            name=f"Course {index:03d}",
            department_id="cs",
            exam_type=ExamType.WRITTEN,
        )
        for index in range(1, 4)
    )
    rooms = (
        Room(
            id="r001",
            name="Room 001",
            building_id="b001",
            capacity=60,
            room_type=RoomType.STANDARD,
        ),
    )
    time_slots = _build_time_slots(2)
    exam_tasks = tuple(
        ExamTask(
            id=f"e{index:03d}",
            course_id=f"c{index:03d}",
            student_group_ids=("g001",),
            expected_count=35,
            duration_minutes=120,
            required_room_type=RoomType.STANDARD,
            allowed_slot_ids=("s001", "s002"),
            invigilator_count=1,
        )
        for index in range(1, 4)
    )
    return ScheduleInput(
        student_groups=student_groups,
        teachers=teachers,
        courses=courses,
        rooms=rooms,
        time_slots=time_slots,
        exam_tasks=exam_tasks,
        constraint_profile=_default_constraint_profile(),
    )


def generate_conflict_equipment_dataset() -> ScheduleInput:
    student_groups = (
        StudentGroup(id="g001", name="Group 001", size=35, department_id="cs"),
    )
    teachers = (Teacher(id="t001", name="Teacher 001", department_id="cs"),)
    courses = (
        Course(
            id="c001",
            name="Course 001",
            department_id="cs",
            exam_type=ExamType.COMPUTER,
        ),
    )
    rooms = (
        Room(
            id="r001",
            name="Room 001",
            building_id="b001",
            capacity=60,
            room_type=RoomType.COMPUTER_LAB,
            equipment_tags=("projector",),
        ),
        Room(
            id="r002",
            name="Room 002",
            building_id="b001",
            capacity=80,
            room_type=RoomType.STANDARD,
            equipment_tags=("audio",),
        ),
    )
    time_slots = _build_time_slots(2)
    exam_tasks = (
        ExamTask(
            id="e001",
            course_id="c001",
            student_group_ids=("g001",),
            expected_count=35,
            duration_minutes=120,
            required_room_type=RoomType.COMPUTER_LAB,
            required_equipment_tags=("lab_pc",),
            allowed_slot_ids=("s001", "s002"),
            invigilator_count=1,
        ),
    )
    return ScheduleInput(
        student_groups=student_groups,
        teachers=teachers,
        courses=courses,
        rooms=rooms,
        time_slots=time_slots,
        exam_tasks=exam_tasks,
        constraint_profile=_default_constraint_profile(),
    )


def _generate_dataset(
    *,
    rng: random.Random,
    group_count: int,
    teacher_count: int,
    room_count: int,
    slot_count: int,
    exam_count: int,
    group_size_range: tuple[int, int],
    room_capacity_range: tuple[int, int],
    time_limit_seconds: int,
) -> ScheduleInput:
    departments = ("cs", "math", "physics", "english")
    student_groups = tuple(
        StudentGroup(
            id=f"g{index:03d}",
            name=f"Group {index:03d}",
            size=rng.randint(*group_size_range),
            department_id=rng.choice(departments),
        )
        for index in range(1, group_count + 1)
    )
    teachers = _build_teachers(rng, teacher_count, departments, slot_count)
    courses = _build_courses(rng, exam_count, departments)
    rooms = _build_rooms(rng, room_count, room_capacity_range)
    time_slots = _build_time_slots(slot_count)
    slot_ids = tuple(slot.id for slot in time_slots)
    exam_tasks = tuple(
        _build_exam_task(rng, index, courses[index - 1], student_groups, slot_ids)
        for index in range(1, exam_count + 1)
    )

    return ScheduleInput(
        student_groups=student_groups,
        teachers=teachers,
        courses=courses,
        rooms=rooms,
        time_slots=time_slots,
        exam_tasks=exam_tasks,
        constraint_profile=_default_constraint_profile(time_limit_seconds),
    )


def _build_teachers(
    rng: random.Random,
    teacher_count: int,
    departments: tuple[str, ...],
    slot_count: int,
) -> tuple[Teacher, ...]:
    slot_ids = tuple(f"s{index:03d}" for index in range(1, slot_count + 1))
    teachers: list[Teacher] = []
    for index in range(1, teacher_count + 1):
        unavailable_count = rng.randint(0, min(2, slot_count))
        teachers.append(
            Teacher(
                id=f"t{index:03d}",
                name=f"Teacher {index:03d}",
                department_id=rng.choice(departments),
                unavailable_slot_ids=tuple(sorted(rng.sample(slot_ids, unavailable_count))),
            )
        )
    return tuple(teachers)


def _build_courses(
    rng: random.Random,
    course_count: int,
    departments: tuple[str, ...],
) -> tuple[Course, ...]:
    exam_types = (ExamType.WRITTEN, ExamType.COMPUTER, ExamType.ORAL)
    return tuple(
        Course(
            id=f"c{index:03d}",
            name=f"Course {index:03d}",
            department_id=rng.choice(departments),
            exam_type=rng.choice(exam_types),
        )
        for index in range(1, course_count + 1)
    )


def _build_rooms(
    rng: random.Random,
    room_count: int,
    capacity_range: tuple[int, int],
) -> tuple[Room, ...]:
    rooms: list[Room] = []
    room_types = (RoomType.STANDARD, RoomType.COMPUTER_LAB, RoomType.LANGUAGE_LAB)
    for index in range(1, room_count + 1):
        room_type = RoomType.STANDARD if index == 1 else rng.choice(room_types)
        if index == 2:
            room_type = RoomType.COMPUTER_LAB
        rooms.append(
            Room(
                id=f"r{index:03d}",
                name=f"Room {index:03d}",
                building_id=f"b{((index - 1) % 3) + 1:03d}",
                capacity=rng.randint(*capacity_range),
                room_type=room_type,
                equipment_tags=_equipment_for_room_type(room_type),
            )
        )
    return tuple(rooms)


def _build_time_slots(slot_count: int) -> tuple[TimeSlot, ...]:
    periods = (("09:00", "11:00"), ("14:00", "16:00"))
    return tuple(
        TimeSlot(
            id=f"s{index:03d}",
            date=f"2026-07-{((index - 1) // 2) + 10:02d}",
            start_time=periods[(index - 1) % len(periods)][0],
            end_time=periods[(index - 1) % len(periods)][1],
            period_index=index - 1,
        )
        for index in range(1, slot_count + 1)
    )


def _build_exam_task(
    rng: random.Random,
    index: int,
    course: Course,
    student_groups: tuple[StudentGroup, ...],
    slot_ids: tuple[str, ...],
) -> ExamTask:
    group = rng.choice(student_groups)
    allowed_slot_count = rng.randint(1, len(slot_ids))
    allowed_slot_ids = tuple(sorted(rng.sample(slot_ids, allowed_slot_count)))
    room_type = _room_type_for_exam_type(course.exam_type)
    return ExamTask(
        id=f"e{index:03d}",
        course_id=course.id,
        student_group_ids=(group.id,),
        expected_count=group.size,
        duration_minutes=120,
        required_room_type=room_type,
        required_equipment_tags=_equipment_for_exam_type(course.exam_type),
        allowed_slot_ids=allowed_slot_ids,
        invigilator_count=1 if group.size <= 60 else 2,
    )


def _room_type_for_exam_type(exam_type: ExamType) -> RoomType:
    if exam_type == ExamType.COMPUTER:
        return RoomType.COMPUTER_LAB
    if exam_type == ExamType.ORAL:
        return RoomType.LANGUAGE_LAB
    return RoomType.STANDARD


def _equipment_for_exam_type(exam_type: ExamType) -> tuple[str, ...]:
    if exam_type == ExamType.COMPUTER:
        return ("lab_pc",)
    if exam_type == ExamType.ORAL:
        return ("audio",)
    return ()


def _equipment_for_room_type(room_type: RoomType) -> tuple[str, ...]:
    if room_type == RoomType.COMPUTER_LAB:
        return ("lab_pc", "projector")
    if room_type == RoomType.LANGUAGE_LAB:
        return ("audio", "recorder")
    return ("projector",)


def _default_constraint_profile(time_limit_seconds: int = 30) -> ConstraintProfile:
    return ConstraintProfile(
        hard_rules=(
            "exam_single_room_slot",
            "room_time_unique",
            "student_group_no_overlap",
            "room_capacity",
            "room_requirement",
            "allowed_slot",
            "teacher_unavailable",
            "teacher_time_unique",
        ),
        soft_weights={
            "student_consecutive_exam": 80,
            "teacher_workload_balance": 70,
            "room_utilization": 30,
            "exam_distribution_balance": 50,
        },
        time_limit_seconds=time_limit_seconds,
    )
