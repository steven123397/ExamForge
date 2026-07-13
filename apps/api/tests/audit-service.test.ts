import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AuditFilterValidationError,
  parseAuditEventFilter,
} from "../src/services/audit-service.js";

describe("audit service", () => {
  it("parses supported audit filters", () => {
    const filter = parseAuditEventFilter({
      entityType: "schedule_run",
      entityId: "run-1",
      actor: "system",
      action: "schedule_run.created",
      traceId: "trace-1",
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-07-08T00:00:00.000Z",
      page: "2",
      pageSize: "10",
    });

    assert.deepEqual(filter, {
      entityType: "schedule_run",
      entityId: "run-1",
      actor: "system",
      action: "schedule_run.created",
      traceId: "trace-1",
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-07-08T00:00:00.000Z",
      page: 2,
      pageSize: 10,
    });
  });

  it("rejects invalid audit filter dates", () => {
    assert.throws(
      () => parseAuditEventFilter({ from: "not-a-date" }),
      AuditFilterValidationError,
    );
    assert.throws(
      () => parseAuditEventFilter({
        from: "2026-07-08T00:00:00.000Z",
        to: "2026-07-07T00:00:00.000Z",
      }),
      /greater than or equal to from/,
    );
  });
});
