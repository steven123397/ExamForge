import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditEventListQuerySchema,
  scheduleJobListQuerySchema,
  scheduleRunListQuerySchema,
} from "../src/index.js";

describe("paginated list contracts", () => {
  it("normalizes schedule job filters and bounded pagination", () => {
    assert.deepEqual(scheduleJobListQuerySchema.parse({}), {
      page: 1,
      pageSize: 20,
    });
    assert.deepEqual(scheduleJobListQuerySchema.parse({
      status: "failed",
      submittedBy: "operator",
      constraintProfileVersionId: "profile-v2",
      from: "2026-07-13T00:00:00.000Z",
      to: "2026-07-14T00:00:00.000Z",
      page: "2",
      pageSize: "50",
    }), {
      status: "failed",
      submittedBy: "operator",
      constraintProfileVersionId: "profile-v2",
      from: "2026-07-13T00:00:00.000Z",
      to: "2026-07-14T00:00:00.000Z",
      page: 2,
      pageSize: 50,
    });
    assert.throws(() => scheduleJobListQuerySchema.parse({ page: 0 }));
    assert.throws(() => scheduleJobListQuerySchema.parse({ pageSize: 101 }));
    assert.throws(() => scheduleJobListQuerySchema.parse({ from: "not-a-date" }));
    assert.throws(() => scheduleJobListQuerySchema.parse({
      from: "2026-07-14T00:00:00.000Z",
      to: "2026-07-13T00:00:00.000Z",
    }));
  });

  it("normalizes schedule run status and pagination", () => {
    assert.deepEqual(scheduleRunListQuerySchema.parse({}), { page: 1, pageSize: 20 });
    assert.deepEqual(scheduleRunListQuerySchema.parse({
      status: "feasible",
      page: "3",
      pageSize: "50",
    }), {
      status: "feasible",
      page: 3,
      pageSize: 50,
    });
    assert.throws(() => scheduleRunListQuerySchema.parse({ status: "published" }));
    assert.throws(() => scheduleRunListQuerySchema.parse({ pageSize: 101 }));
  });

  it("normalizes complete audit filters and date bounds", () => {
    assert.deepEqual(auditEventListQuerySchema.parse({
      actor: " operator ",
      action: "schedule_run.created",
      entityType: "schedule_run",
      entityId: "run-1",
      traceId: "trace-1",
      from: "2026-07-13T00:00:00.000Z",
      to: "2026-07-14T00:00:00.000Z",
      page: "2",
      pageSize: "100",
    }), {
      actor: "operator",
      action: "schedule_run.created",
      entityType: "schedule_run",
      entityId: "run-1",
      traceId: "trace-1",
      from: "2026-07-13T00:00:00.000Z",
      to: "2026-07-14T00:00:00.000Z",
      page: 2,
      pageSize: 100,
    });
    assert.throws(() => auditEventListQuerySchema.parse({ from: "invalid" }));
    assert.throws(() => auditEventListQuerySchema.parse({
      from: "2026-07-15T00:00:00.000Z",
      to: "2026-07-14T00:00:00.000Z",
    }));
  });
});
