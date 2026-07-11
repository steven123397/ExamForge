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

  it("solves reschedule context through the Python CLI contract", async () => {
    const client = new PythonSchedulerClient();
    const baseline = await client.solve(demoScheduleInput);
    assert.equal(baseline.statistics.status, "feasible");

    const result = await client.solve({
      ...demoScheduleInput,
      constraint_profile: {
        ...demoScheduleInput.constraint_profile,
        soft_weights: {
          ...demoScheduleInput.constraint_profile.soft_weights,
          schedule_stability: 100,
        },
      },
      reschedule_context: {
        baseline_assignments: baseline.assignments,
        movable_exam_task_ids: ["e-data-structures"],
      },
    });

    assert.equal(result.statistics.status, "feasible");
    assert.deepEqual(result.report?.reschedule, {
      baseline_exam_count: demoScheduleInput.exam_tasks.length,
      frozen_exam_task_ids: [
        "e-ai",
        "e-calculus",
        "e-database",
        "e-english",
        "e-os",
      ],
      retained_exam_task_ids: [
        "e-ai",
        "e-calculus",
        "e-data-structures",
        "e-database",
        "e-english",
        "e-os",
      ],
      changed_exam_task_ids: [],
    });
  });

  it("adds scheduler command context when the process cannot start", async () => {
    const client = new PythonSchedulerClient("../scheduler", "definitely-missing-scheduler-executable");

    await assert.rejects(
      () => client.solve(demoScheduleInput),
      /failed to start scheduler process/,
    );
  });
});
