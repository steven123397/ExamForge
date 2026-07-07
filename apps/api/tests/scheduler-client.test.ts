import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoScheduleInput, scheduleResultSchema } from "@examforge/shared";
import { PythonSchedulerClient } from "../src/scheduler-client.js";

describe("PythonSchedulerClient", () => {
  it("solves shared demo input through the Python CLI contract", async () => {
    const client = new PythonSchedulerClient();

    const result = await client.solve(demoScheduleInput);
    const parsed = scheduleResultSchema.parse(result);

    assert.equal(parsed.statistics.exam_count, demoScheduleInput.exam_tasks.length);
    assert.equal(parsed.statistics.room_count, demoScheduleInput.rooms.length);
    assert.equal(parsed.statistics.slot_count, demoScheduleInput.time_slots.length);
    assert.ok(Array.isArray(parsed.assignments));
    assert.ok(Array.isArray(parsed.conflicts));
    assert.equal(typeof parsed.score.total_score, "number");
    assert.ok("report" in parsed);
  });

  it("adds scheduler command context when the process cannot start", async () => {
    const client = new PythonSchedulerClient("../scheduler", "definitely-missing-scheduler-executable");

    await assert.rejects(
      () => client.solve(demoScheduleInput),
      /failed to start scheduler process/,
    );
  });
});
