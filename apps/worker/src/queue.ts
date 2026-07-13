import { Queue, type ConnectionOptions } from "bullmq";

export const SCHEDULE_QUEUE_NAME = "schedule-jobs";
export const SCHEDULE_QUEUE_PREFIX = "examforge";
export const SCHEDULE_JOB_EVENT_CHANNEL = "examforge:schedule-job-events";
export const SCHEDULE_QUEUE_MAX_ATTEMPTS = 3;
export const SCHEDULE_QUEUE_RETRY_DELAY_MS = 1_000;

export interface ScheduleQueueJobData {
  jobId: string;
  outboxEventId: string;
  traceId: string;
}

export function createScheduleQueue(connection: ConnectionOptions) {
  return new Queue<ScheduleQueueJobData>(SCHEDULE_QUEUE_NAME, {
    connection,
    prefix: SCHEDULE_QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: SCHEDULE_QUEUE_MAX_ATTEMPTS,
      backoff: {
        type: "exponential",
        delay: SCHEDULE_QUEUE_RETRY_DELAY_MS,
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
