import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoScheduleInput } from "@examforge/shared";
import { createApp as createProductionApp, type AppOptions } from "../src/app.js";
import { InMemoryPlatformRepository, type PlatformRepository } from "../src/repository.js";
import { hashSessionToken } from "../src/auth/security.js";
import type { SchedulerClient } from "../src/scheduler-client.js";
import { buildTestAuthUsers, testAuthHeaders, testSessionTokens } from "./test-fixtures.js";

const adminHeaders = testAuthHeaders.admin;
const operatorHeaders = testAuthHeaders.operator;
const teacherHeaders = testAuthHeaders.teacher;
const studentHeaders = testAuthHeaders.student;
const testAuthUsers = await buildTestAuthUsers();
const seededRepositories = new WeakSet<PlatformRepository>();

const [firstExamTask, secondExamTask] = demoScheduleInput.exam_tasks;

function createApp(options: AppOptions = {}) {
  const repository = options.repository
    ?? new InMemoryPlatformRepository({ authUsers: testAuthUsers });
  seedRepositorySessions(repository);
  return createProductionApp({ ...options, repository });
}

function seedRepositorySessions(repository: PlatformRepository) {
  if (seededRepositories.has(repository)) {
    return;
  }
  seededRepositories.add(repository);
  for (const user of testAuthUsers) {
    void repository.createAuthUser(user).catch(() => undefined);
  }
  for (const role of ["admin", "operator", "teacher", "student"] as const) {
    void repository.createAuthSession({
      id: `test-${role}-session`,
      userId: `user-${role}`,
      tokenDigest: hashSessionToken(testSessionTokens[role]),
      createdAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2099-07-12T00:00:00.000Z",
      userAgent: "ExamForge test fixture",
      ipAddress: "127.0.0.1",
      credentialVersion: 1,
    });
  }
}

