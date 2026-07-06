import {
  auditEvents,
  conflictRecords,
  courses,
  examBatches,
  examTasks,
  rooms,
  scheduledExams,
  scheduleRuns,
  studentGroups,
  teachers,
  timeSlots,
  type ExamForgeDbClient,
} from "@examforge/db";
import {
  type ConstraintProfile,
  type AuditEventListResponse,
  type AuditEventSummary,
  type DashboardResponse,
  type PublishedScheduleResponse,
  type ReferenceRecord,
  type ReferenceDataResponse,
  type ReferenceResource,
  type ScheduleRunComparisonResponse,
  type ScheduleRunListResponse,
  type ScheduleRollbackResponse,
  type ScheduleResult,
  type ScheduleRunResponse,
  type ScheduleRunSummary,
} from "@examforge/shared";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { buildRunComparison, type PlatformRepository } from "./repository.js";

type BatchRow = typeof examBatches.$inferSelect;
type RunRow = typeof scheduleRuns.$inferSelect;
type AuditEventRow = typeof auditEvents.$inferSelect;
type StudentGroupRow = typeof studentGroups.$inferSelect;
type TeacherRow = typeof teachers.$inferSelect;
type CourseRow = typeof courses.$inferSelect;
type RoomRow = typeof rooms.$inferSelect;
type TimeSlotRow = typeof timeSlots.$inferSelect;
type ExamTaskRow = typeof examTasks.$inferSelect;

export class PostgresPlatformRepository implements PlatformRepository {
  constructor(private readonly client: ExamForgeDbClient) {}

  async getDashboard(): Promise<DashboardResponse> {
    const referenceData = await this.getReferenceData();
    const latestRun = await this.getLatestRunSummary(referenceData.batch.id);

    return {
      batch: referenceData.batch,
      metrics: {
        examTaskCount: referenceData.scheduleInput.exam_tasks.length,
        teacherCount: referenceData.scheduleInput.teachers.length,
        roomCount: referenceData.scheduleInput.rooms.length,
        timeSlotCount: referenceData.scheduleInput.time_slots.length,
        conflictCount: latestRun?.conflictCount ?? 0,
        score: latestRun?.score ?? null,
      },
      latestRun,
    };
  }

  async getReferenceData(): Promise<ReferenceDataResponse> {
    const batch = await this.getActiveBatch();
    const [
      studentGroupRows,
      teacherRows,
      courseRows,
      roomRows,
      timeSlotRows,
      examTaskRows,
    ] = await Promise.all([
      this.client.db.select().from(studentGroups),
      this.client.db.select().from(teachers),
      this.client.db.select().from(courses),
      this.client.db.select().from(rooms),
      this.client.db.select().from(timeSlots).where(eq(timeSlots.batchId, batch.id)),
      this.client.db.select().from(examTasks).where(eq(examTasks.batchId, batch.id)),
    ]);

    return {
      batch: this.toBatchSummary(batch),
      scheduleInput: {
        student_groups: studentGroupRows.map((group) => ({
          id: group.id,
          name: group.name,
          size: group.size,
          department_id: group.departmentId,
        })),
        teachers: teacherRows.map((teacher) => ({
          id: teacher.id,
          name: teacher.name,
          department_id: teacher.departmentId,
          unavailable_slot_ids: teacher.unavailableSlotIds,
        })),
        courses: courseRows.map((course) => ({
          id: course.id,
          name: course.name,
          department_id: course.departmentId,
          exam_type: course.type,
        })),
        rooms: roomRows.map((room) => ({
          id: room.id,
          name: room.name,
          building_id: room.buildingId,
          capacity: room.capacity,
          room_type: room.type,
          equipment_tags: room.equipmentTags,
        })),
        time_slots: timeSlotRows.map((slot) => ({
          id: slot.id,
          date: slot.date,
          start_time: slot.startTime,
          end_time: slot.endTime,
          period_index: slot.periodIndex,
        })),
        exam_tasks: examTaskRows.map((task) => ({
          id: task.id,
          course_id: task.courseId,
          student_group_ids: task.studentGroupIds,
          expected_count: task.expectedCount,
          duration_minutes: task.durationMinutes,
          required_room_type: task.requiredRoomType,
          required_equipment_tags: task.requiredEquipmentTags,
          allowed_slot_ids: task.allowedSlotIds,
          invigilator_count: task.invigilatorCount,
        })),
        constraint_profile: batch.constraintProfile as ConstraintProfile,
      },
    };
  }

