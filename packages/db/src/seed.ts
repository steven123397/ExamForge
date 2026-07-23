import { demoBatch, demoScheduleInput } from "@examforge/shared";
import { pathToFileURL } from "node:url";
import { eq, sql } from "drizzle-orm";
import { createDbClient, type ExamForgeDbClient } from "./client.js";
import {
  courses,
  departments,
  examTaskStudentGroups,
  examTasks,
  rooms,
  studentGroups,
  teacherUnavailableSlots,
  teachers,
  timeSlots,
  users,
  userStudentGroupScopes,
  userTeacherScopes,
} from "./schema.js";

const departmentNames: Record<string, string> = {
  cs: "计算机学院",
  math: "数学学院",
  english: "外国语学院",
};

function collectDepartments() {
  const ids = new Set<string>();
  for (const group of demoScheduleInput.student_groups) ids.add(group.department_id);
  for (const teacher of demoScheduleInput.teachers) ids.add(teacher.department_id);
  for (const course of demoScheduleInput.courses) ids.add(course.department_id);

  return Array.from(ids).map((id) => ({
    id,
    name: departmentNames[id] ?? id,
  }));
}

export async function seedDemoData(client: ExamForgeDbClient): Promise<void> {
  await client.db.transaction(async (tx) => {
    await tx.insert(departments).values(collectDepartments()).onConflictDoNothing();

    await tx.execute(sql`
      INSERT INTO exam_batches (
        id, name, status, start_date, end_date, constraint_profile
      ) VALUES (
        ${demoBatch.id},
        ${demoBatch.name},
        ${demoBatch.status},
        ${demoBatch.startDate},
        ${demoBatch.endDate},
        ${JSON.stringify(demoScheduleInput.constraint_profile)}::jsonb
      )
      ON CONFLICT (id) DO NOTHING
    `);

    await tx
      .insert(studentGroups)
      .values(
        demoScheduleInput.student_groups.map((group) => ({
          id: group.id,
          name: group.name,
          size: group.size,
          departmentId: group.department_id,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(teachers)
      .values(
        demoScheduleInput.teachers.map((teacher) => ({
          id: teacher.id,
          name: teacher.name,
          departmentId: teacher.department_id,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(courses)
      .values(
        demoScheduleInput.courses.map((course) => ({
          id: course.id,
          name: course.name,
          departmentId: course.department_id,
          type: course.exam_type,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(rooms)
      .values(
        demoScheduleInput.rooms.map((room) => ({
          id: room.id,
          name: room.name,
          buildingId: room.building_id,
          capacity: room.capacity,
          type: room.room_type,
          equipmentTags: room.equipment_tags,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(timeSlots)
      .values(
        demoScheduleInput.time_slots.map((slot) => ({
          id: slot.id,
          batchId: demoBatch.id,
          date: slot.date,
          startTime: slot.start_time,
          endTime: slot.end_time,
          periodIndex: slot.period_index,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(examTasks)
      .values(
        demoScheduleInput.exam_tasks.map((task) => ({
          id: task.id,
          batchId: demoBatch.id,
          courseId: task.course_id,
          expectedCount: task.expected_count,
          durationMinutes: task.duration_minutes,
          requiredRoomType: task.required_room_type,
          requiredEquipmentTags: task.required_equipment_tags,
          allowedSlotIds: task.allowed_slot_ids,
          invigilatorCount: task.invigilator_count,
        })),
      )
      .onConflictDoNothing();

    const examTaskStudentGroupRows = demoScheduleInput.exam_tasks.flatMap((task) => (
      task.student_group_ids.map((studentGroupId) => ({
        examTaskId: task.id,
        studentGroupId,
      }))
    ));
    if (examTaskStudentGroupRows.length > 0) {
      await tx
        .insert(examTaskStudentGroups)
        .values(examTaskStudentGroupRows)
        .onConflictDoNothing();
    }

    const teacherUnavailableSlotRows = demoScheduleInput.teachers.flatMap((teacher) => (
      teacher.unavailable_slot_ids.map((timeSlotId) => ({
        teacherId: teacher.id,
        timeSlotId,
      }))
    ));
    if (teacherUnavailableSlotRows.length > 0) {
      await tx
        .insert(teacherUnavailableSlots)
        .values(teacherUnavailableSlotRows)
        .onConflictDoNothing();
    }

    const teacherUsers = await tx.select({ id: users.id })
      .from(users)
      .where(eq(users.username, "teacher"))
      .limit(1);
    if (teacherUsers[0]) {
      await tx.insert(userTeacherScopes).values({
        userId: teacherUsers[0].id,
        teacherId: "t-zhang",
      }).onConflictDoNothing();
    }

    const studentUsers = await tx.select({ id: users.id })
      .from(users)
      .where(eq(users.username, "student"))
      .limit(1);
    if (studentUsers[0]) {
      await tx.insert(userStudentGroupScopes).values({
        userId: studentUsers[0].id,
        studentGroupId: "g-cs-2301",
      }).onConflictDoNothing();
    }
  });
}

async function main() {
  const client = createDbClient();

  try {
    await seedDemoData(client);

    console.log(JSON.stringify({
      seeded: true,
      batchId: demoBatch.id,
      counts: {
        departments: collectDepartments().length,
        studentGroups: demoScheduleInput.student_groups.length,
        teachers: demoScheduleInput.teachers.length,
        courses: demoScheduleInput.courses.length,
        rooms: demoScheduleInput.rooms.length,
        timeSlots: demoScheduleInput.time_slots.length,
        examTasks: demoScheduleInput.exam_tasks.length,
      },
    }, null, 2));
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
