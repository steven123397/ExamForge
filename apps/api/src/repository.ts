import {
  demoBatch,
  demoScheduleInput,
  type AuditEventListResponse,
  type AuditEventSummary,
  type DashboardResponse,
  type ReferenceRecord,
  type ReferenceDataResponse,
  type ReferenceResource,
  type ScheduleRunComparisonResponse,
  type ScheduleRunListResponse,
  type ScheduleResult,
  type ScheduleRunResponse,
  type ScheduleRunSummary,
} from "@examforge/shared";
import { randomUUID } from "node:crypto";

export interface PlatformRepository {
  getDashboard(): Promise<DashboardResponse>;
  getReferenceData(): Promise<ReferenceDataResponse>;
  createReferenceRecord(resource: ReferenceResource, record: ReferenceRecord): Promise<ReferenceRecord>;
  updateReferenceRecord(
    resource: ReferenceResource,
    id: string,
    patch: Partial<ReferenceRecord>,
  ): Promise<ReferenceRecord | null>;
  createScheduleRun(result: ScheduleResult): Promise<ScheduleRunResponse>;
  listScheduleRuns(): Promise<ScheduleRunListResponse>;
  getScheduleRun(id: string): Promise<ScheduleRunResponse | null>;
  compareScheduleRuns(
    baseId: string,
    targetId: string,
  ): Promise<ScheduleRunComparisonResponse | null>;
  listAuditEvents(): Promise<AuditEventListResponse>;
  close?(): Promise<void>;
}

export class InMemoryPlatformRepository implements PlatformRepository {
  private runs = new Map<string, ScheduleRunResponse>();
  private auditEvents: AuditEventSummary[] = [];
  private scheduleInput = structuredClone(demoScheduleInput);

  async getDashboard(): Promise<DashboardResponse> {
    const latestRun = Array.from(this.runs.values()).at(-1)?.run ?? null;
    return {
      batch: demoBatch,
      metrics: {
        examTaskCount: this.scheduleInput.exam_tasks.length,
        teacherCount: this.scheduleInput.teachers.length,
        roomCount: this.scheduleInput.rooms.length,
        timeSlotCount: this.scheduleInput.time_slots.length,
        conflictCount: latestRun?.conflictCount ?? 0,
        score: latestRun?.score ?? null,
      },
      latestRun,
    };
  }

  async getReferenceData(): Promise<ReferenceDataResponse> {
    return {
      batch: demoBatch,
      scheduleInput: this.scheduleInput,
    };
  }

  async createReferenceRecord(
    resource: ReferenceResource,
    record: ReferenceRecord,
  ): Promise<ReferenceRecord> {
    const collection = this.getCollection(resource);
    collection.push(record as never);
    return record;
  }

  async updateReferenceRecord(
    resource: ReferenceResource,
    id: string,
    patch: Partial<ReferenceRecord>,
  ): Promise<ReferenceRecord | null> {
    const collection = this.getCollection(resource);
    const index = collection.findIndex((record) => record.id === id);
    if (index === -1) {
      return null;
    }
    collection[index] = {
      ...collection[index],
      ...patch,
      id,
    } as never;
    return collection[index] as ReferenceRecord;
  }

  async createScheduleRun(result: ScheduleResult): Promise<ScheduleRunResponse> {
    const id = `run-${randomUUID()}`;
    const run: ScheduleRunSummary = {
      id,
      status: result.statistics.status,
      createdAt: new Date().toISOString(),
      elapsedMs: result.statistics.elapsed_ms,
      score: result.score.total_score,
      conflictCount: result.conflicts.length,
      assignmentCount: result.assignments.length,
    };
    const response = { run, result };
    this.runs.set(id, response);
    this.auditEvents.push({
      id: `audit-${randomUUID()}`,
      actor: "system",
      action: "schedule_run.created",
      entityType: "schedule_run",
      entityId: id,
      payload: {
        status: result.statistics.status,
        score: result.score.total_score,
        assignmentCount: result.assignments.length,
        conflictCount: result.conflicts.length,
      },
      createdAt: run.createdAt,
    });
    return response;
  }

  async listScheduleRuns(): Promise<ScheduleRunListResponse> {
    return {
      runs: Array.from(this.runs.values()).map((item) => item.run).reverse(),
    };
  }

  async getScheduleRun(id: string): Promise<ScheduleRunResponse | null> {
    return this.runs.get(id) ?? null;
  }

  async compareScheduleRuns(
    baseId: string,
    targetId: string,
  ): Promise<ScheduleRunComparisonResponse | null> {
    const base = await this.getScheduleRun(baseId);
    const target = await this.getScheduleRun(targetId);
    return base && target ? buildRunComparison(base, target) : null;
  }

  async listAuditEvents(): Promise<AuditEventListResponse> {
    return { events: [...this.auditEvents].reverse() };
  }

  private getCollection(resource: ReferenceResource): Array<ReferenceRecord> {
    const collections = {
      "student-groups": this.scheduleInput.student_groups,
      teachers: this.scheduleInput.teachers,
      courses: this.scheduleInput.courses,
      rooms: this.scheduleInput.rooms,
      "time-slots": this.scheduleInput.time_slots,
      "exam-tasks": this.scheduleInput.exam_tasks,
    };
    return collections[resource] as Array<ReferenceRecord>;
  }
}

export function buildRunComparison(
  base: ScheduleRunResponse,
  target: ScheduleRunResponse,
): ScheduleRunComparisonResponse {
  const baseKeys = new Map(base.result.assignments.map((assignment) => [
    assignmentKey(assignment),
    assignment,
  ]));
  const targetKeys = new Map(target.result.assignments.map((assignment) => [
    assignmentKey(assignment),
    assignment,
  ]));
  const added = target.result.assignments.filter((assignment) => (
    !baseKeys.has(assignmentKey(assignment))
  ));
  const removed = base.result.assignments.filter((assignment) => (
    !targetKeys.has(assignmentKey(assignment))
  ));

  return {
    baseRun: base.run,
    targetRun: target.run,
    deltas: {
      score: target.run.score - base.run.score,
      assignments: target.run.assignmentCount - base.run.assignmentCount,
      conflicts: target.run.conflictCount - base.run.conflictCount,
      elapsedMs: target.run.elapsedMs - base.run.elapsedMs,
    },
    assignmentChanges: {
      unchanged: base.result.assignments.length - removed.length,
      added,
      removed,
    },
  };
}

function assignmentKey(assignment: ScheduleResult["assignments"][number]) {
  return [
    assignment.exam_task_id,
    assignment.room_id,
    assignment.time_slot_id,
    ...assignment.teacher_ids,
  ].join("|");
}
