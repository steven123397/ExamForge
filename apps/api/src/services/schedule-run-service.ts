import type { FixedAssignment, ScheduleInput } from "@examforge/shared";
import type { PlatformRepository } from "../repository.js";
import type { SchedulerClient } from "../scheduler-client.js";

export type DeferredTask = () => Promise<void>;
export type DeferScheduleTask = (task: DeferredTask) => void;

export class ScheduleRunService {
  constructor(
    private readonly repository: PlatformRepository,
    private readonly scheduler: SchedulerClient,
    private readonly defer: DeferScheduleTask = deferWithTimer,
  ) {}

  async createScheduleRun(fixedAssignments: FixedAssignment[]) {
    const referenceData = await this.repository.getReferenceData();
    const result = await this.scheduler.solve(
      withFixedAssignments(referenceData.scheduleInput, fixedAssignments),
    );
    return this.repository.createScheduleRun(result);
  }

  async createScheduleJob(fixedAssignments: FixedAssignment[]) {
    const job = await this.repository.createScheduleJob();
    this.defer(() => this.executeScheduleJob(job.id, fixedAssignments));
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

  private async executeScheduleJob(id: string, fixedAssignments: FixedAssignment[]) {
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
        withFixedAssignments(referenceData.scheduleInput, fixedAssignments),
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

function withFixedAssignments(
  scheduleInput: ScheduleInput,
  fixedAssignments: FixedAssignment[],
): ScheduleInput {
  return {
    ...scheduleInput,
    fixed_assignments: fixedAssignments,
  };
}
