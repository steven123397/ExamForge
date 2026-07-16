import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadWorkerConfig } from "../src/config.js";

const requiredEnvironment = {
  DATABASE_URL: "postgres://examforge:examforge@localhost:5432/examforge_test",
  REDIS_URL: "redis://localhost:6379/0",
  SCHEDULER_BASE_URL: "http://localhost:8000",
};

describe("worker configuration", () => {
  it("uses production-safe retry and BullMQ lock defaults", () => {
    const config = loadWorkerConfig(requiredEnvironment);

    assert.equal(config.maxAttempts, 6);
    assert.equal(config.retryBaseDelayMs, 1_000);
    assert.equal(config.lockDurationMs, 30_000);
    assert.equal(config.stalledIntervalMs, 30_000);
  });

  it("accepts a bounded shared retry policy", () => {
    const config = loadWorkerConfig({
      ...requiredEnvironment,
      SCHEDULE_JOB_MAX_ATTEMPTS: "5",
      SCHEDULE_JOB_RETRY_BASE_DELAY_MS: "1500",
    });

    assert.equal(config.maxAttempts, 5);
    assert.equal(config.retryBaseDelayMs, 1_500);
  });

  it("rejects a retry policy whose final exponential delay exceeds 30 seconds", () => {
    assert.throws(() => loadWorkerConfig({
      ...requiredEnvironment,
      SCHEDULE_JOB_MAX_ATTEMPTS: "6",
      SCHEDULE_JOB_RETRY_BASE_DELAY_MS: "2000",
    }), /final retry delay must not exceed 30000 ms/);
  });

  it("rejects a retry policy above the maximum attempt count", () => {
    assert.throws(() => loadWorkerConfig({
      ...requiredEnvironment,
      SCHEDULE_JOB_MAX_ATTEMPTS: "11",
      SCHEDULE_JOB_RETRY_BASE_DELAY_MS: "1",
    }), /SCHEDULE_JOB_MAX_ATTEMPTS must be an integer between 2 and 10/);
  });

  it("accepts positive lock and stalled intervals for isolated fault drills", () => {
    const config = loadWorkerConfig({
      ...requiredEnvironment,
      WORKER_LOCK_DURATION_MS: "5000",
      WORKER_STALLED_INTERVAL_MS: "5000",
    });

    assert.equal(config.lockDurationMs, 5_000);
    assert.equal(config.stalledIntervalMs, 5_000);
  });

  it("rejects invalid lock timing", () => {
    assert.throws(() => loadWorkerConfig({
      ...requiredEnvironment,
      WORKER_LOCK_DURATION_MS: "0",
    }), /WORKER_LOCK_DURATION_MS must be a positive integer/);
  });
});
