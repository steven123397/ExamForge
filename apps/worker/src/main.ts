import { ScheduleJobStore, createDbClient } from "@examforge/db";
import { HttpSchedulerClient } from "@examforge/scheduling-application";
import { Redis } from "ioredis";
import { loadWorkerConfig } from "./config.js";
import { createHealthServer } from "./health-server.js";
import { OutboxPublisher } from "./outbox-publisher.js";
import {
  SCHEDULE_JOB_EVENT_CHANNEL,
  createScheduleQueue,
  redisConnectionOptions,
} from "./queue.js";
import { createSchedulingWorker } from "./worker.js";

async function main() {
  const config = loadWorkerConfig();
  const dbClient = createDbClient(config.databaseUrl);
  const store = new ScheduleJobStore(dbClient);
  const healthRedis = createRedis(config.redisUrl);
  const service = config.role === "publisher"
    ? "examforge-publisher"
    : "examforge-worker";
  const health = createHealthServer({
    async checkPostgres() {
      await dbClient.pool.query("SELECT 1");
    },
    async checkRedis() {
      await healthRedis.ping();
    },
  }, {
    host: config.healthHost,
    port: config.healthPort,
    service,
  });
  const shutdown = shutdownSignal();
  await health.start();

  let closeRole: () => Promise<unknown>;
  let roleTask: Promise<void>;
  if (config.role === "publisher") {
    const queue = createScheduleQueue(redisConnectionOptions(config.redisUrl, 1), {
      maxAttempts: config.maxAttempts,
      retryBaseDelayMs: config.retryBaseDelayMs,
    });
    const publisher = new OutboxPublisher(store, {
      queue,
      publishEventId: (eventId) => healthRedis.publish(
        SCHEDULE_JOB_EVENT_CHANNEL,
        eventId,
      ),
      batchSize: config.outboxBatchSize,
    });
    closeRole = () => queue.close();
    roleTask = runPublisherLoop(
      publisher,
      shutdown.signal,
      config.outboxPollIntervalMs,
    );
  } else {
    const scheduler = new HttpSchedulerClient({
      baseUrl: config.schedulerBaseUrl,
      timeoutMs: config.schedulerTimeoutMs,
    });
    const worker = createSchedulingWorker({
      repository: store,
      scheduler,
      connection: redisConnectionOptions(config.redisUrl, null),
      cancellationPollIntervalMs: config.cancellationPollIntervalMs,
      maxAttempts: config.maxAttempts,
      retryBaseDelayMs: config.retryBaseDelayMs,
      lockDurationMs: config.lockDurationMs,
      stalledIntervalMs: config.stalledIntervalMs,
    });
    worker.on("error", () => {
      process.stderr.write("Scheduling worker reported an internal queue error.\n");
    });
    closeRole = () => worker.close();
    roleTask = new Promise<void>((resolve) => {
      shutdown.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  try {
    await roleTask;
  } finally {
    await closeRole();
    await health.close();
    await closeRedis(healthRedis);
    await dbClient.close();
  }
}

async function runPublisherLoop(
  publisher: OutboxPublisher,
  signal: AbortSignal,
  pollIntervalMs: number,
) {
  while (!signal.aborted) {
    try {
      await publisher.publishBatch();
    } catch {
      process.stderr.write("Outbox publisher dependency call failed; retrying.\n");
    }
    await waitForPoll(signal, pollIntervalMs);
  }
}

function waitForPoll(signal: AbortSignal, delayMs: number) {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function shutdownSignal() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return controller;
}

function createRedis(redisUrl: string) {
  const redis = new Redis(redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  redis.on("error", () => undefined);
  return redis;
}

async function closeRedis(redis: Redis) {
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
}

main().catch(() => {
  process.stderr.write("ExamForge worker process failed to start.\n");
  process.exitCode = 1;
});
