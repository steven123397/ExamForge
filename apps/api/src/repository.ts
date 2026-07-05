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
  getDashboard(): DashboardResponse;
  getReferenceData(): ReferenceDataResponse;
  createScheduleRun(result: ScheduleResult): ScheduleRunResponse;
  getScheduleRun(id: string): ScheduleRunResponse | null;
}

export class InMemoryPlatformRepository implements PlatformRepository {
  private runs = new Map<string, ScheduleRunResponse>();

  getDashboard(): DashboardResponse {
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

  getReferenceData(): ReferenceDataResponse {
    return {
      batch: demoBatch,
      scheduleInput: demoScheduleInput,
    };
  }

  createScheduleRun(result: ScheduleResult): ScheduleRunResponse {
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

  getScheduleRun(id: string): ScheduleRunResponse | null {
    return this.runs.get(id) ?? null;
  }
}