  async createReferenceRecord(
    resource: ReferenceResource,
    record: ReferenceRecord,
  ): Promise<ReferenceRecord> {
    const batch = await this.getActiveBatch();
    const data = record as Record<string, unknown>;

    switch (resource) {
      case "student-groups": {
        const [row] = await this.client.db.insert(studentGroups).values({
          id: data.id as string,
          name: data.name as string,
          size: data.size as number,
          departmentId: data.department_id as string,
        }).returning();
        return this.toStudentGroup(row);
      }
      case "teachers": {
        const [row] = await this.client.db.insert(teachers).values({
          id: data.id as string,
          name: data.name as string,
          departmentId: data.department_id as string,
          unavailableSlotIds: data.unavailable_slot_ids as string[],
        }).returning();
        return this.toTeacher(row);
      }
      case "courses": {
        const [row] = await this.client.db.insert(courses).values({
          id: data.id as string,
          name: data.name as string,
          departmentId: data.department_id as string,
          type: data.exam_type as "written" | "computer" | "oral",
        }).returning();
        return this.toCourse(row);
      }
      case "rooms": {
        const [row] = await this.client.db.insert(rooms).values({
          id: data.id as string,
          name: data.name as string,
          buildingId: data.building_id as string,
          capacity: data.capacity as number,
          type: data.room_type as "standard" | "computer_lab" | "language_lab",
          equipmentTags: data.equipment_tags as string[],
        }).returning();
        return this.toRoom(row);
      }
      case "time-slots": {
        const [row] = await this.client.db.insert(timeSlots).values({
          id: data.id as string,
          batchId: batch.id,
          date: data.date as string,
          startTime: data.start_time as string,
          endTime: data.end_time as string,
          periodIndex: data.period_index as number,
        }).returning();
        return this.toTimeSlot(row);
      }
      case "exam-tasks": {
        const [row] = await this.client.db.insert(examTasks).values({
          id: data.id as string,
          batchId: batch.id,
          courseId: data.course_id as string,
          studentGroupIds: data.student_group_ids as string[],
          expectedCount: data.expected_count as number,
          durationMinutes: data.duration_minutes as number,
          requiredRoomType: data.required_room_type as "standard" | "computer_lab" | "language_lab",
          requiredEquipmentTags: data.required_equipment_tags as string[],
          allowedSlotIds: data.allowed_slot_ids as string[],
          invigilatorCount: data.invigilator_count as number,
        }).returning();
        return this.toExamTask(row);
      }
    }
  }

