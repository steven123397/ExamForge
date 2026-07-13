import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  ScheduleJobStore,
  createDbClient,
  runMigrations,
  scheduleJobAttempts,
  scheduleRuns,
  seedDemoData,
  type ExamForgeDbClient,
} from "@examforge/db";
import {
  JobSubmissionService,
  SchedulerClientError,
  type SchedulerClient,
  type SchedulerSolveOptions,
} from "@examforge/scheduling-application";
import {
  demoScheduleInput,
  type ScheduleInput,
  type ScheduleResult,
} from "@examforge/shared";
import type { Worker } from "bullmq";
import IORedis from "ioredis";
import {
  createScheduleQueue,
  redisConnectionOptions,
  scheduleQueueJobId,
  type ScheduleQueueJobData,
} from "../src/queue.js";
import { createSchedulingWorker } from "../src/worker.js";

const databaseUrl = requireTestUrl("TEST_DATABASE_URL", "test");
const redisUrl = requireTestUrl("TEST_REDIS_URL", "redis:");
let dbClient: ExamForgeDbClient | null = null;
let redis: IORedis | null = null;
const closeables: Array<{ close(force?: boolean): Promise<unknown> }> = [];

describe("scheduling worker", () => {
  beforeEach(async () => {
    dbClient = createDbClient(databaseUrl);
    await dbClient.pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await dbClient.pool.query("CREATE SCHEMA public");
    await runMigrations(dbClient);
    await seedDemoData(dbClient);
    redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
    redis.on("error", () => undefined);
    await redis.flushdb();
  });

  afterEach(async () => {
    while (closeables.length > 0) {
      await closeables.pop()?.close();
    }
    if (redis) {
      await redis.quit();
      redis = null;
    }
    if (dbClient) {
      await dbClient.close();
      dbClient = null;
    }
  });

  it("persists one result for a successful job and ignores a duplicate queue message", async () => {
    const store = new ScheduleJobStore(requireDb());
    const scheduler = new SequencedScheduler([buildScheduleResult()]);
    const worker = startWorker(store, scheduler);
    const queue = createScheduleQueue(redisConnectionOptions(redisUrl, 1));
    closeables.push(worker, queue);
    await worker.waitUntilReady();
    const submitted = await submitJob(store, "success");

    await queue.add("schedule-job", queueData(submitted.job.id), {
      jobId: scheduleQueueJobId(submitted.job.id),
    });
    await waitForJobStatus(store, submitted.job.id, "succeeded");
    await queue.add("schedule-job", queueData(submitted.job.id), {
      jobId: `duplicate-${scheduleQueueJobId(submitted.job.id)}`,
    });
    await waitFor(async () => (await queue.getCompletedCount()) >= 2);

    assert.equal((await requireDb().db.select().from(scheduleRuns)).length, 1);
    assert.equal(scheduler.calls, 1);
  });

  it("retries temporary scheduler unavailability and succeeds on the next delivery", async () => {
    const store = new ScheduleJobStore(requireDb());
    const scheduler = new SequencedScheduler([
      new SchedulerClientError(
        "Scheduler service is unavailable.",
        "unavailable",
        "scheduler_unavailable",
        true,
      ),
      buildScheduleResult(),
    ]);
    const worker = startWorker(store, scheduler);
    const queue = createScheduleQueue(redisConnectionOptions(redisUrl, 1));
    closeables.push(worker, queue);
    await worker.waitUntilReady();
    const submitted = await submitJob(store, "retry");

    await queue.add("schedule-job", queueData(submitted.job.id), {
      jobId: scheduleQueueJobId(submitted.job.id),
    });
    await waitForJobStatus(store, submitted.job.id, "succeeded");

    const attempts = await requireDb().db.select().from(scheduleJobAttempts);
    assert.deepEqual(attempts.map((attempt) => attempt.status), ["failed", "succeeded"]);
    assert.equal(scheduler.calls, 2);
    assert.equal((await requireDb().db.select().from(scheduleRuns)).length, 1);
  });

  it("aborts a running scheduler request after cooperative cancellation", async () => {
    const store = new ScheduleJobStore(requireDb());
    const scheduler = new AbortableScheduler();
    const worker = startWorker(store, scheduler, { cancellationPollIntervalMs: 20 });
    const queue = createScheduleQueue(redisConnectionOptions(redisUrl, 1));
    closeables.push(worker, queue);
    await worker.waitUntilReady();
    const submitted = await submitJob(store, "cancel");
    await queue.add("schedule-job", queueData(submitted.job.id), {
      jobId: scheduleQueueJobId(submitted.job.id),
    });
    await scheduler.started;

    const cancellation = await store.requestScheduleJobCancellation(submitted.job.id);
    assert.equal(cancellation.resolution, "requested");
    await waitForJobStatus(store, submitted.job.id, "cancelled");

    assert.equal(scheduler.aborted, true);
    assert.equal((await requireDb().db.select().from(scheduleRuns)).length, 0);
  });

  it("keeps business infeasibility, validation, protocol, and timeout outcomes terminal", async () => {
    const store = new ScheduleJobStore(requireDb());
    const infeasible = {
      ...buildScheduleResult(),
      assignments: [],
      statistics: {
        ...buildScheduleResult().statistics,
        status: "infeasible" as const,
      },
      report: { summary: { status: "infeasible" } },
    };
    const scheduler = new SequencedScheduler([
      infeasible,
      new SchedulerClientError(
        "Schedule input failed semantic validation.",
        "validation",
        "scheduler_input_invalid",
        false,
      ),
      new SchedulerClientError(
        "Scheduler response does not match the HTTP contract.",
        "protocol",
        "scheduler_protocol_invalid",
        false,
      ),
      new SchedulerClientError(
        "Scheduler request exceeded its deadline.",
        "timeout",
        "scheduler_timeout",
        true,
      ),
    ]);
    const worker = startWorker(store, scheduler);
    const queue = createScheduleQueue(redisConnectionOptions(redisUrl, 1));
    closeables.push(worker, queue);
    await worker.waitUntilReady();
    const cases = [
      { suffix: "infeasible", status: "succeeded" },
      { suffix: "validation", status: "failed" },
      { suffix: "protocol", status: "failed" },
      { suffix: "timeout", status: "timed_out" },
    ] as const;

    for (const testCase of cases) {
      const submitted = await submitJob(store, testCase.suffix);
      await queue.add("schedule-job", queueData(submitted.job.id), {
        jobId: scheduleQueueJobId(submitted.job.id),
      });
      await waitForJobStatus(store, submitted.job.id, testCase.status);
    }

    assert.equal(scheduler.calls, cases.length);
    assert.equal((await requireDb().db.select().from(scheduleJobAttempts)).length, cases.length);
    assert.equal((await requireDb().db.select().from(scheduleRuns)).length, 1);
  });

  it("reclaims a stalled delivery and rejects the stopped worker's late result", async () => {
    const store = new ScheduleJobStore(requireDb());
    const stoppedScheduler = new StoppedScheduler();
    const firstWorker = startWorker(store, stoppedScheduler, {
      lockDurationMs: 300,
      stalledIntervalMs: 300,
    });
    const queue = createScheduleQueue(redisConnectionOptions(redisUrl, 1));
    closeables.push(firstWorker, queue);
    await firstWorker.waitUntilReady();
    const submitted = await submitJob(store, "stalled");
    await queue.add("schedule-job", queueData(submitted.job.id), {
      jobId: scheduleQueueJobId(submitted.job.id),
    });
    await stoppedScheduler.started;
    await firstWorker.close(true);

    const recoveryScheduler = new SequencedScheduler([buildScheduleResult()]);
    const recoveryWorker = startWorker(store, recoveryScheduler, {
      lockDurationMs: 300,
      stalledIntervalMs: 300,
    });
    closeables.push(recoveryWorker);
    await recoveryWorker.waitUntilReady();
    try {
      await waitForJobStatus(store, submitted.job.id, "succeeded");
    } finally {
      stoppedScheduler.release();
    }
    await waitFor(async () => stoppedScheduler.released);

    const attempts = await requireDb().db.select().from(scheduleJobAttempts);
    assert.deepEqual(attempts.map((attempt) => attempt.status), ["failed", "succeeded"]);
    assert.equal(attempts[0]?.error?.code, "worker_delivery_reclaimed");
    assert.equal(recoveryScheduler.calls, 1);
    assert.equal((await requireDb().db.select().from(scheduleRuns)).length, 1);
  });
});

