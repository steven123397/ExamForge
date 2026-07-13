import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  authContextSchema,
  constraintProfileSnapshotSchema,
  constraintProfileVersionSchema,
  resolveScheduleJobTransition,
  scheduleDiagnosticSchema,
  scheduleJobAttemptSchema,
  scheduleJobErrorCategorySchema,
  scheduleJobEventEnvelopeSchema,
  scheduleJobRequestSnapshotSchema,
  scheduleJobStatuses,
  scheduleJobStatusForSolveResult,
  scoreBreakdownSchema,
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
      ["running", "queued"],
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

  it("preserves scheduler HTTP failure categories in persisted job errors", () => {
    for (const category of [
      "validation",
      "timeout",
      "cancelled",
      "unavailable",
      "protocol",
      "internal",
    ]) {
      assert.equal(scheduleJobErrorCategorySchema.parse(category), category);
    }
  });

  it("validates a versioned event envelope with trace correlation", () => {
    const event = scheduleJobEventEnvelopeSchema.parse({
      eventId: "event-1",
      sequence: 1,
      jobId: "job-1",
      type: "schedule_job.succeeded",
      version: 1,
      occurredAt: "2026-07-12T08:00:00.000Z",
      payload: { runId: "run-1" },
      traceId: "trace-1",
    });

    assert.equal(event.payload.runId, "run-1");
    assert.throws(() => scheduleJobEventEnvelopeSchema.parse({ ...event, version: 2 }));
    assert.throws(() => scheduleJobEventEnvelopeSchema.parse({ ...event, sequence: 0 }));
  });

  it("freezes a versioned complete schedule input snapshot", () => {
    const constraintProfile = {
      schemaVersion: 1 as const,
      profileId: "constraint-profile-default",
      profileVersionId: "constraint-profile-default-v1",
      versionNumber: 1,
      digest: "a".repeat(64),
      config: {
        hard_rules: [],
        soft_weights: {},
        time_limit_seconds: 30,
      },
    };
    const snapshot = scheduleJobRequestSnapshotSchema.parse({
      version: 2,
      input: {
        student_groups: [],
        teachers: [],
        courses: [],
        rooms: [],
        time_slots: [],
        exam_tasks: [],
        constraint_profile: constraintProfile.config,
        fixed_assignments: [],
        reschedule_context: null,
      },
      constraintProfile,
    });

    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.constraintProfile.profileVersionId, "constraint-profile-default-v1");
    assert.equal(scheduleJobRequestSnapshotSchema.parse({
      version: 1,
      input: snapshot.input,
    }).version, 1);
    assert.throws(() => scheduleJobRequestSnapshotSchema.parse({
      ...snapshot,
      version: 0,
    }));
  });

  it("validates durable attempt outcomes and timing", () => {
    const attempt = scheduleJobAttemptSchema.parse({
      id: "attempt-1",
      jobId: "job-1",
      attemptNumber: 1,
      status: "failed",
      schedulerRequestId: "trace-1:attempt:1",
      startedAt: "2026-07-13T08:00:00.000Z",
      finishedAt: "2026-07-13T08:00:01.000Z",
      durationMs: 1000,
      error: {
        category: "unavailable",
        code: "scheduler_unavailable",
        message: "Scheduler service is unavailable.",
        retryable: true,
      },
    });

    assert.equal(attempt.status, "failed");
    assert.throws(() => scheduleJobAttemptSchema.parse({
      ...attempt,
      status: "retry_scheduled",
    }));
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

describe("constraint strategy and scoring contracts", () => {
  const config = {
    hard_rules: ["room_time_unique"],
    soft_weights: { room_utilization: 30 },
    time_limit_seconds: 30,
  };

  it("validates immutable strategy versions and frozen job snapshots", () => {
    const version = constraintProfileVersionSchema.parse({
      id: "profile-version-2",
      profileId: "profile-default",
      versionNumber: 2,
      schemaVersion: 1,
      digest: "a".repeat(64),
      config,
      createdByUserId: "user-admin",
      createdAt: "2026-07-14T08:00:00.000Z",
    });
    const snapshot = constraintProfileSnapshotSchema.parse({
      schemaVersion: 1,
      profileId: version.profileId,
      profileVersionId: version.id,
      versionNumber: version.versionNumber,
      digest: version.digest,
      config: version.config,
    });

    assert.equal(snapshot.profileVersionId, version.id);
    assert.throws(() => constraintProfileVersionSchema.parse({
      ...version,
      digest: "not-a-digest",
    }));
    assert.throws(() => constraintProfileSnapshotSchema.parse({
      ...snapshot,
      schemaVersion: 2,
    }));
  });

  it("keeps legacy penalty facts alongside normalized scoring", () => {
    const score = scoreBreakdownSchema.parse({
      total_score: 70,
      hard_violation_count: 0,
      soft_penalty_items: [{
        rule: "room_utilization",
        penalty: 30,
        message: "one room assignment is under-utilized",
      }],
      scoring_contract_version: 1,
      normalized_score: 50,
      total_raw_penalty: 1,
      total_weighted_penalty: 30,
      normalized_penalty_items: [{
        rule: "room_utilization",
        violation_count: 1,
        weight: 30,
        raw_penalty: 1,
        weighted_penalty: 30,
        opportunity_count: 2,
        normalized_penalty: 0.5,
      }],
    });

    assert.equal(score.soft_penalty_items[0].penalty, 30);
    assert.equal(score.normalized_penalty_items[0].normalized_penalty, 0.5);
    assert.throws(() => scoreBreakdownSchema.parse({
      ...score,
      normalized_score: 101,
    }));
  });

  it("validates stable resource diagnostics independently from display text", () => {
    const diagnostic = scheduleDiagnosticSchema.parse({
      code: "room_capacity_shortage",
      severity: "error",
      resource_dimension: "room",
      affected_ids: ["e-1"],
      shortfall: 20,
      message: "Room capacity is insufficient.",
      suggestion: "Add a larger room.",
    });

    assert.equal(diagnostic.code, "room_capacity_shortage");
    assert.throws(() => scheduleDiagnosticSchema.parse({
      ...diagnostic,
      resource_dimension: "free_text",
    }));
  });
});