  async updateReferenceRecord(
    resource: ReferenceResource,
    id: string,
    patch: Partial<ReferenceRecord>,
  ): Promise<ReferenceRecord | null> {
    const data = patch as Record<string, unknown>;

    switch (resource) {
      case "student-groups": {
        const [row] = await this.client.db.update(studentGroups).set(stripUndefined({
          name: data.name as string | undefined,
          size: data.size as number | undefined,
          departmentId: data.department_id as string | undefined,
        })).where(eq(studentGroups.id, id)).returning();
        return row ? this.toStudentGroup(row) : null;
      }
      case "teachers": {
        const [row] = await this.client.db.update(teachers).set(stripUndefined({
          name: data.name as string | undefined,
          departmentId: data.department_id as string | undefined,
          unavailableSlotIds: data.unavailable_slot_ids as string[] | undefined,
        })).where(eq(teachers.id, id)).returning();
        return row ? this.toTeacher(row) : null;
      }
      case "courses": {
        const [row] = await this.client.db.update(courses).set(stripUndefined({
          name: data.name as string | undefined,
          departmentId: data.department_id as string | undefined,
          type: data.exam_type as "written" | "computer" | "oral" | undefined,
        })).where(eq(courses.id, id)).returning();
        return row ? this.toCourse(row) : null;
      }
      case "rooms": {
        const [row] = await this.client.db.update(rooms).set(stripUndefined({
          name: data.name as string | undefined,
          buildingId: data.building_id as string | undefined,
          capacity: data.capacity as number | undefined,
          type: data.room_type as "standard" | "computer_lab" | "language_lab" | undefined,
          equipmentTags: data.equipment_tags as string[] | undefined,
        })).where(eq(rooms.id, id)).returning();
        return row ? this.toRoom(row) : null;
      }
      case "time-slots": {
        const [row] = await this.client.db.update(timeSlots).set(stripUndefined({
          date: data.date as string | undefined,
          startTime: data.start_time as string | undefined,
          endTime: data.end_time as string | undefined,
          periodIndex: data.period_index as number | undefined,
        })).where(eq(timeSlots.id, id)).returning();
        return row ? this.toTimeSlot(row) : null;
      }
      case "exam-tasks": {
        const [row] = await this.client.db.update(examTasks).set(stripUndefined({
          courseId: data.course_id as string | undefined,
          studentGroupIds: data.student_group_ids as string[] | undefined,
          expectedCount: data.expected_count as number | undefined,
          durationMinutes: data.duration_minutes as number | undefined,
          requiredRoomType: data.required_room_type as "standard" | "computer_lab" | "language_lab" | undefined,
          requiredEquipmentTags: data.required_equipment_tags as string[] | undefined,
          allowedSlotIds: data.allowed_slot_ids as string[] | undefined,
          invigilatorCount: data.invigilator_count as number | undefined,
        })).where(eq(examTasks.id, id)).returning();
        return row ? this.toExamTask(row) : null;
      }
    }
  }

  async createScheduleRun(result: ScheduleResult): Promise<ScheduleRunResponse> {
    const batch = await this.getActiveBatch();
    const id = `run-${randomUUID()}`;
    const createdAt = new Date();
    const run: ScheduleRunSummary = {
      id,
      status: result.statistics.status,
      createdAt: createdAt.toISOString(),
      elapsedMs: result.statistics.elapsed_ms,
      score: result.score.total_score,
      conflictCount: result.conflicts.length,
      assignmentCount: result.assignments.length,
    };

    await this.client.db.transaction(async (tx) => {
      await tx.insert(scheduleRuns).values({
        id,
        batchId: batch.id,
        status: result.statistics.status,
        score: result.score.total_score,
        scoreBreakdown: result.score,
        conflictCount: result.conflicts.length,
        assignmentCount: result.assignments.length,
        elapsedMs: result.statistics.elapsed_ms,
        statistics: result.statistics,
        report: result.report ?? {},
        createdAt,
      });

      if (result.assignments.length > 0) {
        await tx.insert(scheduledExams).values(
          result.assignments.map((assignment, index) => ({
            id: `${id}-exam-${index + 1}`,
            runId: id,
            examTaskId: assignment.exam_task_id,
            roomId: assignment.room_id,
            timeSlotId: assignment.time_slot_id,
            teacherIds: assignment.teacher_ids,
          })),
        );
      }

      if (result.conflicts.length > 0) {
        await tx.insert(conflictRecords).values(
          result.conflicts.map((conflict, index) => ({
            id: `${id}-conflict-${index + 1}`,
            runId: id,
            type: conflict.type,
            severity: conflict.severity,
            affectedIds: conflict.affected_ids,
            message: conflict.message,
            suggestion: conflict.suggestion,
          })),
        );
      }

      await tx.insert(auditEvents).values({
        id: `audit-${randomUUID()}`,
        actor: "system",
        action: "schedule_run.created",
        entityType: "schedule_run",
        entityId: id,
        payload: {
          batchId: batch.id,
          status: result.statistics.status,
          score: result.score.total_score,
          assignmentCount: result.assignments.length,
          conflictCount: result.conflicts.length,
        },
      });
    });

    return { run, result };
  }