function startWorker(
  store: ScheduleJobStore,
  scheduler: SchedulerClient,
  options: {
    cancellationPollIntervalMs?: number;
    lockDurationMs?: number;
    stalledIntervalMs?: number;
  } = {},
): Worker<ScheduleQueueJobData> {
  const worker = createSchedulingWorker({
    repository: store,
    scheduler,
    connection: redisConnectionOptions(redisUrl, null),
    cancellationPollIntervalMs: options.cancellationPollIntervalMs,
    lockDurationMs: options.lockDurationMs,
    stalledIntervalMs: options.stalledIntervalMs,
  });
  worker.on("error", () => undefined);
  return worker;
}

class SequencedScheduler implements SchedulerClient {
  calls = 0;

  constructor(private readonly responses: Array<ScheduleResult | Error>) {}

  async solve(
    _input: ScheduleInput,
    options: SchedulerSolveOptions = {},
  ): Promise<ScheduleResult> {
    const response = this.responses[this.calls++];
    if (response instanceof Error) {
      throw response;
    }
    assert.ok(response);
    options.onMetadata?.({ schedulerVersion: "0.1.0-worker-test" });
    return structuredClone(response);
  }
}

class AbortableScheduler implements SchedulerClient {
  aborted = false;
  private markStarted!: () => void;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });

  async solve(
    _input: ScheduleInput,
    options: SchedulerSolveOptions = {},
  ): Promise<ScheduleResult> {
    this.markStarted();
    return new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => {
        this.aborted = true;
        reject(new SchedulerClientError(
          "Scheduler request was cancelled.",
          "cancelled",
          "scheduler_cancelled",
          false,
        ));
      }, { once: true });
    });
  }
}