async function switchToEnrollments(app: ReturnType<typeof createApp>) {
  const response = await app.inject({
    method: "PUT",
    url: "/api/participants/mode",
    headers: adminHeaders,
    payload: { mode: "enrollments" },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

function buildImportPayload() {
  return {
    students: [
      { id: "S000001", display_code: "2026-CS-0001", primary_student_group_id: "g-cs-2301" },
      { id: "S000002", display_code: "2026-CS-0002", primary_student_group_id: "g-cs-2301" },
      { id: "S000003" },
    ],
    enrollments: [
      { exam_task_id: firstExamTask.id, student_id: "S000001", source: "regular" },
      { exam_task_id: firstExamTask.id, student_id: "S000002", source: "elective" },
      { exam_task_id: secondExamTask.id, student_id: "S000001", source: "retake" },
      { exam_task_id: secondExamTask.id, student_id: "S000003", source: "regular" },
    ],
  };
}

describe("participant data governance", () => {
  it("keeps enrollment data away from teachers and students", async () => {
    const app = createApp();

    for (const headers of [teacherHeaders, studentHeaders]) {
      const summary = await app.inject({
        method: "GET",
        url: "/api/participants",
        headers,
      });
      assert.equal(summary.statusCode, 403);
      assert.equal(summary.json().error, "permission_denied");

      const importResponse = await app.inject({
        method: "POST",
        url: "/api/participants/import",
        headers,
        payload: buildImportPayload(),
      });
      assert.equal(importResponse.statusCode, 403);

      const sealResponse = await app.inject({
        method: "POST",
        url: "/api/participants/seal",
        headers,
      });
      assert.equal(sealResponse.statusCode, 403);
    }

    await app.close();
  });

  it("lets operators read the health summary but never mutate participant data", async () => {
    const app = createApp();

    const summary = await app.inject({
      method: "GET",
      url: "/api/participants",
      headers: operatorHeaders,
    });
    assert.equal(summary.statusCode, 200);
    assert.equal(summary.json().participants.mode, "groups_only");

    for (const request of [
      { method: "PUT" as const, url: "/api/participants/mode", payload: { mode: "enrollments" } },
      { method: "POST" as const, url: "/api/participants/import", payload: buildImportPayload() },
      { method: "POST" as const, url: "/api/participants/seal", payload: undefined },
      { method: "POST" as const, url: "/api/participants/reopen", payload: undefined },
    ]) {
      const response = await app.inject({
        method: request.method,
        url: request.url,
        headers: operatorHeaders,
        payload: request.payload,
      });
      assert.equal(response.statusCode, 403, `${request.method} ${request.url}`);
    }

    await app.close();
  });

  it("reports a groups_only batch as not_required without participant digest", async () => {
    const app = createApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/participants",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 200);
    const { participants } = response.json();
    assert.equal(participants.mode, "groups_only");
    assert.equal(participants.status, "not_required");
    assert.equal(participants.dataVersion, 0);
    assert.equal(participants.digest, null);
    assert.equal(participants.studentCount, 0);
    assert.equal(participants.activeEnrollmentCount, 0);
    assert.equal(participants.overlapEdgeCount, 0);

    await app.close();
  });

  it("refuses enrollment imports while the batch stays in groups_only mode", async () => {
    const app = createApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: buildImportPayload(),
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "participant_mode_invalid");

    await app.close();
  });

  it("moves the batch into draft when the participant mode changes", async () => {
    const app = createApp();

    const changed = await switchToEnrollments(app);
    assert.equal(changed.participants.mode, "enrollments");
    assert.equal(changed.participants.status, "draft");
    assert.equal(changed.participants.dataVersion, 1);
    assert.equal(changed.participants.digest, null);

    const repeated = await app.inject({
      method: "PUT",
      url: "/api/participants/mode",
      headers: adminHeaders,
      payload: { mode: "enrollments" },
    });
    assert.equal(repeated.statusCode, 200);
    assert.equal(
      repeated.json().participants.dataVersion,
      1,
      "an unchanged mode must not burn a participant version",
    );

    await app.close();
  });

  it("imports students and enrollments atomically and bumps the participant version", async () => {
    const app = createApp();
    await switchToEnrollments(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: buildImportPayload(),
    });

    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.deepEqual(body.imported, { students: 3, enrollments: 4 });
    assert.equal(body.participants.status, "draft");
    assert.equal(body.participants.dataVersion, 2);
    assert.equal(body.participants.digest, null);
    assert.equal(body.participants.studentCount, 3);
    assert.equal(body.participants.activeEnrollmentCount, 4);
    assert.equal(body.participants.coveredExamTaskCount, 2);
    assert.equal(body.participants.overlapEdgeCount, 1);

    await app.close();
  });

  it("rejects the whole import when a single row is invalid", async () => {
    const app = createApp();
    await switchToEnrollments(app);

    const payload = buildImportPayload();
    payload.enrollments.push({
      exam_task_id: "exam-task-missing",
      student_id: "S000001",
      source: "regular",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload,
    });

    assert.equal(response.statusCode, 400);
    const body = response.json();
    assert.equal(body.error, "invalid_participant_import");
    assert.deepEqual(body.issues, [
      {
        index: 4,
        path: "enrollments.4.exam_task_id",
        code: "exam_task_reference_invalid",
        message: "exam_task_id exam-task-missing does not exist in the current batch",
      },
    ]);

    const summary = await app.inject({
      method: "GET",
      url: "/api/participants",
      headers: adminHeaders,
    });
    assert.equal(summary.json().participants.dataVersion, 1, "a failed import must not bump");
    assert.equal(summary.json().participants.studentCount, 0, "a failed import writes nothing");

    await app.close();
  });

  it("returns stable row level issues for duplicates and unknown references", async () => {
    const app = createApp();
    await switchToEnrollments(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: {
        students: [
          { id: "S000001", primary_student_group_id: "group-missing" },
          { id: "S000001" },
        ],
        enrollments: [
          { exam_task_id: firstExamTask.id, student_id: "S000001" },
          { exam_task_id: firstExamTask.id, student_id: "S000001" },
          { exam_task_id: firstExamTask.id, student_id: "S999999" },
        ],
      },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(
      response.json().issues.map((issue: { code: string; path: string }) => ({
        code: issue.code,
        path: issue.path,
      })),
      [
        { code: "student_group_reference_invalid", path: "students.0.primary_student_group_id" },
        { code: "student_duplicate", path: "students.1.id" },
        { code: "enrollment_duplicate", path: "enrollments.1" },
        { code: "student_reference_invalid", path: "enrollments.2.student_id" },
      ],
    );

    await app.close();
  });

  it("rejects duplicate display codes before any participant data is written", async () => {
    const app = createApp();
    await switchToEnrollments(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: {
        students: [
          { id: "S000001", display_code: "2026-CS-DUP" },
          { id: "S000002", display_code: "2026-CS-DUP" },
        ],
        enrollments: [],
      },
    });

    assert.equal(response.statusCode, 400, response.body);
    assert.deepEqual(response.json().issues, [{
      index: 1,
      path: "students.1.display_code",
      code: "student_duplicate",
      message: "display_code 2026-CS-DUP appears more than once in the payload",
    }]);

    const summary = await app.inject({
      method: "GET",
      url: "/api/participants",
      headers: adminHeaders,
    });
    assert.equal(summary.json().participants.dataVersion, 1, "a rejected import must not bump");
    assert.equal(summary.json().participants.studentCount, 0, "a rejected import writes no students");

    await app.close();
  });

  it("rejects student payloads that carry real personal information", async () => {
    const app = createApp();
    await switchToEnrollments(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: {
        students: [{ id: "S000001", name: "张三", phone: "13800000000" }],
        enrollments: [],
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_participant_payload");

    await app.close();
  });

  it("writes participant audit events without any roster payload", async () => {
    const app = createApp();
    await switchToEnrollments(app);
    await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: buildImportPayload(),
    });

    const audits = await app.inject({
      method: "GET",
      url: "/api/audit-events?entityType=participant_data",
      headers: adminHeaders,
    });

    assert.equal(audits.statusCode, 200);
    const events = audits.json().events as Array<{
      action: string;
      actor: string;
      payload: Record<string, unknown>;
    }>;
    const actions = events.map((event) => event.action).sort();
    assert.deepEqual(actions, ["participant.import", "participant.mode.change"]);
    const importEvent = events.find((event) => event.action === "participant.import");
    assert.equal(importEvent?.actor, "admin");
    assert.deepEqual(Object.keys(importEvent?.payload ?? {}).sort(), [
      "enrollmentCount",
      "mode",
      "previousStatus",
      "previousVersion",
      "status",
      "studentCount",
      "traceId",
      "version",
    ]);
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes("S000001"), false, "audit payloads never carry student ids");

    await app.close();
  });
});

