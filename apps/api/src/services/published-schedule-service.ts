import type {
  PublishedScheduleAudienceResponse,
  PublishedScheduleNotificationsResponse,
  PublishedScheduleResponse,
  ReferenceDataResponse,
} from "@examforge/shared";

export function buildPublishedScheduleAudience(
  referenceData: ReferenceDataResponse,
  published: PublishedScheduleResponse,
  viewerType: "teacher" | "student_group",
  viewerId: string,
): PublishedScheduleAudienceResponse | null {
  const { scheduleInput } = referenceData;
  const teachers = new Map(scheduleInput.teachers.map((teacher) => [teacher.id, teacher]));
  const groups = new Map(scheduleInput.student_groups.map((group) => [group.id, group]));
  const courses = new Map(scheduleInput.courses.map((course) => [course.id, course]));
  const rooms = new Map(scheduleInput.rooms.map((room) => [room.id, room]));
  const slots = new Map(scheduleInput.time_slots.map((slot) => [slot.id, slot]));
  const tasks = new Map(scheduleInput.exam_tasks.map((task) => [task.id, task]));

  const viewer = viewerType === "teacher"
    ? teachers.get(viewerId)
    : groups.get(viewerId);
  if (!viewer) {
    return null;
  }

  const assignments = published.result.assignments
    .filter((assignment) => {
      const task = tasks.get(assignment.exam_task_id);
      return viewerType === "teacher"
        ? assignment.teacher_ids.includes(viewerId)
        : task?.student_group_ids.includes(viewerId);
    })
    .map((assignment) => {
      const task = tasks.get(assignment.exam_task_id) ?? null;
      return {
        assignment,
        examTask: task,
        course: task ? courses.get(task.course_id) ?? null : null,
        studentGroups: task
          ? task.student_group_ids.map((id) => groups.get(id)).filter((item) => item !== undefined)
          : [],
        room: rooms.get(assignment.room_id) ?? null,
        timeSlot: slots.get(assignment.time_slot_id) ?? null,
        teachers: assignment.teacher_ids.map((id) => teachers.get(id)).filter((item) => item !== undefined),
      };
    });

  return {
    batch: published.batch,
    run: published.run,
    viewer: {
      type: viewerType,
      id: viewer.id,
      name: viewer.name,
    },
    assignments,
  };
}

export function buildPublishedScheduleNotifications(
  referenceData: ReferenceDataResponse,
  published: PublishedScheduleResponse,
): PublishedScheduleNotificationsResponse {
  const groups = new Map(referenceData.scheduleInput.student_groups.map((group) => [group.id, group]));
  const tasks = new Map(referenceData.scheduleInput.exam_tasks.map((task) => [task.id, task]));
  const counts = new Map<string, number>();
  for (const assignment of published.result.assignments) {
    const task = tasks.get(assignment.exam_task_id);
    for (const groupId of task?.student_group_ids ?? []) {
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
  }
  return {
    batch: published.batch,
    run: published.run,
    notifications: [...counts.entries()].map(([studentGroupId, assignmentCount]) => {
      const group = groups.get(studentGroupId);
      return {
        id: `notice-${published.run.id}-${studentGroupId}`,
        studentGroupId,
        studentGroupName: group?.name ?? studentGroupId,
        assignmentCount,
        message: `${group?.name ?? studentGroupId} 的 ${assignmentCount} 场考试安排已发布，请及时查看最新考试时间和考场。`,
      };
    }),
  };
}

export function buildPublishedScheduleCsv(
  referenceData: ReferenceDataResponse,
  published: PublishedScheduleResponse,
) {
  const courses = new Map(referenceData.scheduleInput.courses.map((course) => [course.id, course]));
  const rooms = new Map(referenceData.scheduleInput.rooms.map((room) => [room.id, room]));
  const slots = new Map(referenceData.scheduleInput.time_slots.map((slot) => [slot.id, slot]));
  const teachers = new Map(referenceData.scheduleInput.teachers.map((teacher) => [teacher.id, teacher]));
  const tasks = new Map(referenceData.scheduleInput.exam_tasks.map((task) => [task.id, task]));
  const rows = [["course", "time_slot", "room", "teachers"]];
  for (const assignment of published.result.assignments) {
    const task = tasks.get(assignment.exam_task_id);
    const slot = slots.get(assignment.time_slot_id);
    rows.push([
      csvCell(task ? courses.get(task.course_id)?.name ?? task.course_id : assignment.exam_task_id),
      csvCell(slot ? `${slot.date} ${slot.start_time}-${slot.end_time}` : assignment.time_slot_id),
      csvCell(rooms.get(assignment.room_id)?.name ?? assignment.room_id),
      csvCell(assignment.teacher_ids.map((id) => teachers.get(id)?.name ?? id).join("、")),
    ]);
  }
  return rows.map((row) => row.join(",")).join("\n");
}

function csvCell(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
