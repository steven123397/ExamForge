import type {
  Course,
  ExamTask,
  ReferenceDataResponse,
  ReferenceRecord,
  ReferenceResource,
  Room,
  StudentGroup,
  Teacher,
  TimeSlot,
} from "@examforge/shared";

export type EditableResource = ReferenceResource;
export type FormState = Record<string, string>;

export const referenceForms = {
  courses: {
    label: "课程",
    fields: [
      ["id", "编号"],
      ["name", "名称"],
      ["department_id", "院系"],
      ["exam_type", "考试类型"],
    ],
    defaults: {
      id: "c-new",
      name: "",
      department_id: "cs",
      exam_type: "written",
    },
  },
  "student-groups": {
    label: "学生群体",
    fields: [
      ["id", "编号"],
      ["name", "名称"],
      ["size", "人数"],
      ["department_id", "院系"],
    ],
    defaults: {
      id: "g-new",
      name: "",
      size: "60",
      department_id: "cs",
    },
  },
  teachers: {
    label: "教师",
    fields: [
      ["id", "编号"],
      ["name", "姓名"],
      ["department_id", "院系"],
      ["unavailable_slot_ids", "不可用时段"],
    ],
    defaults: {
      id: "t-new",
      name: "",
      department_id: "cs",
      unavailable_slot_ids: "",
    },
  },
  rooms: {
    label: "考场",
    fields: [
      ["id", "编号"],
      ["name", "名称"],
      ["building_id", "楼栋"],
      ["capacity", "容量"],
      ["room_type", "类型"],
      ["equipment_tags", "设备"],
    ],
    defaults: {
      id: "r-new",
      name: "",
      building_id: "main",
      capacity: "60",
      room_type: "standard",
      equipment_tags: "",
    },
  },
  "time-slots": {
    label: "时间段",
    fields: [
      ["id", "编号"],
      ["date", "日期"],
      ["start_time", "开始"],
      ["end_time", "结束"],
      ["period_index", "序号"],
    ],
    defaults: {
      id: "slot-new",
      date: "2026-06-21",
      start_time: "09:00",
      end_time: "11:00",
      period_index: "20",
    },
  },
  "exam-tasks": {
    label: "考试任务",
    fields: [
      ["id", "编号"],
      ["course_id", "课程"],
      ["student_group_ids", "学生群体"],
      ["expected_count", "人数"],
      ["duration_minutes", "时长"],
      ["required_room_type", "考场类型"],
      ["required_equipment_tags", "设备"],
      ["allowed_slot_ids", "允许时段"],
      ["invigilator_count", "监考数"],
    ],
    defaults: {
      id: "task-new",
      course_id: "c-data-structures",
      student_group_ids: "g-cs-2301",
      expected_count: "60",
      duration_minutes: "120",
      required_room_type: "standard",
      required_equipment_tags: "",
      allowed_slot_ids: "",
      invigilator_count: "2",
    },
  },
} as const;

export function getEditableRecords(
  referenceData: ReferenceDataResponse | null,
  resource: EditableResource,
): ReferenceRecord[] {
  if (!referenceData) {
    return [];
  }
  const collections = {
    "student-groups": referenceData.scheduleInput.student_groups,
    teachers: referenceData.scheduleInput.teachers,
    courses: referenceData.scheduleInput.courses,
    rooms: referenceData.scheduleInput.rooms,
    "time-slots": referenceData.scheduleInput.time_slots,
    "exam-tasks": referenceData.scheduleInput.exam_tasks,
  };
  return collections[resource];
}

