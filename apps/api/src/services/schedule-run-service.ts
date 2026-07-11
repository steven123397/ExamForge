import type { ScheduleInput } from "@examforge/shared";
import type { PlatformRepository } from "../repository.js";
import type { SchedulerClient } from "../scheduler-client.js";

export type DeferredTask = () => Promise<void>;
export type DeferScheduleTask = (task: DeferredTask) => void;
export type ScheduleRunOverrides = Pick<
  ScheduleInput,
  "fixed_assignments" | "reschedule_context"
>;

export class ScheduleRunService {
  constructor(
    private readonly repository: PlatformRepository,
    private readonly scheduler: SchedulerClient,
    private readonly defer: DeferScheduleTask = deferWithTimer,
  ) {}

  async createScheduleRun(overrides: ScheduleRunOverrides) {
    const referenceData = await this.repository.getReferenceData();
    const result = await this.scheduler.solve(
      withScheduleOverrides(referenceData.scheduleInput, overrides),
    );
    return this.repository.createScheduleRun(result);
  }

  async createScheduleJob(overrides: ScheduleRunOverrides) {
    const job = await this.repository.createScheduleJob();
    this.defer(() => this.executeScheduleJob(job.id, overrides));
    return job;
  }

  listScheduleJobs() {
    return this.repository.listScheduleJobs();
  }

  getScheduleJob(id: string) {
    return this.repository.getScheduleJob(id);
  }

  async recoverInterruptedJobs() {
    return this.repository.recoverInterruptedScheduleJobs?.();
  }

  private async executeScheduleJob(id: string, overrides: ScheduleRunOverrides) {
    const current = await this.repository.getScheduleJob(id);
    if (!current) {
      return;
    }
    await this.repository.updateScheduleJob(id, {
      status: "running",
      progress: 35,
    });
    try {
      const referenceData = await this.repository.getReferenceData();
      const result = await this.scheduler.solve(
        withScheduleOverrides(referenceData.scheduleInput, overrides),
      );
      const response = await this.repository.createScheduleRun(result);
      await this.repository.updateScheduleJob(id, {
        status: "completed",
        progress: 100,
        runId: response.run.id,
      });
    } catch (error) {
      await this.repository.updateScheduleJob(id, {
        status: "failed",
        progress: 100,
        error: error instanceof Error ? error.message : "Schedule job failed.",
      });
    }
  }
}

function deferWithTimer(task: DeferredTask) {
  setTimeout(() => {
    void task();
  }, 0);
}

function withScheduleOverrides(
  scheduleInput: ScheduleInput,
  overrides: ScheduleRunOverrides,
): ScheduleInput {
  return {
    ...scheduleInput,
    ...overrides,
  };
}
