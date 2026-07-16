import {
  JobExecutionService,
  type ScheduleJobRepository,
  type ScheduleResultWriter,
  type SchedulerClient,
} from "@examforge/scheduling-application";
import { Worker, type ConnectionOptions } from "bullmq";
import {
  SCHEDULE_QUEUE_NAME,
  SCHEDULE_QUEUE_PREFIX,
  type ScheduleQueueJobData,
} from "./queue.js";
import {
  DEFAULT_SCHEDULE_JOB_RETRY_POLICY,
  type ScheduleJobRetryPolicy,
  validateScheduleJobRetryPolicy,
} from "./retry-policy.js";

type SchedulingWorkerRepository = ScheduleJobRepository & ScheduleResultWriter;

export interface SchedulingWorkerOptions extends Partial<ScheduleJobRetryPolicy> {
  repository: SchedulingWorkerRepository;
  scheduler: SchedulerClient;
  connection: ConnectionOptions;
  cancellationPollIntervalMs?: number;
  lockDurationMs?: number;
  stalledIntervalMs?: number;
}

export function createSchedulingWorker(
  options: SchedulingWorkerOptions,
): Worker<ScheduleQueueJobData> {
  const cancellationPollIntervalMs = positiveInteger(
    options.cancellationPollIntervalMs ?? 250,
    "cancellationPollIntervalMs",
  );
  const retryPolicy = validateScheduleJobRetryPolicy({
    maxAttempts: options.maxAttempts ?? DEFAULT_SCHEDULE_JOB_RETRY_POLICY.maxAttempts,
    retryBaseDelayMs:
      options.retryBaseDelayMs ?? DEFAULT_SCHEDULE_JOB_RETRY_POLICY.retryBaseDelayMs,
  });
  const execution = new JobExecutionService(
    options.repository,
    options.repository,
    options.scheduler,
    {
      maxAttempts: retryPolicy.maxAttempts,
      retryBaseDelayMs: retryPolicy.retryBaseDelayMs,
    },
  );
  return new Worker<ScheduleQueueJobData>(SCHEDULE_QUEUE_NAME, async (queueJob) => {
    const abortController = new AbortController();
    let polling = false;
    const pollCancellation = async () => {
      if (polling || abortController.signal.aborted) {
        return;
      }
      polling = true;
      try {
        if (await options.repository.isScheduleJobCancellationRequested(
          queueJob.data.jobId,
        )) {
          abortController.abort();
        }
      } finally {
        polling = false;
      }
    };
    const cancellationTimer = setInterval(() => {
      void pollCancellation();
    }, cancellationPollIntervalMs);
    try {
      await pollCancellation();
      const result = await execution.execute(queueJob.data.jobId, {
        deliveryAttempt: queueJob.attemptsStarted,
        reclaimRunning: true,
        signal: abortController.signal,
      });
      if (result.resolution === "retry_scheduled") {
        throw new Error("Schedule job delivery requires retry.");
      }
      return result;
    } finally {
      clearInterval(cancellationTimer);
    }
  }, {
    connection: options.connection,
    prefix: SCHEDULE_QUEUE_PREFIX,
    concurrency: 1,
    maxStalledCount: retryPolicy.maxAttempts - 1,
    ...(options.lockDurationMs === undefined
      ? {}
      : { lockDuration: positiveInteger(options.lockDurationMs, "lockDurationMs") }),
    ...(options.stalledIntervalMs === undefined
      ? {}
      : { stalledInterval: positiveInteger(options.stalledIntervalMs, "stalledIntervalMs") }),
  });
}

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