describe("participant headcount consistency and explicit seal", () => {
  it("refuses to seal while any exam task has no active enrollment", async () => {
    const app = createApp();
    await switchToEnrollments(app);
    await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: {
        students: [{ id: "S000001" }],
        enrollments: [{ exam_task_id: firstExamTask.id, student_id: "S000001" }],
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/participants/seal",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 409);
    const body = response.json();
    assert.equal(body.error, "participant_data_incomplete");
    assert.equal(body.participants.status, "draft");
    assert.equal(body.participants.digest, null);
    const uncovered = body.diagnostics.filter(
      (diagnostic: { code: string }) => diagnostic.code === "participant_data_incomplete",
    );
    assert.equal(uncovered.length, demoScheduleInput.exam_tasks.length - 1);

    await app.close();
  });

  it("refuses to seal while a disabled student still holds an active enrollment", async () => {
    const app = createApp();
    await switchToEnrollments(app);
    await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: buildFullCoveragePayload({ disabledExtraStudentId: "S000900" }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/participants/seal",
      headers: adminHeaders,
    });

    assert.equal(response.statusCode, 409);
    const diagnostics = response.json().diagnostics as Array<{
      code: string;
      affected_ids: string[];
    }>;
    assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.code), [
      "student_enrollment_reference_invalid",
    ]);
    assert.deepEqual(diagnostics[0].affected_ids, ["S000900"]);

    await app.close();
  });

  it("seals complete participant data and writes expected_count back from enrollments", async () => {
    const app = createApp();
    await switchToEnrollments(app);
    await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: buildFullCoveragePayload(),
    });

    const sealed = await app.inject({
      method: "POST",
      url: "/api/participants/seal",
      headers: adminHeaders,
    });

    assert.equal(sealed.statusCode, 200, sealed.body);
    const { participants } = sealed.json();
    assert.equal(participants.status, "complete");
    assert.match(participants.digest, /^[a-f0-9]{64}$/);
    assert.deepEqual(participants.diagnostics, []);

    const reference = await app.inject({
      method: "GET",
      url: "/api/reference-data",
      headers: adminHeaders,
    });
    const examTasks = reference.json().scheduleInput.exam_tasks as Array<{
      id: string;
      expected_count: number;
    }>;
    for (const task of examTasks) {
      assert.equal(task.expected_count, task.id === firstExamTask.id ? 2 : 1, task.id);
    }

    await app.close();
  });

  it("produces the same digest for the same sealed enrollment set", async () => {
    const digests: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const app = createApp();
      await switchToEnrollments(app);
      await app.inject({
        method: "POST",
        url: "/api/participants/import",
        headers: adminHeaders,
        payload: buildFullCoveragePayload(),
      });
      const sealed = await app.inject({
        method: "POST",
        url: "/api/participants/seal",
        headers: adminHeaders,
      });
      digests.push(sealed.json().participants.digest);
      await app.close();
    }

    assert.equal(digests[0], digests[1]);

    const app = createApp();
    await switchToEnrollments(app);
    await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: buildFullCoveragePayload({ extraStudentOnFirstExam: "S000900" }),
    });
    const changed = await app.inject({
      method: "POST",
      url: "/api/participants/seal",
      headers: adminHeaders,
    });
    assert.notEqual(changed.json().participants.digest, digests[0]);
    await app.close();
  });

  it("invalidates the seal as soon as enrollment data changes again", async () => {
    const app = createApp();
    await switchToEnrollments(app);
    await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: buildFullCoveragePayload(),
    });
    const sealed = await app.inject({
      method: "POST",
      url: "/api/participants/seal",
      headers: adminHeaders,
    });
    const sealedVersion = sealed.json().participants.dataVersion;

    const reimported = await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: buildFullCoveragePayload({ extraStudentOnFirstExam: "S000901" }),
    });

    assert.equal(reimported.statusCode, 200);
    assert.equal(reimported.json().participants.status, "draft");
    assert.equal(reimported.json().participants.digest, null);
    assert.equal(reimported.json().participants.dataVersion, sealedVersion + 1);

    await app.close();
  });

  it("invalidates the seal when an exam task is added or removed", async () => {
    const app = createApp();
    await switchToEnrollments(app);
    await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: buildFullCoveragePayload(),
    });
    await app.inject({ method: "POST", url: "/api/participants/seal", headers: adminHeaders });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/reference-data/exam-tasks/${demoScheduleInput.exam_tasks.at(-1)!.id}`,
      headers: adminHeaders,
    });
    assert.equal(deleted.statusCode, 200, deleted.body);

    const summary = await app.inject({
      method: "GET",
      url: "/api/participants",
      headers: adminHeaders,
    });
    assert.equal(summary.json().participants.status, "draft");
    assert.equal(summary.json().participants.digest, null);

    await app.close();
  });

  it("blocks standalone expected_count edits while the batch uses enrollments", async () => {
    const app = createApp();
    await switchToEnrollments(app);

    const response = await app.inject({
      method: "PATCH",
      url: `/api/reference-data/exam-tasks/${firstExamTask.id}`,
      headers: adminHeaders,
      payload: { expected_count: 999 },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "reference_integrity_violation");

    await app.close();
  });

  it("reports groups_only headcount drift and blocks scheduling above group capacity", async () => {
    const scheduler = new StubScheduler();
    const app = createApp({ scheduler });

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/reference-data/exam-tasks/${firstExamTask.id}`,
      headers: adminHeaders,
      payload: { expected_count: 100_000 },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    const lowered = await app.inject({
      method: "PATCH",
      url: `/api/reference-data/exam-tasks/${secondExamTask.id}`,
      headers: adminHeaders,
      payload: { expected_count: 1 },
    });
    assert.equal(lowered.statusCode, 200, lowered.body);

    const summary = await app.inject({
      method: "GET",
      url: "/api/participants",
      headers: adminHeaders,
    });
    const diagnostics = summary.json().participants.diagnostics as Array<{
      code: string;
      severity: string;
      affected_ids: string[];
    }>;
    const exceeded = diagnostics.find(
      (diagnostic) => diagnostic.code === "expected_count_exceeds_group_size",
    );
    assert.equal(exceeded?.severity, "error");
    assert.deepEqual(exceeded?.affected_ids, [firstExamTask.id]);
    assert.ok(
      diagnostics.some((diagnostic) => (
        diagnostic.code === "expected_count_lower_than_group_size" && diagnostic.severity === "warning"
      )),
    );

    for (const url of ["/api/schedule-runs", "/api/schedule-jobs"]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: adminHeaders,
        payload: {},
      });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().error, "expected_count_exceeds_group_size");
      assert.ok(response.json().diagnostics.some((diagnostic: { code: string }) => (
        diagnostic.code === "expected_count_exceeds_group_size"
      )));
    }
    assert.equal(scheduler.calls, 0, "a hard headcount diagnostic never reaches the scheduler");

    await app.close();
  });

  it("reopens sealed participant data on demand", async () => {
    const app = createApp();
    await switchToEnrollments(app);
    await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: buildFullCoveragePayload(),
    });
    const sealed = await app.inject({
      method: "POST",
      url: "/api/participants/seal",
      headers: adminHeaders,
    });
    assert.equal(sealed.json().participants.status, "complete");

    const reopened = await app.inject({
      method: "POST",
      url: "/api/participants/reopen",
      headers: adminHeaders,
    });

    assert.equal(reopened.statusCode, 200);
    assert.equal(reopened.json().participants.status, "draft");
    assert.equal(reopened.json().participants.digest, null);

    await app.close();
  });
});

