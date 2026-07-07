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
      since: "2026-07-07T00:00:00.000Z",
      until: "2026-07-08T00:00:00.000Z",
    });

    assert.deepEqual(filter, {
      entityType: "schedule_run",
      entityId: "run-1",
      actor: "system",
      since: "2026-07-07T00:00:00.000Z",
      until: "2026-07-08T00:00:00.000Z",
      limit: 50,
    });
  });

  it("rejects invalid audit filter dates", () => {
    assert.throws(
      () => parseAuditEventFilter({ since: "not-a-date" }),
      AuditFilterValidationError,
    );
    assert.throws(
      () => parseAuditEventFilter({
        since: "2026-07-08T00:00:00.000Z",
        until: "2026-07-07T00:00:00.000Z",
      }),
      /since must be earlier than until/,
    );
  });
});
