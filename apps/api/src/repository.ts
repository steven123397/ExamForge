import {
  demoBatch,
  demoScheduleInput,
  type DashboardResponse,
  type ReferenceRecord,
  type ReferenceDataResponse,
  type ReferenceResource,
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
  getScheduleRun(id: string): Promise<ScheduleRunResponse | null>;
  close?(): Promise<void>;
}

export class InMemoryPlatformRepository implements PlatformRepository {
  private runs = new Map<string, ScheduleRunResponse>();
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
    return response;
  }

  async getScheduleRun(id: string): Promise<ScheduleRunResponse | null> {
    return this.runs.get(id) ?? null;
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