class StoppedScheduler implements SchedulerClient {
  released = false;
  private markStarted!: () => void;
  private rejectSolve!: (error: Error) => void;
  readonly started = new Promise<void>((resolve) => {
    this.markStarted = resolve;
  });

  async solve(): Promise<ScheduleResult> {
    this.markStarted();
    return new Promise((_resolve, reject) => {
      this.rejectSolve = reject;
    });
  }

  release() {
    this.released = true;
    this.rejectSolve(new Error("Stopped worker released after recovery."));
  }
}

async function submitJob(store: ScheduleJobStore, suffix: string) {
  return new JobSubmissionService(store).submit({
    batchId: "batch-2026-spring-final",
    input: demoScheduleInput,
    idempotencyKey: `worker-${suffix}`,
    traceId: `trace-worker-${suffix}`,
  });
}

function queueData(jobId: string): ScheduleQueueJobData {
  return {
    jobId,
    outboxEventId: `outbox-${jobId}`,
    traceId: `trace-${jobId}`,
  };
}

async function waitForJobStatus(
  store: ScheduleJobStore,
  jobId: string,
  status: string,
) {
  await waitFor(async () => (await store.getScheduleJob(jobId))?.status === status);
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for worker state.");
}

function buildScheduleResult(): ScheduleResult {
  return {
    assignments: demoScheduleInput.exam_tasks.map((task, index) => ({
      exam_task_id: task.id,
      room_id: demoScheduleInput.rooms[index % demoScheduleInput.rooms.length].id,
      time_slot_id: demoScheduleInput.time_slots[index].id,
      teacher_ids: [demoScheduleInput.teachers[index % demoScheduleInput.teachers.length].id],
    })),
    conflicts: [],
    score: {
      total_score: 100,
      hard_violation_count: 0,
      soft_penalty_items: [],
      scoring_contract_version: 1,
      normalized_score: 100,
      total_raw_penalty: 0,
      total_weighted_penalty: 0,
      normalized_penalty_items: [],
    },
    statistics: {
      status: "feasible",
      elapsed_ms: 10,
      exam_count: demoScheduleInput.exam_tasks.length,
      room_count: demoScheduleInput.rooms.length,
      slot_count: demoScheduleInput.time_slots.length,
      attempted_assignments: demoScheduleInput.exam_tasks.length,
    },
    diagnostics: [],
    report: { summary: { status: "feasible" } },
  };
}

function requireDb() {
  assert.ok(dbClient);
  return dbClient;
}

function requireTestUrl(name: string, marker: string) {
  const value = process.env[name] ?? "";
  if (!value.includes(marker)) {
    throw new Error(`${name} must point to an isolated ${marker} instance.`);
  }
  return value;
}
