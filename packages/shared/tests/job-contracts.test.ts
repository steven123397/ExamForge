import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authContextSchema,
  resolveScheduleJobTransition,
  scheduleJobEventEnvelopeSchema,
  scheduleJobStatuses,
  scheduleJobStatusForSolveResult,
  sessionSummarySchema,
  userSummarySchema,
  type ScheduleJobStatus,
} from "../src/index.js";

describe("schedule job contracts", () => {
  it("freezes the fifth-version infrastructure statuses", () => {
    assert.deepEqual(scheduleJobStatuses, [
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "timed_out",
    ]);
  });

  it("accepts every legal state transition", () => {
    const legalTransitions: Array<[ScheduleJobStatus, ScheduleJobStatus]> = [
      ["queued", "running"],
      ["queued", "failed"],
      ["queued", "cancelled"],
      ["queued", "timed_out"],
      ["running", "succeeded"],
      ["running", "failed"],
      ["running", "cancelled"],
      ["running", "timed_out"],
    ];

    for (const [current, next] of legalTransitions) {
      assert.equal(resolveScheduleJobTransition(current, next), "apply", `${current} -> ${next}`);
    }
  });

  it("rejects illegal transitions and terminal rollback", () => {
    const illegalTransitions: Array<[ScheduleJobStatus, ScheduleJobStatus]> = [
      ["queued", "succeeded"],
      ["running", "queued"],
      ["succeeded", "running"],
      ["failed", "running"],
      ["cancelled", "running"],
      ["timed_out", "running"],
    ];

    for (const [current, next] of illegalTransitions) {
      assert.equal(resolveScheduleJobTransition(current, next), "reject", `${current} -> ${next}`);
    }
  });

  it("treats duplicate terminal callbacks as idempotent", () => {
    for (const status of ["succeeded", "failed", "cancelled", "timed_out"] as const) {
      assert.equal(resolveScheduleJobTransition(status, status), "idempotent");
    }
  });

  it("lets only the first cancellation or timeout terminal state win", () => {
    assert.equal(resolveScheduleJobTransition("queued", "cancelled"), "apply");
    assert.equal(resolveScheduleJobTransition("cancelled", "timed_out"), "reject");
    assert.equal(resolveScheduleJobTransition("running", "timed_out"), "apply");
    assert.equal(resolveScheduleJobTransition("timed_out", "cancelled"), "reject");
  });

  it("classifies infeasible solver output as a successful infrastructure run", () => {
    assert.equal(scheduleJobStatusForSolveResult("feasible"), "succeeded");
    assert.equal(scheduleJobStatusForSolveResult("partial"), "succeeded");
    assert.equal(scheduleJobStatusForSolveResult("infeasible"), "succeeded");
    assert.equal(scheduleJobStatusForSolveResult("error"), "failed");
  });

  it("validates a versioned event envelope with trace correlation", () => {
    const event = scheduleJobEventEnvelopeSchema.parse({
      eventId: "event-1",
      jobId: "job-1",
      type: "schedule_job.succeeded",
      version: 1,
      occurredAt: "2026-07-12T08:00:00.000Z",
      payload: { runId: "run-1" },
      traceId: "trace-1",
    });

    assert.equal(event.payload.runId, "run-1");
    assert.throws(() => scheduleJobEventEnvelopeSchema.parse({ ...event, version: 2 }));
  });
});

describe("identity contracts", () => {
  const user = {
    id: "user-1",
    username: "scheduler.admin",
    displayName: "Scheduler Admin",
    active: true,
    roles: ["admin"],
  };
  const session = {
    id: "session-1",
    userId: "user-1",
    createdAt: "2026-07-12T08:00:00.000Z",
    expiresAt: "2026-07-12T20:00:00.000Z",
  };

  it("accepts the minimal public user, session and authentication context", () => {
    assert.deepEqual(userSummarySchema.parse(user), user);
    assert.deepEqual(sessionSummarySchema.parse(session), session);
    assert.deepEqual(authContextSchema.parse({ user, session }), { user, session });
  });

  it("rejects internal password and session digest fields in public DTOs", () => {
    assert.throws(() => userSummarySchema.parse({ ...user, passwordHash: "secret" }));
    assert.throws(() => sessionSummarySchema.parse({ ...session, tokenDigest: "secret" }));
  });
});
