import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createHealthServer,
  type HealthServer,
} from "../src/health-server.js";
import { loadWorkerConfig } from "../src/config.js";

describe("worker health server", () => {
  it("separates process health from PostgreSQL and Redis readiness", async () => {
    let postgresReady = true;
    let redisReady = true;
    const server = createHealthServer({
      async checkPostgres() {
        if (!postgresReady) {
          throw new Error("postgres credentials leaked");
        }
      },
      async checkRedis() {
        if (!redisReady) {
          throw new Error("redis credentials leaked");
        }
      },
    }, { host: "127.0.0.1", port: 0, service: "examforge-publisher" });
    await server.start();
    try {
      assert.deepEqual(await getJson(server, "/health"), {
        status: 200,
        body: { ok: true, service: "examforge-publisher" },
      });
      assert.deepEqual(await getJson(server, "/ready"), {
        status: 200,
        body: { ok: true, service: "examforge-publisher" },
      });

      redisReady = false;
      const unavailable = await getJson(server, "/ready");
      assert.equal(unavailable.status, 503);
      assert.deepEqual(unavailable.body, {
        ok: false,
        service: "examforge-publisher",
        error: "dependency_unavailable",
      });
      assert.doesNotMatch(JSON.stringify(unavailable.body), /credentials leaked/);

      redisReady = true;
      postgresReady = false;
      assert.equal((await getJson(server, "/ready")).status, 503);
      assert.equal((await getJson(server, "/health")).status, 200);
    } finally {
      await server.close();
    }
  });

  it("requires explicit PostgreSQL and Redis URLs", () => {
    assert.throws(() => loadWorkerConfig({}), /DATABASE_URL/);
    assert.throws(() => loadWorkerConfig({ DATABASE_URL: "postgres://db/test" }), /REDIS_URL/);
    assert.deepEqual(loadWorkerConfig({
      DATABASE_URL: "postgres://db/examforge",
      REDIS_URL: "redis://redis:6379/0",
      SCHEDULER_BASE_URL: "http://scheduler:8000",
      WORKER_HEALTH_PORT: "4011",
      OUTBOX_BATCH_SIZE: "50",
    }), {
      role: "worker",
      databaseUrl: "postgres://db/examforge",
      redisUrl: "redis://redis:6379/0",
      schedulerBaseUrl: "http://scheduler:8000",
      schedulerTimeoutMs: 35000,
      healthHost: "0.0.0.0",
      healthPort: 4011,
      outboxBatchSize: 50,
      outboxPollIntervalMs: 500,
      cancellationPollIntervalMs: 250,
      maxAttempts: 6,
      retryBaseDelayMs: 1_000,
      lockDurationMs: 30_000,
      stalledIntervalMs: 30_000,
    });
    assert.throws(() => loadWorkerConfig({
      DATABASE_URL: "postgres://db/examforge",
      REDIS_URL: "redis://redis:6379/0",
      SCHEDULER_BASE_URL: "http://scheduler:8000",
      WORKER_CONCURRENCY: "2",
    }), /fixed at 1/);
  });
});

async function getJson(server: HealthServer, path: string) {
  const response = await fetch(`${server.url}${path}`);
  return {
    status: response.status,
    body: await response.json(),
  };
}
