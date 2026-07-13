import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoScheduleInput } from "@examforge/shared";
import {
  HttpSchedulerClient,
  SchedulerClientError,
} from "../src/index.js";

describe("HTTP scheduler client", () => {
  it("validates successful responses and classifies service unavailability", async () => {
    const client = new HttpSchedulerClient({
      baseUrl: "http://scheduler:8000",
      fetch: async (_input, init) => {
        assert.equal(new Headers(init?.headers).get("x-request-id"), "trace-http-1");
        return Response.json(buildResult(), {
          headers: { "x-scheduler-version": "0.1.0-test" },
        });
      },
    });

    let schedulerVersion = "";
    const result = await client.solve(demoScheduleInput, {
      requestId: "trace-http-1",
      onMetadata: (metadata) => {
        schedulerVersion = metadata.schedulerVersion;
      },
    });
    assert.equal(result.statistics.status, "feasible");
    assert.equal(schedulerVersion, "0.1.0-test");

    const unavailable = new HttpSchedulerClient({
      baseUrl: "http://scheduler:8000",
      fetch: async () => {
        throw new TypeError("connect failed");
      },
    });
    await assert.rejects(
      unavailable.solve(demoScheduleInput),
      (error: unknown) => {
        assert.ok(error instanceof SchedulerClientError);
        assert.equal(error.category, "unavailable");
        assert.equal(error.retryable, true);
        return true;
      },
    );
  });
});

function buildResult() {
  return {
    assignments: [],
    conflicts: [],
    score: {
      total_score: 100,
      hard_violation_count: 0,
      soft_penalty_items: [],
    },
    statistics: {
      status: "feasible",
      elapsed_ms: 1,
      exam_count: 0,
      room_count: 0,
      slot_count: 0,
      attempted_assignments: 0,
    },
  };
}