  async getScheduleRun(id: string): Promise<ScheduleRunResponse | null> {
    const [run] = await this.client.db
      .select()
      .from(scheduleRuns)
      .where(eq(scheduleRuns.id, id))
      .limit(1);

    if (!run) {
      return null;
    }

    const [assignmentRows, conflictRows] = await Promise.all([
      this.client.db
        .select()
        .from(scheduledExams)
        .where(eq(scheduledExams.runId, id)),
      this.client.db
        .select()
        .from(conflictRecords)
        .where(eq(conflictRecords.runId, id)),
    ]);

    return {
      run: this.toRunSummary(run),
      result: {
        assignments: assignmentRows.map((assignment) => ({
          exam_task_id: assignment.examTaskId,
          room_id: assignment.roomId,
          time_slot_id: assignment.timeSlotId,
          teacher_ids: assignment.teacherIds,
        })),
        conflicts: conflictRows.map((conflict) => ({
          type: conflict.type,
          severity: conflict.severity,
          affected_ids: conflict.affectedIds,
          message: conflict.message,
          suggestion: conflict.suggestion,
        })),
        score: run.scoreBreakdown,
        statistics: run.statistics as ScheduleResult["statistics"],
        report: run.report as ScheduleResult["report"],
      },
    };
  }

  async listScheduleRuns(): Promise<ScheduleRunListResponse> {
    const rows = await this.client.db
      .select()
      .from(scheduleRuns)
      .orderBy(desc(scheduleRuns.createdAt))
      .limit(30);

    return {
      runs: rows.map((run) => this.toRunSummary(run)),
    };
  }

  async compareScheduleRuns(
    baseId: string,
    targetId: string,
  ): Promise<ScheduleRunComparisonResponse | null> {
    const [base, target] = await Promise.all([
      this.getScheduleRun(baseId),
      this.getScheduleRun(targetId),
    ]);

    return base && target ? buildRunComparison(base, target) : null;
  }

  async listAuditEvents(): Promise<AuditEventListResponse> {
    const rows = await this.client.db
      .select()
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(50);

    return {
      events: rows.map((event) => this.toAuditEvent(event)),
    };
  }

  async publishScheduleRun(id: string): Promise<PublishedScheduleResponse | null> {
    const response = await this.getScheduleRun(id);
    if (!response) {
      return null;
    }
    const batch = await this.getActiveBatch();
    const [updatedBatch] = await this.client.db
      .update(examBatches)
      .set({
        status: "published",
        publishedRunId: id,
      })
      .where(eq(examBatches.id, batch.id))
      .returning();

    await this.recordAuditEvent("schedule_run.published", "schedule_run", id, {
      batchId: batch.id,
      score: response.run.score,
      status: response.run.status,
    });

    return {
      batch: this.toBatchSummary(updatedBatch),
      run: response.run,
      result: response.result,
    };
  }

  async getPublishedSchedule(): Promise<PublishedScheduleResponse | null> {
    const batch = await this.getActiveBatch();
    if (!batch.publishedRunId) {
      return null;
    }
    const response = await this.getScheduleRun(batch.publishedRunId);
    return response ? {
      batch: this.toBatchSummary(batch),
      run: response.run,
      result: response.result,
    } : null;
  }