export function recordToForm(resource: EditableResource, record: ReferenceRecord): FormState {
  if (resource === "student-groups") {
    const group = record as StudentGroup;
    return {
      id: group.id,
      name: group.name,
      size: String(group.size),
      department_id: group.department_id,
    };
  }
  if (resource === "courses") {
    const course = record as Course;
    return {
      id: course.id,
      name: course.name,
      department_id: course.department_id,
      exam_type: course.exam_type,
    };
  }
  if (resource === "teachers") {
    const teacher = record as Teacher;
    return {
      id: teacher.id,
      name: teacher.name,
      department_id: teacher.department_id,
      unavailable_slot_ids: teacher.unavailable_slot_ids.join(","),
    };
  }
  if (resource === "rooms") {
    const room = record as Room;
    return {
      id: room.id,
      name: room.name,
      building_id: room.building_id,
      capacity: String(room.capacity),
      room_type: room.room_type,
      equipment_tags: room.equipment_tags.join(","),
    };
  }
  if (resource === "time-slots") {
    const slot = record as TimeSlot;
    return {
      id: slot.id,
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
      period_index: String(slot.period_index),
    };
  }
  const task = record as ExamTask;
  return {
    id: task.id,
    course_id: task.course_id,
    student_group_ids: task.student_group_ids.join(","),
    expected_count: String(task.expected_count),
    duration_minutes: String(task.duration_minutes),
    required_room_type: task.required_room_type,
    required_equipment_tags: task.required_equipment_tags.join(","),
    allowed_slot_ids: task.allowed_slot_ids.join(","),
    invigilator_count: String(task.invigilator_count),
  };
}

export function formToPayload(resource: EditableResource, form: FormState): ReferenceRecord {
  if (resource === "student-groups") {
    return {
      id: form.id,
      name: form.name,
      size: Number(form.size),
      department_id: form.department_id,
    };
  }
  if (resource === "courses") {
    return {
      id: form.id,
      name: form.name,
      department_id: form.department_id,
      exam_type: form.exam_type as Course["exam_type"],
    };
  }
  if (resource === "teachers") {
    return {
      id: form.id,
      name: form.name,
      department_id: form.department_id,
      unavailable_slot_ids: splitList(form.unavailable_slot_ids),
    };
  }
  if (resource === "rooms") {
    return {
      id: form.id,
      name: form.name,
      building_id: form.building_id,
      capacity: Number(form.capacity),
      room_type: form.room_type as Room["room_type"],
      equipment_tags: splitList(form.equipment_tags),
    };
  }
  if (resource === "time-slots") {
    return {
      id: form.id,
      date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      period_index: Number(form.period_index),
    };
  }
  return {
    id: form.id,
    course_id: form.course_id,
    student_group_ids: splitList(form.student_group_ids),
    expected_count: Number(form.expected_count),
    duration_minutes: Number(form.duration_minutes),
    required_room_type: form.required_room_type as ExamTask["required_room_type"],
    required_equipment_tags: splitList(form.required_equipment_tags),
    allowed_slot_ids: splitList(form.allowed_slot_ids),
    invigilator_count: Number(form.invigilator_count),
  };
}

export function recordTitle(resource: EditableResource, record: ReferenceRecord) {
  if ("name" in record) {
    return record.name;
  }
  if (resource === "time-slots") {
    const slot = record as TimeSlot;
    return `${slot.date} ${slot.start_time}-${slot.end_time}`;
  }
  const task = record as ExamTask;
  return `${task.course_id} · ${task.expected_count} 人`;
}

export function sampleImportText(resource: EditableResource) {
  const samples: Record<EditableResource, ReferenceRecord[]> = {
    courses: [{
      id: "c-import",
      name: "导入课程",
      department_id: "cs",
      exam_type: "written",
    }],
    teachers: [{
      id: "t-import",
      name: "导入教师",
      department_id: "cs",
      unavailable_slot_ids: [],
    }],
    rooms: [{
      id: "r-import",
      name: "导入考场",
      building_id: "main",
      capacity: 80,
      room_type: "standard",
      equipment_tags: [],
    }],
    "student-groups": [{
      id: "g-import",
      name: "导入学生群体",
      size: 60,
      department_id: "cs",
    }],
    "time-slots": [{
      id: "slot-import",
      date: "2026-06-21",
      start_time: "09:00",
      end_time: "11:00",
      period_index: 20,
    }],
    "exam-tasks": [{
      id: "task-import",
      course_id: "c-data-structures",
      student_group_ids: ["g-cs-2301"],
      expected_count: 60,
      duration_minutes: 120,
      required_room_type: "standard",
      required_equipment_tags: [],
      allowed_slot_ids: [],
      invigilator_count: 2,
    }],
  };
  return JSON.stringify(samples[resource], null, 2);
}

export function omitId<T extends { id: string }>(value: T): Omit<T, "id"> {
  const { id: _id, ...rest } = value;
  return rest;
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
