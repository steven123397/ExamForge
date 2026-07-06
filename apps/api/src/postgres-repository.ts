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
  type DashboardResponse,
  type ReferenceDataResponse,
  type ScheduleResult,
  type ScheduleRunResponse,
  type ScheduleRunSummary,
} from "@examforge/shared";
import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { PlatformRepository } from "./repository.js";

type BatchRow = typeof examBatches.$inferSelect;
type RunRow = typeof scheduleRuns.$inferSelect;

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
}
