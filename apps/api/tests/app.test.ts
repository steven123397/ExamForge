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
  calls = 0;

  async solve(input: ScheduleInput): Promise<ScheduleResult> {
    this.lastInput = input;
    this.calls += 1;
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
        total_score: 90 + this.calls,
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
    assert.equal(created.result.score.total_score, 91);

    const readResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/${created.run.id}`,
    });

    assert.equal(readResponse.statusCode, 200);
    assert.equal(readResponse.json().run.id, created.run.id);
    await app.close();
  });

  it("lists schedule runs, audit events, and compares two runs", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });
    const first = firstResponse.json();
    const second = secondResponse.json();

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/schedule-runs",
    });
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(
      listResponse.json().runs.map((run: { id: string }) => run.id),
      [second.run.id, first.run.id],
    );

    const auditResponse = await app.inject({
      method: "GET",
      url: "/api/audit-events",
    });
    assert.equal(auditResponse.statusCode, 200);
    assert.equal(auditResponse.json().events.length, 2);
    assert.equal(auditResponse.json().events[0].action, "schedule_run.created");

    const compareResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/compare?baseId=${first.run.id}&targetId=${second.run.id}`,
    });
    assert.equal(compareResponse.statusCode, 200);
    assert.equal(compareResponse.json().baseRun.id, first.run.id);
    assert.equal(compareResponse.json().targetRun.id, second.run.id);
    assert.equal(compareResponse.json().deltas.score, 1);

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
        createReferenceRecord: (resource, record) => repository.createReferenceRecord(resource, record),
        updateReferenceRecord: (resource, id, patch) => repository.updateReferenceRecord(resource, id, patch),
        createScheduleRun: (result) => repository.createScheduleRun(result),
        listScheduleRuns: () => repository.listScheduleRuns(),
        getScheduleRun: (id) => repository.getScheduleRun(id),
        compareScheduleRuns: (baseId, targetId) => repository.compareScheduleRuns(baseId, targetId),
        listAuditEvents: () => repository.listAuditEvents(),
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

  it("creates and updates reference data records", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/reference-data/courses",
      payload: {
        id: "c-linear-algebra",
        name: "线性代数",
        department_id: "math",
        exam_type: "written",
      },
    });

    assert.equal(createResponse.statusCode, 201);
    assert.equal(createResponse.json().record.name, "线性代数");

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/api/reference-data/courses/c-linear-algebra",
      payload: {
        name: "线性代数 A",
        exam_type: "oral",
      },
    });

    assert.equal(updateResponse.statusCode, 200);
    assert.equal(updateResponse.json().record.name, "线性代数 A");
    assert.equal(updateResponse.json().record.exam_type, "oral");

    const referenceResponse = await app.inject({
      method: "GET",
      url: "/api/reference-data",
    });
    const courses = referenceResponse.json().scheduleInput.courses;
    assert.ok(courses.some((course: { id: string; name: string }) => (
      course.id === "c-linear-algebra" && course.name === "线性代数 A"
    )));

    await app.close();
  });

  it("rejects invalid reference data payloads", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const response = await app.inject({
      method: "POST",
      url: "/api/reference-data/rooms",
      payload: {
        id: "r-invalid",
        name: "容量错误考场",
        building_id: "test",
        capacity: -1,
        room_type: "standard",
        equipment_tags: [],
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_reference_data");

    await app.close();
  });
});
