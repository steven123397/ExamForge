import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildScheduleRunApiQuery,
  readScheduleRunsPageState,
  updateScheduleRunsPageSearch,
} from "../features/run-history/run-page-model.js";
import {
  buildAuditEventApiQuery,
  readAuditPageState,
  updateAuditPageSearch,
} from "../features/run-history/audit-page-model.js";

describe("run and audit page models", () => {
  it("normalizes run filters, comparison target, inspector, and pagination", () => {
    const state = readScheduleRunsPageState(new URLSearchParams(
      "status=feasible&runId=run-2&compareTo=run-1&page=3&pageSize=50",
    ));
    assert.deepEqual(state, {
      status: "feasible",
      runId: "run-2",
      compareTo: "run-1",
      page: 3,
      pageSize: 50,
    });
    assert.deepEqual(buildScheduleRunApiQuery(state), {
      status: "feasible",
      page: 3,
      pageSize: 50,
    });
    assert.deepEqual(readScheduleRunsPageState(new URLSearchParams(
      "status=published&page=0&pageSize=200",
    )), {
      status: "all",
      runId: "",
      compareTo: "",
      page: 1,
      pageSize: 20,
    });
    assert.equal(updateScheduleRunsPageSearch(
      new URLSearchParams("status=feasible&page=4&runId=run-2"),
      { status: "all", page: 1, compareTo: "run-1" },
    ), "runId=run-2&compareTo=run-1");
  });

  it("normalizes complete audit filters and builds inclusive date bounds", () => {
    const state = readAuditPageState(new URLSearchParams(
      "actor=operator&action=schedule_run.created&entityType=schedule_run"
      + "&entityId=run-1&traceId=trace-1&from=2026-07-13&to=2026-07-14&page=2",
    ));
    assert.deepEqual(buildAuditEventApiQuery(state), {
      actor: "operator",
      action: "schedule_run.created",
      entityType: "schedule_run",
      entityId: "run-1",
      traceId: "trace-1",
      from: "2026-07-13T00:00:00.000Z",
      to: "2026-07-14T23:59:59.999Z",
      page: 2,
      pageSize: 20,
    });
    assert.equal(updateAuditPageSearch(
      new URLSearchParams("actor=operator&page=8&traceId=keep"),
      { actor: "", page: 1, action: "schedule_run.created" },
    ), "traceId=keep&action=schedule_run.created");
  });
});
