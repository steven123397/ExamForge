import assert from "node:assert/strict";
import { createServer } from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  ScheduleJobStore,
  createDbClient,
  outboxEvents,
  runMigrations,
  seedDemoData,
  type ExamForgeDbClient,
} from "@examforge/db";
import { JobSubmissionService } from "@examforge/scheduling-application";
import { demoScheduleInput } from "@examforge/shared";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { PoolClient } from "pg";
import {
  OutboxPublisher,
  type ScheduleQueue,
} from "../src/outbox-publisher.js";
import {
  SCHEDULE_JOB_EVENT_CHANNEL,
  SCHEDULE_QUEUE_NAME,
  SCHEDULE_QUEUE_PREFIX,
} from "../src/queue.js";

const databaseUrl = requireTestUrl("TEST_DATABASE_URL", "test");
const redisUrl = requireTestUrl("TEST_REDIS_URL", "redis:");
let dbClient: ExamForgeDbClient | null = null;
let redis: IORedis | null = null;
const closeables: Array<{ close(): Promise<unknown> }> = [];

describe("outbox publisher", () => {
  beforeEach(async () => {
    dbClient = createDbClient(databaseUrl);
    await dbClient.pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await dbClient.pool.query("CREATE SCHEMA public");
    await runMigrations(dbClient);
    await seedDemoData(dbClient);
    redis = createRedis(redisUrl);
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

  it("does not publish an outbox row before its database transaction commits", async () => {
    const db = requireDb();
    const connection = await db.pool.connect();
    const queue = createQueue();
    const publisher = createPublisher(new ScheduleJobStore(db), queue);
    closeables.push(queue);

    try {
      await insertUncommittedOutbox(connection);

      const beforeCommit = await publisher.publishBatch();
      assert.equal(beforeCommit.claimed, 0);
      assert.equal(await queue.count(), 0);

      await connection.query("COMMIT");
      const afterCommit = await publisher.publishBatch();
      assert.equal(afterCommit.published, 1);
      assert.equal(await queue.count(), 1);
    } finally {
      await connection.query("ROLLBACK").catch(() => undefined);
      connection.release();
    }
  });

  it("marks delivered events published and keeps one BullMQ job on duplicate delivery", async () => {
    const db = requireDb();
    const store = new ScheduleJobStore(db);
    const submitted = await submitJob(store, "publisher-success");
    const queue = createQueue();
    closeables.push(queue);
    const publisher = createPublisher(store, queue);

    const first = await publisher.publishBatch();
    assert.deepEqual(first, { claimed: 1, published: 1, failed: 0 });
    assert.ok(await queue.getJob(`schedule-job-${submitted.job.id}`));
    const [published] = await db.db.select().from(outboxEvents);
    assert.ok(published.publishedAt);

    await db.pool.query(
      "UPDATE outbox_events SET published_at = NULL WHERE id = $1",
      [published.id],
    );
    const duplicate = await publisher.publishBatch();
    assert.equal(duplicate.published, 1);
    assert.equal(await queue.count(), 1);
  });

  it("leaves the row pending with a sanitized retry after Redis is unavailable", async () => {
    const now = new Date(Date.now() + 1_000);
    const db = requireDb();
    const store = new ScheduleJobStore(db);
    await submitJob(store, "publisher-unavailable");
    const resetServer = await createResetServer();
    closeables.push(resetServer);
    const unavailableConnection = new IORedis(`redis://127.0.0.1:${resetServer.port}`, {
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    unavailableConnection.on("error", () => undefined);
    const queue: ScheduleQueue = {
      async add() {
        await unavailableConnection.connect();
        await unavailableConnection.ping();
      },
    };
    closeables.push({
      async close() {
        unavailableConnection.disconnect();
      },
    });
    const publisher = new OutboxPublisher(store, {
      queue,
      publishEventId: async () => 0,
      batchSize: 10,
      now: () => now,
    });

    const result = await publisher.publishBatch();

    assert.deepEqual(result, { claimed: 1, published: 0, failed: 1 });
    const [pending] = await db.db.select().from(outboxEvents);
    assert.equal(pending.publishedAt, null);
    assert.equal(pending.attemptCount, 1);
    assert.equal(pending.lastError, "Outbox delivery failed.");
    assert.equal(pending.availableAt.toISOString(), new Date(now.getTime() + 1_000).toISOString());
  });

  it("uses SKIP LOCKED so concurrent publishers claim distinct rows", async () => {
    const db = requireDb();
    const firstStore = new ScheduleJobStore(db);
    const secondStore = new ScheduleJobStore(db);
    await submitJob(firstStore, "publisher-concurrent-1");
    await submitJob(firstStore, "publisher-concurrent-2");
    const queue = createQueue();
    closeables.push(queue);
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const delayedQueue: ScheduleQueue = {
      async add(name, data, options) {
        markFirstEntered();
        await release;
        return queue.add(name, data, options);
      },
    };
    const firstPublisher = createPublisher(firstStore, delayedQueue, 1);
    const secondPublisher = createPublisher(secondStore, queue, 1);

    const firstResult = firstPublisher.publishBatch();
    await firstEntered;
    const secondResult = await secondPublisher.publishBatch();
    releaseFirst();
    const completedFirst = await firstResult;

    assert.equal(completedFirst.published, 1);
    assert.equal(secondResult.published, 1);
    assert.equal(await queue.count(), 2);
  });
});

function createPublisher(
  store: ScheduleJobStore,
  queue: ScheduleQueue,
  batchSize = 10,
) {
  return new OutboxPublisher(store, {
    queue,
    publishEventId: (eventId) => requireRedis().publish(
      SCHEDULE_JOB_EVENT_CHANNEL,
      eventId,
    ),
    batchSize,
  });
}

function createQueue() {
  const parsed = new URL(redisUrl);
  return new Queue(SCHEDULE_QUEUE_NAME, {
    connection: {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      db: Number(parsed.pathname.slice(1) || 0),
      maxRetriesPerRequest: 1,
    },
    prefix: SCHEDULE_QUEUE_PREFIX,
    defaultJobOptions: {
      removeOnComplete: { count: 1_000 },
      removeOnFail: { count: 1_000 },
    },
  });
}

function createRedis(url: string) {
  const client = new IORedis(url, {
    maxRetriesPerRequest: 1,
  });
  client.on("error", () => undefined);
  return client;
}

async function createResetServer() {
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}

async function submitJob(store: ScheduleJobStore, suffix: string) {
  return new JobSubmissionService(store).submit({
    batchId: "batch-2026-spring-final",
    input: demoScheduleInput,
    idempotencyKey: `job-${suffix}`,
    traceId: `trace-${suffix}`,
  });
}

async function insertUncommittedOutbox(connection: PoolClient) {
  await connection.query("BEGIN");
  await connection.query(`
    INSERT INTO schedule_jobs (
      id, batch_id, status, progress, idempotency_key, request_digest,
      request_version, request_payload, constraint_profile_version_id,
      constraint_profile_snapshot, trace_id, queued_at, created_at, updated_at
    ) SELECT
      'job-uncommitted', 'batch-2026-spring-final', 'queued', 0,
      'job-uncommitted', $1, 1, $2::jsonb, version.id,
      jsonb_build_object(
        'schemaVersion', version.schema_version,
        'profileId', version.profile_id,
        'profileVersionId', version.id,
        'versionNumber', version.version_number,
        'digest', version.digest,
        'config', version.config
      ),
      'trace-uncommitted', now(), now(), now()
    FROM constraint_profile_versions AS version
    WHERE version.id = 'constraint-profile-default-v1'
  `, ["f".repeat(64), JSON.stringify({ version: 1, input: demoScheduleInput })]);
  const event = await connection.query<{ sequence: string }>(`
    INSERT INTO schedule_job_events (
      id, job_id, event_type, event_version, occurred_at, payload, trace_id
    ) VALUES (
      'event-uncommitted', 'job-uncommitted', 'schedule_job.queued', 1,
      now(), '{"status":"queued"}'::jsonb, 'trace-uncommitted'
    ) RETURNING sequence::text
  `);
  const envelope = {
    eventId: "event-uncommitted",
    sequence: Number(event.rows[0].sequence),
    jobId: "job-uncommitted",
    type: "schedule_job.queued",
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { status: "queued" },
    traceId: "trace-uncommitted",
  };
  await connection.query(`
    INSERT INTO outbox_events (
      id, event_id, aggregate_type, aggregate_id, event_type, event_version,
      payload, occurred_at, available_at
    ) VALUES (
      'outbox-uncommitted', 'event-uncommitted', 'schedule_job', 'job-uncommitted',
      'schedule_job.queued', 1, $1::jsonb, now(), now()
    )
  `, [JSON.stringify(envelope)]);
}

function requireDb() {
  assert.ok(dbClient);
  return dbClient;
}

function requireRedis() {
  assert.ok(redis);
  return redis;
}

function requireTestUrl(name: string, marker: string) {
  const value = process.env[name] ?? "";
  if (!value.includes(marker)) {
    throw new Error(`${name} must point to an isolated ${marker} instance.`);
  }
  return value;
}