describe("unified schedule input builder and request snapshot v3", () => {
  it("writes a v3 request snapshot carrying the groups_only participant summary", async () => {
    const repository = new InMemoryPlatformRepository({ authUsers: testAuthUsers });
    const app = createApp({ repository, scheduler: new StubScheduler() });

    const response = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: adminHeaders,
      payload: {},
    });
    assert.equal(response.statusCode, 202, response.body);

    const claim = await repository.claimScheduleJob(response.json().job.id);
    assert.equal(claim.resolution, "claimed");
    const snapshot = claim.resolution === "claimed" ? claim.requestSnapshot : null;
    assert.equal(snapshot?.version, 3);
    assert.equal(snapshot?.version === 3 ? snapshot.participantSnapshot.mode : null, "groups_only");
    assert.equal(
      snapshot?.version === 3 ? snapshot.participantSnapshot.overlapEdgeCount : null,
      0,
    );
    assert.equal(snapshot?.input.participant_mode, "groups_only");
    assert.deepEqual(snapshot?.input.student_overlap_edges, []);

    await app.close();
  });

  it("persists the same participant summary on synchronous runs", async () => {
    const app = createApp({ scheduler: new StubScheduler() });

    const response = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: adminHeaders,
      payload: {},
    });

    assert.equal(response.statusCode, 201, response.body);
    assert.deepEqual(response.json().run.participantSnapshot, {
      schemaVersion: 1,
      batchId: "batch-2026-spring-final",
      mode: "groups_only",
      dataVersion: 0,
      digest: null,
      studentCount: 0,
      enrollmentCount: 0,
      overlapEdgeCount: 0,
    });

    await app.close();
  });

  it("rejects enrollment scheduling instead of degrading to group-only solving", async () => {
    const repository = new InMemoryPlatformRepository({ authUsers: testAuthUsers });
    const scheduler = new StubScheduler();
    const app = createApp({ repository, scheduler });
    await switchToEnrollments(app);
    await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: buildFullCoveragePayload(),
    });
    const sealed = await app.inject({
      method: "POST",
      url: "/api/participants/seal",
      headers: adminHeaders,
    });
    assert.equal(sealed.json().participants.status, "complete");

    const job = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: adminHeaders,
      payload: {},
    });
    const run = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: adminHeaders,
      payload: {},
    });

    assert.equal(job.statusCode, 409, job.body);
    assert.equal(job.json().error, "enrollment_mode_not_solvable");
    assert.equal(run.statusCode, 409, run.body);
    assert.equal(run.json().error, "enrollment_mode_not_solvable");
    assert.equal(scheduler.calls, 0, "the scheduler is never reached in enrollments mode");
    assert.equal((await repository.listScheduleJobs()).total, 0);
    assert.equal((await repository.listScheduleRuns()).total, 0);

    await app.close();
  });

  it("rejects enrollment scheduling while participant data is still draft", async () => {
    const app = createApp({ scheduler: new StubScheduler() });
    await switchToEnrollments(app);

    const job = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: adminHeaders,
      payload: {},
    });

    assert.equal(job.statusCode, 409);
    assert.equal(job.json().error, "participant_data_incomplete");
    assert.ok(Array.isArray(job.json().diagnostics));

    await app.close();
  });

  it("keeps historical v1 snapshots executable without rewriting their digest", async () => {
    const repository = new InMemoryPlatformRepository({ authUsers: testAuthUsers });
    const scheduler = new StubScheduler();
    const app = createApp({ repository, scheduler });

    const response = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: adminHeaders,
      payload: {},
    });
    const jobId = response.json().job.id;
    const originalDigest = response.json().job.requestDigest;

    // 报名数据在作业排队后发生变化，重试仍必须使用冻结快照。
    await switchToEnrollments(app);
    await app.inject({
      method: "POST",
      url: "/api/participants/import",
      headers: adminHeaders,
      payload: buildFullCoveragePayload(),
    });

    const claim = await repository.claimScheduleJob(jobId, { reclaimRunning: true });
    assert.equal(claim.resolution, "claimed");
    const snapshot = claim.resolution === "claimed" ? claim.requestSnapshot : null;
    assert.equal(snapshot?.version === 3 ? snapshot.participantSnapshot.mode : null, "groups_only");
    assert.equal((await repository.getScheduleJob(jobId))?.requestDigest, originalDigest);

    await app.close();
  });
});