  async rollbackPublishedSchedule(): Promise<ScheduleRollbackResponse> {
    const batch = await this.getActiveBatch();
    const previousRun = batch.publishedRunId
      ? (await this.getScheduleRun(batch.publishedRunId))?.run ?? null
      : null;
    const [updatedBatch] = await this.client.db
      .update(examBatches)
      .set({
        status: "ready",
        publishedRunId: null,
      })
      .where(eq(examBatches.id, batch.id))
      .returning();

    await this.recordAuditEvent("schedule_run.rollback", "exam_batch", batch.id, {
      previousRunId: previousRun?.id ?? null,
    });

    return {
      batch: this.toBatchSummary(updatedBatch),
      previousRun,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private async getActiveBatch(): Promise<BatchRow> {
    const [batch] = await this.client.db
      .select()
      .from(examBatches)
      .orderBy(desc(examBatches.createdAt))
      .limit(1);

    if (!batch) {
      throw new Error("No exam batch found. Run the database seed script first.");
    }

    return batch;
  }

  private async getLatestRunSummary(batchId: string): Promise<ScheduleRunSummary | null> {
    const [run] = await this.client.db
      .select()
      .from(scheduleRuns)
      .where(eq(scheduleRuns.batchId, batchId))
      .orderBy(desc(scheduleRuns.createdAt))
      .limit(1);

    return run ? this.toRunSummary(run) : null;
  }

  private toBatchSummary(batch: BatchRow): ReferenceDataResponse["batch"] {
    return {
      id: batch.id,
      name: batch.name,
      status: batch.status,
      startDate: batch.startDate,
      endDate: batch.endDate,
    };
  }

  private toStudentGroup(group: StudentGroupRow): ReferenceDataResponse["scheduleInput"]["student_groups"][number] {
    return {
      id: group.id,
      name: group.name,
      size: group.size,
      department_id: group.departmentId,
    };
  }

  private toTeacher(teacher: TeacherRow): ReferenceDataResponse["scheduleInput"]["teachers"][number] {
    return {
      id: teacher.id,
      name: teacher.name,
      department_id: teacher.departmentId,
      unavailable_slot_ids: teacher.unavailableSlotIds,
    };
  }

  private toCourse(course: CourseRow): ReferenceDataResponse["scheduleInput"]["courses"][number] {
    return {
      id: course.id,
      name: course.name,
      department_id: course.departmentId,
      exam_type: course.type,
    };
  }

  private toRoom(room: RoomRow): ReferenceDataResponse["scheduleInput"]["rooms"][number] {
    return {
      id: room.id,
      name: room.name,
      building_id: room.buildingId,
      capacity: room.capacity,
      room_type: room.type,
      equipment_tags: room.equipmentTags,
    };
  }

  private toTimeSlot(slot: TimeSlotRow): ReferenceDataResponse["scheduleInput"]["time_slots"][number] {
    return {
      id: slot.id,
      date: slot.date,
      start_time: slot.startTime,
      end_time: slot.endTime,
      period_index: slot.periodIndex,
    };
  }

  private toExamTask(task: ExamTaskRow): ReferenceDataResponse["scheduleInput"]["exam_tasks"][number] {
    return {
      id: task.id,
      course_id: task.courseId,
      student_group_ids: task.studentGroupIds,
      expected_count: task.expectedCount,
      duration_minutes: task.durationMinutes,
      required_room_type: task.requiredRoomType,
      required_equipment_tags: task.requiredEquipmentTags,
      allowed_slot_ids: task.allowedSlotIds,
      invigilator_count: task.invigilatorCount,
    };
  }

  private toRunSummary(run: RunRow): ScheduleRunSummary {
    return {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      elapsedMs: run.elapsedMs,
      score: run.score,
      conflictCount: run.conflictCount,
      assignmentCount: run.assignmentCount,
    };
  }

  private toAuditEvent(event: AuditEventRow): AuditEventSummary {
    return {
      id: event.id,
      actor: event.actor,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      payload: event.payload as Record<string, unknown>,
      createdAt: event.createdAt.toISOString(),
    };
  }

  private async recordAuditEvent(
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ) {
    await this.client.db.insert(auditEvents).values({
      id: `audit-${randomUUID()}`,
      actor: "system",
      action,
      entityType,
      entityId,
      payload,
    });
  }
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}
