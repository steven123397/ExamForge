import type {
  PublishedScheduleAudienceResponse,
  PublishedScheduleNotificationsResponse,
  PublishedScheduleResponse,
  PublicPublishedScheduleNotificationsResponse,
  PublicPublishedScheduleResponse,
  ReferenceDataResponse,
} from "@examforge/shared";
import {
  publicPublishedScheduleNotificationsSchema,
  publicPublishedScheduleSchema,
} from "@examforge/shared";

export function buildPublicPublishedSchedule(
  referenceData: ReferenceDataResponse,
  published: PublishedScheduleResponse,
): PublicPublishedScheduleResponse {
  const { scheduleInput } = referenceData;
  const courses = new Map(scheduleInput.courses.map((course) => [course.id, course]));
  const groups = new Map(scheduleInput.student_groups.map((group) => [group.id, group]));
  const rooms = new Map(scheduleInput.rooms.map((room) => [room.id, room]));
  const slots = new Map(scheduleInput.time_slots.map((slot) => [slot.id, slot]));
  const tasks = new Map(scheduleInput.exam_tasks.map((task) => [task.id, task]));
  const entries = published.result.assignments
    .map((assignment) => {
      const task = tasks.get(assignment.exam_task_id);
      const slot = slots.get(assignment.time_slot_id);
      return {
        taskId: assignment.exam_task_id,
        entry: {
          courseName: task ? toPublicText(courses.get(task.course_id)?.name) : null,
          studentGroupNames: task
            ? task.student_group_ids
              .map((groupId) => toPublicText(groups.get(groupId)?.name))
              .filter((name): name is string => name !== null)
              .sort((left, right) => left.localeCompare(right))
            : [],
          roomName: toPublicText(rooms.get(assignment.room_id)?.name),
          date: toPublicText(slot?.date),
          startTime: toPublicText(slot?.start_time),
          endTime: toPublicText(slot?.end_time),
        },
      };
    })
    .sort((left, right) => (
      (left.entry.date ?? "").localeCompare(right.entry.date ?? "")
      || (left.entry.startTime ?? "").localeCompare(right.entry.startTime ?? "")
      || (left.entry.courseName ?? "").localeCompare(right.entry.courseName ?? "")
      || left.taskId.localeCompare(right.taskId)
    ))
    .map(({ entry }) => entry);

  return publicPublishedScheduleSchema.parse({
    contractVersion: 1,
    batch: toPublicBatch(published),
    entries,
  });
}

export function buildPublicPublishedScheduleNotifications(
  referenceData: ReferenceDataResponse,
  published: PublishedScheduleResponse,
): PublicPublishedScheduleNotificationsResponse {
  const groups = new Map(referenceData.scheduleInput.student_groups.map((group) => [group.id, group]));
  const tasks = new Map(referenceData.scheduleInput.exam_tasks.map((task) => [task.id, task]));
  const counts = new Map<string, { name: string; assignmentCount: number }>();
  for (const assignment of published.result.assignments) {
    const task = tasks.get(assignment.exam_task_id);
    for (const groupId of task?.student_group_ids ?? []) {
      const group = groups.get(groupId);
      const groupName = toPublicText(group?.name);
      if (!groupName) {
        continue;
      }
      const count = counts.get(groupId);
      counts.set(groupId, {
        name: groupName,
        assignmentCount: (count?.assignmentCount ?? 0) + 1,
      });
    }
  }
  return publicPublishedScheduleNotificationsSchema.parse({
    contractVersion: 1,
    batch: toPublicBatch(published),
    notifications: [...counts.entries()]
      .sort(([leftId, left], [rightId, right]) => (
        left.name.localeCompare(right.name) || leftId.localeCompare(rightId)
      ))
      .map(([, notification]) => ({
        studentGroupName: notification.name,
        assignmentCount: notification.assignmentCount,
        message: `${notification.name} 的 ${notification.assignmentCount} 场考试安排已发布，请及时查看最新考试时间和考场。`,
      })),
  });
}

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

function toPublicBatch(published: PublishedScheduleResponse) {
  return {
    name: published.batch.name,
    startDate: published.batch.startDate,
    endDate: published.batch.endDate,
  };
}

function toPublicText(value: string | undefined) {
  return value?.trim() ? value : null;
}

function csvCell(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