class StubScheduler {
  calls = 0;

  async solve(input: Parameters<SchedulerClient["solve"]>[0]) {
    this.calls += 1;
    return {
      assignments: [],
      conflicts: [],
      score: {
        total_score: 100,
        hard_violation_count: 0,
        soft_penalty_items: [],
        scoring_contract_version: 1 as const,
        normalized_score: 100,
        total_raw_penalty: 0,
        total_weighted_penalty: 0,
        normalized_penalty_items: [],
      },
      statistics: {
        status: "feasible" as const,
        elapsed_ms: 1,
        exam_count: input.exam_tasks.length,
        room_count: input.rooms.length,
        slot_count: input.time_slots.length,
        attempted_assignments: 0,
      },
      diagnostics: [],
    };
  }
}

/**
 * 覆盖全部考试任务的最小完整报名集合：第一场 2 人（构造 1 条重叠边），其余每场 1 人。
 */
function buildFullCoveragePayload(options: {
  disabledExtraStudentId?: string;
  extraStudentOnFirstExam?: string;
} = {}) {
  const students: Array<Record<string, unknown>> = [{ id: "S000001" }, { id: "S000002" }];
  const enrollments: Array<Record<string, unknown>> = [
    { exam_task_id: firstExamTask.id, student_id: "S000001", source: "regular" },
    { exam_task_id: firstExamTask.id, student_id: "S000002", source: "elective" },
    { exam_task_id: secondExamTask.id, student_id: "S000001", source: "retake" },
  ];
  for (const task of demoScheduleInput.exam_tasks.slice(2)) {
    enrollments.push({ exam_task_id: task.id, student_id: "S000002", source: "regular" });
  }
  if (options.disabledExtraStudentId) {
    students.push({ id: options.disabledExtraStudentId, status: "disabled" });
    enrollments.push({
      exam_task_id: firstExamTask.id,
      student_id: options.disabledExtraStudentId,
      source: "other",
    });
  }
  if (options.extraStudentOnFirstExam) {
    students.push({ id: options.extraStudentOnFirstExam });
    enrollments.push({
      exam_task_id: firstExamTask.id,
      student_id: options.extraStudentOnFirstExam,
      source: "other",
    });
  }
  return { students, enrollments };
}
