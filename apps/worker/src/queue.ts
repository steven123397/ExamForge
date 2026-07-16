import { Queue, type ConnectionOptions } from "bullmq";
import {
  DEFAULT_SCHEDULE_JOB_RETRY_POLICY,
  type ScheduleJobRetryPolicy,
  validateScheduleJobRetryPolicy,
} from "./retry-policy.js";

export const SCHEDULE_QUEUE_NAME = "schedule-jobs";
export const SCHEDULE_QUEUE_PREFIX = "examforge";
export const SCHEDULE_JOB_EVENT_CHANNEL = "examforge:schedule-job-events";

export interface ScheduleQueueJobData {
  jobId: string;
  outboxEventId: string;
  traceId: string;
}

export function createScheduleQueue(
  connection: ConnectionOptions,
  retryPolicy: ScheduleJobRetryPolicy = DEFAULT_SCHEDULE_JOB_RETRY_POLICY,
) {
  const validatedRetryPolicy = validateScheduleJobRetryPolicy(retryPolicy);
  return new Queue<ScheduleQueueJobData>(SCHEDULE_QUEUE_NAME, {
    connection,
    prefix: SCHEDULE_QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: validatedRetryPolicy.maxAttempts,
      backoff: {
        type: "exponential",
        delay: validatedRetryPolicy.retryBaseDelayMs,
      },
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 1_000 },
    },
  });
}

export function scheduleQueueJobId(jobId: string) {
  return `schedule-job-${jobId}`;
}

export function redisConnectionOptions(
  redisUrl: string,
  maxRetriesPerRequest: number | null,
): ConnectionOptions {
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error("Redis URL must use redis or rediss.");
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    maxRetriesPerRequest,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
  };
}
