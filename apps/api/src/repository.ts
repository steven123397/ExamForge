import {
  demoBatch,
  demoScheduleInput,
  type DashboardResponse,
  type ReferenceDataResponse,
  type ScheduleResult,
  type ScheduleRunResponse,
  type ScheduleRunSummary,
} from "@examforge/shared";
import { randomUUID } from "node:crypto";

export interface PlatformRepository {
  getDashboard(): Promise<DashboardResponse>;
  getReferenceData(): Promise<ReferenceDataResponse>;
  createScheduleRun(result: ScheduleResult): Promise<ScheduleRunResponse>;
  getScheduleRun(id: string): Promise<ScheduleRunResponse | null>;
  close?(): Promise<void>;
}

export class InMemoryPlatformRepository implements PlatformRepository {
  private runs = new Map<string, ScheduleRunResponse>();

  async getDashboard(): Promise<DashboardResponse> {
    const latestRun = Array.from(this.runs.values()).at(-1)?.run ?? null;
    return {
      batch: demoBatch,
      metrics: {
        examTaskCount: demoScheduleInput.exam_tasks.length,
        teacherCount: demoScheduleInput.teachers.length,
        roomCount: demoScheduleInput.rooms.length,
        timeSlotCount: demoScheduleInput.time_slots.length,
        conflictCount: latestRun?.conflictCount ?? 0,
        score: latestRun?.score ?? null,
      },
      latestRun,
    };
  }

  async getReferenceData(): Promise<ReferenceDataResponse> {
    return {
      batch: demoBatch,
      scheduleInput: demoScheduleInput,
    };
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
}
