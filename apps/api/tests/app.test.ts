import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ScheduleInput,
  type ScheduleResult,
} from "@examforge/shared";
import { createApp } from "../src/app.js";
import { InMemoryPlatformRepository } from "../src/repository.js";
import type { SchedulerClient } from "../src/scheduler-client.js";

class FakeScheduler implements SchedulerClient {
  lastInput: ScheduleInput | null = null;

  async solve(input: ScheduleInput): Promise<ScheduleResult> {
    this.lastInput = input;
    return {
      assignments: [
        {
          exam_task_id: input.exam_tasks[0].id,
          room_id: input.rooms[0].id,
          time_slot_id: input.time_slots[0].id,
          teacher_ids: [input.teachers[0].id],
        },
      ],
      conflicts: [],
      score: {
        total_score: 96,
        hard_violation_count: 0,
        soft_penalty_items: [],
      },
      statistics: {
        status: "feasible",
        elapsed_ms: 18,
        exam_count: input.exam_tasks.length,
        room_count: input.rooms.length,
        slot_count: input.time_slots.length,
        attempted_assignments: 42,
      },
      report: {
        summary: {
          status: "feasible",
        },
      },
    };
  }
}

describe("ExamForge API", () => {
  it("returns dashboard data", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.batch.name, "2026 春季期末考试");
    assert.equal(body.metrics.examTaskCount, 6);
    await app.close();
  });

  it("creates and reads a schedule run", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });

    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json();
    assert.equal(created.run.status, "feasible");
    assert.equal(created.result.score.total_score, 96);

    const readResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/${created.run.id}`,
    });

    assert.equal(readResponse.statusCode, 200);
    assert.equal(readResponse.json().run.id, created.run.id);
    await app.close();
  });

  it("uses reference data from the configured repository when creating a schedule run", async () => {
    const scheduler = new FakeScheduler();
    const repository = new InMemoryPlatformRepository();
    const referenceData = structuredClone(await repository.getReferenceData());
    referenceData.scheduleInput.exam_tasks = [referenceData.scheduleInput.exam_tasks[0]];

    const app = createApp({
      scheduler,
      repository: {
        ...repository,
        getDashboard: () => repository.getDashboard(),
        getReferenceData: async () => referenceData,
        createScheduleRun: (result) => repository.createScheduleRun(result),
        getScheduleRun: (id) => repository.getScheduleRun(id),
      },
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });

    assert.equal(createResponse.statusCode, 201);
    assert.equal(scheduler.lastInput?.exam_tasks.length, 1);
    await app.close();
  });
});
