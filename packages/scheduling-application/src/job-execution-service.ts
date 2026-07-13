import type { ScheduleJobError, ScheduleJobSummary } from "@examforge/shared";
import {
  SchedulerClientError,
  type ScheduleJobExecutionRepository,
  type ScheduleResultWriter,
  type SchedulerClient,
} from "./contracts.js";

export interface JobExecutionServiceOptions {
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  now?: () => Date;
}

export interface ExecuteScheduleJobOptions {
  deliveryAttempt?: number;
  reclaimRunning?: boolean;
  signal?: AbortSignal;
}

export type JobExecutionResolution =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "retry_scheduled"
  | "not_claimable"
  | "not_found"
  | "stale";

export interface JobExecutionResult {
  resolution: JobExecutionResolution;
  job: ScheduleJobSummary | null;
}

export class JobExecutionService {
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly repository: ScheduleJobExecutionRepository,
    private readonly resultWriter: ScheduleResultWriter,
    private readonly scheduler: SchedulerClient,
    options: JobExecutionServiceOptions = {},
  ) {
    this.maxAttempts = positiveInteger(options.maxAttempts ?? 3, "maxAttempts");
    this.retryBaseDelayMs = positiveInteger(
      options.retryBaseDelayMs ?? 1_000,
      "retryBaseDelayMs",
    );
    this.retryMaxDelayMs = positiveInteger(
      options.retryMaxDelayMs ?? 30_000,
      "retryMaxDelayMs",
    );
    this.now = options.now ?? (() => new Date());
  }

  async execute(
    jobId: string,
    options: ExecuteScheduleJobOptions = {},
  ): Promise<JobExecutionResult> {
    const claim = await this.repository.claimScheduleJob(jobId, {
      deliveryAttempt: options.deliveryAttempt,
      reclaimRunning: options.reclaimRunning,
    });
    if (claim.resolution !== "claimed") {
      return { resolution: claim.resolution, job: claim.job };
    }

    try {
      let schedulerVersion = "unknown";
      const result = await this.scheduler.solve(claim.requestSnapshot.input, {
        requestId: claim.attempt.schedulerRequestId,
        signal: options.signal,
        onMetadata: (metadata) => {
          schedulerVersion = metadata.schedulerVersion;
        },
      });
      const completion = await this.resultWriter.completeScheduleJob(jobId, {
        attemptId: claim.attempt.id,
        result,
        schedulerVersion,
      });
      if (completion.resolution !== "apply") {
        return { resolution: "stale", job: completion.job };
      }
      return {
        resolution: completion.job?.status === "succeeded" ? "succeeded" : "failed",
        job: completion.job,
      };
    } catch (error) {
      const failure = normalizeExecutionFailure(error);
      const outcome = failureOutcome(
        failure,
        claim.attempt.attemptNumber,
        this.maxAttempts,
      );
      const retryAt = outcome === "retry"
        ? new Date(this.now().getTime() + this.retryDelay(claim.attempt.attemptNumber)).toISOString()
        : null;
      const transition = await this.repository.failScheduleJobAttempt(jobId, {
        attemptId: claim.attempt.id,
        error: failure,
        outcome,
        retryAt,
      });
      if (transition.resolution !== "apply") {
        return { resolution: "stale", job: transition.job };
      }
      return {
        resolution: outcome === "retry" ? "retry_scheduled" : outcome,
        job: transition.job,
      };
    }
  }

  private retryDelay(attemptNumber: number) {
    return Math.min(
      this.retryMaxDelayMs,
      this.retryBaseDelayMs * (2 ** Math.max(0, attemptNumber - 1)),
    );
  }
}

function normalizeExecutionFailure(error: unknown): ScheduleJobError {
  if (error instanceof SchedulerClientError) {
    return {
      category: error.category,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    category: "internal",
    code: "schedule_job_execution_failed",
    message: "Schedule job execution failed.",
    retryable: true,
  };
}

function failureOutcome(
  error: ScheduleJobError,
  attemptNumber: number,
  maxAttempts: number,
) {
  if (error.category === "cancelled") {
    return "cancelled" as const;
  }
  if (error.category === "timeout") {
    return "timed_out" as const;
  }
  if (
    error.retryable
    && (error.category === "unavailable" || error.category === "internal")
    && attemptNumber < maxAttempts
  ) {
    return "retry" as const;
  }
  return "failed" as const;
}

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
