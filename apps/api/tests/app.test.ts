import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  criticalMigrationTables,
  draftScheduledExams,
  loadMigrationFiles,
  migrationStateTableName,
  scheduleJobs,
} from "@examforge/db";
import {
  type ScheduleInput,
  type ScheduleResult,
} from "@examforge/shared";
import { createApp as createProductionApp, type AppOptions } from "../src/app.js";
import { InMemoryPlatformRepository, type PlatformRepository } from "../src/repository.js";
import { hashSessionToken } from "../src/auth/security.js";
import type { SchedulerClient } from "../src/scheduler-client.js";
import {
  buildCompleteScheduleResult,
  buildTestAuthUsers,
  testAuthHeaders,
  testSessionTokens,
} from "./test-fixtures.js";

const adminHeaders = testAuthHeaders.admin;
const operatorHeaders = testAuthHeaders.operator;
const viewerHeaders = testAuthHeaders.student;
const testAuthUsers = await buildTestAuthUsers();
const seededRepositories = new WeakSet<PlatformRepository>();

function createApp(options: AppOptions = {}) {
  const repository = options.repository ?? new InMemoryPlatformRepository({ authUsers: testAuthUsers });
  seedRepositorySessions(repository);
  return createProductionApp({ ...options, repository });
}

function seedRepositorySessions(repository: PlatformRepository) {
  if (seededRepositories.has(repository)) {
    return;
  }
  seededRepositories.add(repository);
  if (repository.storageMode === "memory") {
    for (const user of testAuthUsers) {
      void repository.createAuthUser(user).catch(() => undefined);
    }
  }
  const createdAt = "2026-07-12T00:00:00.000Z";
  for (const role of ["admin", "operator", "teacher", "student"] as const) {
    void repository.createAuthSession({
      id: `test-${role}-session`,
      userId: `user-${role}`,
      tokenDigest: hashSessionToken(testSessionTokens[role]),
      createdAt,
      expiresAt: "2099-07-12T00:00:00.000Z",
      userAgent: "ExamForge test fixture",
      ipAddress: "127.0.0.1",
    });
  }
}

class FakeScheduler implements SchedulerClient {
  lastInput: ScheduleInput | null = null;
  calls = 0;

  async solve(input: ScheduleInput): Promise<ScheduleResult> {
    this.lastInput = input;
    this.calls += 1;
    const result = buildCompleteScheduleResult(input);
    return {
      ...result,
      score: {
        ...result.score,
        total_score: 90 + this.calls,
      },
      statistics: {
        ...result.statistics,
        elapsed_ms: 18,
        attempted_assignments: 42,
      },
    };
  }
}

class IncompleteScheduler implements SchedulerClient {
  async solve(input: ScheduleInput): Promise<ScheduleResult> {
    return {
      assignments: [],
      conflicts: [],
      score: {
        total_score: 0,
        hard_violation_count: 1,
        soft_penalty_items: [],
      },
      statistics: {
        status: "infeasible",
        elapsed_ms: 1,
        exam_count: input.exam_tasks.length,
        room_count: input.rooms.length,
        slot_count: input.time_slots.length,
        attempted_assignments: 0,
      },
      report: {
        summary: {
          status: "infeasible",
        },
      },
    };
  }
}

class DuplicateAssignmentScheduler implements SchedulerClient {
  async solve(input: ScheduleInput): Promise<ScheduleResult> {
    const result = buildCompleteScheduleResult(input);
    result.assignments.push(structuredClone(result.assignments[0]));
    return result;
  }
}

class DraftWorkflowScheduler implements SchedulerClient {
  lastInput: ScheduleInput | null = null;

  async solve(input: ScheduleInput): Promise<ScheduleResult> {
    this.lastInput = structuredClone(input);
    if (input.reschedule_context) {
      const baseline = input.reschedule_context.baseline_assignments;
      const movable = new Set(input.reschedule_context.movable_exam_task_ids);
      const examIds = baseline.map((assignment) => assignment.exam_task_id).sort();
      return {
        assignments: structuredClone(baseline),
        conflicts: [],
        score: {
          total_score: 96,
          hard_violation_count: 0,
          soft_penalty_items: [],
        },
        statistics: {
          status: "feasible",
          elapsed_ms: 20,
          exam_count: baseline.length,
          room_count: input.rooms.length,
          slot_count: input.time_slots.length,
          attempted_assignments: baseline.length,
        },
        report: {
          reschedule: {
            baseline_exam_count: baseline.length,
            frozen_exam_task_ids: examIds.filter((examTaskId) => !movable.has(examTaskId)),
            retained_exam_task_ids: examIds,
            changed_exam_task_ids: [],
          },
        },
      };
    }
    return buildCompleteScheduleResult(input);
  }
}

describe("ExamForge API", () => {
  it("reports process health and repository readiness separately", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const healthResponse = await app.inject({ method: "GET", url: "/health" });
    assert.equal(healthResponse.statusCode, 200);
    assert.deepEqual(healthResponse.json(), {
      ok: true,
      service: "examforge-api",
    });

    const readyResponse = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(readyResponse.statusCode, 200);
    assert.deepEqual(readyResponse.json(), {
      ok: true,
      service: "examforge-api",
      storage: "memory",
    });
    await app.close();
  });

  it("returns 503 readiness without exposing dependency error details", async () => {
    const repository = new InMemoryPlatformRepository();
    Object.defineProperty(repository, "storageMode", { value: "postgres" });
    (repository as unknown as { checkReadiness: () => Promise<void> }).checkReadiness = async () => {
      throw new Error("postgres://user:secret@database/examforge");
    };
    const app = createApp({ repository, scheduler: new FakeScheduler() });

    const response = await app.inject({ method: "GET", url: "/ready" });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      ok: false,
      service: "examforge-api",
      storage: "postgres",
      error: "dependency_unavailable",
    });
    assert.doesNotMatch(response.body, /secret/);
    await app.close();
  });

  it("returns dashboard data", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: viewerHeaders,
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
      headers: operatorHeaders,
    });

    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json();
    assert.equal(created.run.status, "feasible");
    assert.equal(created.result.score.total_score, 91);

    const readResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/${created.run.id}`,
      headers: viewerHeaders,
    });

    assert.equal(readResponse.statusCode, 200);
    assert.equal(readResponse.json().run.id, created.run.id);
    await app.close();
  });

  it("passes fixed assignments from schedule run requests to the scheduler", async () => {
    const scheduler = new FakeScheduler();
    const fixedAssignments = [
      {
        exam_task_id: "e-data-structures",
        room_id: "r-101",
        time_slot_id: "s-001",
        teacher_ids: ["t-zhang"],
      },
    ];
    const app = createApp({ scheduler });

    const response = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
      payload: {
        fixed_assignments: fixedAssignments,
      },
    });

    assert.equal(response.statusCode, 201);
    assert.deepEqual(scheduler.lastInput?.fixed_assignments, fixedAssignments);
    await app.close();
  });

  it("passes fixed assignments from schedule job requests to the scheduler", async () => {
    const scheduler = new FakeScheduler();
    const fixedAssignments = [
      {
        exam_task_id: "e-data-structures",
        room_id: "r-101",
        time_slot_id: "s-001",
        teacher_ids: ["t-zhang"],
      },
    ];
    const app = createApp({ scheduler });

    const response = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: operatorHeaders,
      payload: {
        fixed_assignments: fixedAssignments,
      },
    });
    assert.equal(response.statusCode, 202);

    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.deepEqual(scheduler.lastInput?.fixed_assignments, fixedAssignments);
    await app.close();
  });

  it("passes reschedule context from schedule run requests to the scheduler", async () => {
    const scheduler = new FakeScheduler();
    const app = createApp({ scheduler });
    const rescheduleContext = buildRescheduleContext();

    const response = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
      payload: {
        fixed_assignments: [],
        reschedule_context: rescheduleContext,
      },
    });

    assert.equal(response.statusCode, 201);
    assert.deepEqual(scheduler.lastInput?.reschedule_context, rescheduleContext);
    await app.close();
  });

  it("passes reschedule context from schedule job requests to the scheduler", async () => {
    const scheduler = new FakeScheduler();
    const app = createApp({ scheduler });
    const rescheduleContext = buildRescheduleContext();

    const response = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: operatorHeaders,
      payload: {
        fixed_assignments: [],
        reschedule_context: rescheduleContext,
      },
    });
    assert.equal(response.statusCode, 202);

    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.deepEqual(scheduler.lastInput?.reschedule_context, rescheduleContext);
    await app.close();
  });

  it("rejects structurally invalid reschedule context requests", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });
    const baseline = buildRescheduleContext().baseline_assignments[0];
    const invalidContexts = [
      {
        baseline_assignments: [baseline, baseline],
        movable_exam_task_ids: [baseline.exam_task_id],
      },
      {
        baseline_assignments: [baseline],
        movable_exam_task_ids: [baseline.exam_task_id, baseline.exam_task_id],
      },
      {
        baseline_assignments: [baseline],
        movable_exam_task_ids: ["e-not-in-baseline"],
      },
    ];

    for (const rescheduleContext of invalidContexts) {
      const response = await app.inject({
        method: "POST",
        url: "/api/schedule-runs",
        headers: operatorHeaders,
        payload: { reschedule_context: rescheduleContext },
      });

      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error, "invalid_schedule_request");
    }
    await app.close();
  });

  it("authenticates users with server sessions instead of trusting bearer or role headers", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:3000" },
      payload: {
        username: "operator",
        password: "operator-password",
      },
    });
    assert.equal(loginResponse.statusCode, 200);
    assert.deepEqual(loginResponse.json().user.roles, ["operator"]);
    assert.ok(loginResponse.headers["set-cookie"]?.includes("HttpOnly"));
    assert.equal(loginResponse.json().token, undefined);
    assert.equal(loginResponse.body.includes("passwordHash"), false);
    const setCookie = loginResponse.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";")[0];
    assert.ok(cookie);

    const authenticatedResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: {
        origin: "http://localhost:3000",
        cookie,
      },
    });
    assert.equal(authenticatedResponse.statusCode, 201);

    const missingRoleResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: { origin: "http://localhost:3000" },
    });
    assert.equal(missingRoleResponse.statusCode, 401);
    assert.equal(missingRoleResponse.json().error, "not_authenticated");

    const invalidRoleResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: {
        origin: "http://localhost:3000",
        authorization: "Bearer invalid-token",
      },
    });
    assert.equal(invalidRoleResponse.statusCode, 401);
    assert.equal(invalidRoleResponse.json().error, "not_authenticated");

    const forgedRoleHeaderResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: {
        origin: "http://localhost:3000",
        "x-examforge-role": "admin",
      },
    });
    assert.equal(forgedRoleHeaderResponse.statusCode, 401);
    assert.equal(forgedRoleHeaderResponse.json().error, "not_authenticated");

    await app.close();
  });

  it("rejects wrong passwords, disabled accounts, untrusted origins and revoked session replay", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });
    const login = (username: string, password: string) => app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:3000" },
      payload: { username, password },
    });

    assert.equal((await login("operator", "wrong-password")).statusCode, 401);
    assert.equal((await login("disabled", "disabled-password")).statusCode, 403);

    const untrusted = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: { ...operatorHeaders, origin: "https://attacker.example" },
    });
    assert.equal(untrusted.statusCode, 403);
    assert.equal(untrusted.json().error, "untrusted_origin");

    const teacherDenied = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: testAuthHeaders.teacher,
    });
    assert.equal(teacherDenied.statusCode, 403);
    assert.equal(teacherDenied.json().error, "permission_denied");

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: operatorHeaders,
    });
    assert.equal(logout.statusCode, 204);
    assert.match(String(logout.headers["set-cookie"]), /Max-Age=0/);
    const replay = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: operatorHeaders,
    });
    assert.equal(replay.statusCode, 401);

    await app.close();
  });

  it("protects internal reads with session authentication", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });
    const internalPaths = [
      "/api/dashboard",
      "/api/reference-data",
      "/api/schedule-jobs",
      "/api/schedule-jobs/missing-job",
      "/api/schedule-runs",
      "/api/schedule-runs/missing-run",
      "/api/schedule-runs/compare?baseId=missing-a&targetId=missing-b",
      "/api/schedule-drafts",
      "/api/schedule-drafts/missing-draft",
      "/api/schedule-drafts/missing-draft/compare",
      "/api/schedule-drafts/missing-draft/assignments/missing-exam/suggestions",
      "/api/audit-events",
    ];

    for (const path of internalPaths) {
      for (const headers of [undefined, { authorization: "Bearer forged-token" }]) {
        const response = await app.inject({ method: "GET", url: path, headers });
        assert.equal(response.statusCode, 401, `${path} must reject unauthenticated reads`);
        assert.equal(response.json().error, "not_authenticated");
      }

      const viewerResponse = await app.inject({
        method: "GET",
        url: path,
        headers: viewerHeaders,
      });
      assert.notEqual(viewerResponse.statusCode, 401, `${path} must accept student authentication`);
      assert.notEqual(viewerResponse.statusCode, 403, `${path} must allow student reads`);
    }

    await app.close();
  });

  it("keeps published audience reads anonymous while protecting CSV export", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });
    for (const path of [
      "/api/published-schedule",
      "/api/published-schedule/notifications",
      "/api/published-schedule/teachers/t-zhang",
      "/api/published-schedule/student-groups/g-cs-2301",
    ]) {
      const response = await app.inject({ method: "GET", url: path });
      assert.equal(response.statusCode, 404);
      assert.notEqual(response.json().error, "not_authenticated");
    }

    const exportResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule/export.csv",
    });
    assert.equal(exportResponse.statusCode, 401);
    assert.equal(exportResponse.json().error, "not_authenticated");

    await app.close();
  });

  it("lists schedule runs, audit events, and compares two runs", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const first = firstResponse.json();
    const second = secondResponse.json();

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/schedule-runs",
      headers: viewerHeaders,
    });
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(
      listResponse.json().runs.map((run: { id: string }) => run.id),
      [second.run.id, first.run.id],
    );

    const auditResponse = await app.inject({
      method: "GET",
      url: "/api/audit-events",
      headers: viewerHeaders,
    });
    assert.equal(auditResponse.statusCode, 200);
    assert.equal(auditResponse.json().events.length, 2);
    assert.equal(auditResponse.json().events[0].action, "schedule_run.created");

    const filteredAuditResponse = await app.inject({
      method: "GET",
      url: `/api/audit-events?entityType=schedule_run&entityId=${first.run.id}&actor=operator`,
      headers: viewerHeaders,
    });
    assert.equal(filteredAuditResponse.statusCode, 200);
    assert.deepEqual(
      filteredAuditResponse.json().events.map((event: { entityId: string }) => event.entityId),
      [first.run.id],
    );
    assert.equal(filteredAuditResponse.json().events[0].actorUserId, "user-operator");
    assert.deepEqual(filteredAuditResponse.json().events[0].actorRoles, ["operator"]);

    const invalidAuditFilterResponse = await app.inject({
      method: "GET",
      url: "/api/audit-events?since=not-a-date",
      headers: viewerHeaders,
    });
    assert.equal(invalidAuditFilterResponse.statusCode, 400);
    assert.equal(invalidAuditFilterResponse.json().error, "invalid_audit_filter");

    const compareResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/compare?baseId=${first.run.id}&targetId=${second.run.id}`,
      headers: viewerHeaders,
    });
    assert.equal(compareResponse.statusCode, 200);
    assert.equal(compareResponse.json().baseRun.id, first.run.id);
    assert.equal(compareResponse.json().targetRun.id, second.run.id);
    assert.equal(compareResponse.json().deltas.score, 1);

    await app.close();
  });

  it("publishes and rolls back a schedule run", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const created = createResponse.json();

    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${created.run.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishResponse.statusCode, 200);
    assert.equal(publishResponse.json().batch.status, "published");
    assert.equal(publishResponse.json().run.id, created.run.id);

    const publishedResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule",
    });
    assert.equal(publishedResponse.statusCode, 200);
    assert.equal(publishedResponse.json().run.id, created.run.id);

    const rollbackResponse = await app.inject({
      method: "POST",
      url: "/api/published-schedule/rollback",
      headers: adminHeaders,
    });
    assert.equal(rollbackResponse.statusCode, 200);
    assert.equal(rollbackResponse.json().batch.status, "ready");

    const afterRollbackResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule",
    });
    assert.equal(afterRollbackResponse.statusCode, 404);

    await app.close();
  });

  it("rejects publishing an infeasible schedule run", async () => {
    const app = createApp({ scheduler: new IncompleteScheduler() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json();

    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${created.run.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishResponse.statusCode, 409);
    assert.equal(publishResponse.json().error, "schedule_run_not_publishable");

    const publishedResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule",
    });
    assert.equal(publishedResponse.statusCode, 404);

    await app.close();
  });

  it("blocks drafts that omit exam task assignments", async () => {
    const app = createApp({ scheduler: new IncompleteScheduler() });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const run = runResponse.json();
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
    });
    assert.equal(draftResponse.statusCode, 201);
    const draft = draftResponse.json();
    assert.equal(draft.draft.status, "blocked");
    assert.equal(
      draft.conflicts.filter((conflict: { type: string }) => (
        conflict.type === "exam_task_unassigned"
      )).length,
      6,
    );

    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishResponse.statusCode, 409);
    assert.equal(publishResponse.json().error, "schedule_draft_has_conflicts");

    await app.close();
  });

  it("rejects duplicate exam task assignments from runs and drafts", async () => {
    const app = createApp({ scheduler: new DuplicateAssignmentScheduler() });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const run = runResponse.json();
    const runPublishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(runPublishResponse.statusCode, 409);
    assert.equal(runPublishResponse.json().error, "schedule_run_not_publishable");

    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
    });
    assert.equal(draftResponse.statusCode, 201);
    assert.equal(draftResponse.json().draft.status, "blocked");
    assert.ok(draftResponse.json().conflicts.some((conflict: { type: string }) => (
      conflict.type === "exam_task_duplicate_assignment"
    )));

    await app.close();
  });

  it("queries published schedules by teacher and student group", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });
    const referenceResponse = await app.inject({
      method: "GET",
      url: "/api/reference-data",
      headers: viewerHeaders,
    });
    const referenceData = referenceResponse.json();
    const teacher = referenceData.scheduleInput.teachers[0];
    const studentGroup = referenceData.scheduleInput.student_groups[0];

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${created.run.id}/publish`,
      headers: adminHeaders,
    });

    const teacherResponse = await app.inject({
      method: "GET",
      url: `/api/published-schedule/teachers/${teacher.id}`,
    });
    assert.equal(teacherResponse.statusCode, 200);
    assert.equal(teacherResponse.json().viewer.id, teacher.id);
    assert.ok(teacherResponse.json().assignments.length > 0);
    assert.equal(teacherResponse.json().assignments[0].teachers[0].id, teacher.id);

    const studentResponse = await app.inject({
      method: "GET",
      url: `/api/published-schedule/student-groups/${studentGroup.id}`,
    });
    assert.equal(studentResponse.statusCode, 200);
    assert.equal(studentResponse.json().viewer.id, studentGroup.id);
    assert.ok(studentResponse.json().assignments.length > 0);
    assert.equal(studentResponse.json().assignments[0].studentGroups[0].id, studentGroup.id);

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
        checkReadiness: () => repository.checkReadiness(),
        getDashboard: () => repository.getDashboard(),
        getReferenceData: async () => referenceData,
        createReferenceRecord: (resource, record) => repository.createReferenceRecord(resource, record),
        updateReferenceRecord: (resource, id, patch) => repository.updateReferenceRecord(resource, id, patch),
        importReferenceRecords: (resource, records) => repository.importReferenceRecords(resource, records),
        deleteReferenceRecord: (resource, id) => repository.deleteReferenceRecord(resource, id),
        createScheduleRun: (result) => repository.createScheduleRun(result),
        listScheduleRuns: () => repository.listScheduleRuns(),
        getScheduleRun: (id) => repository.getScheduleRun(id),
        compareScheduleRuns: (baseId, targetId) => repository.compareScheduleRuns(baseId, targetId),
        listAuditEvents: (filter) => repository.listAuditEvents(filter),
        publishScheduleRun: (id) => repository.publishScheduleRun(id),
        getPublishedSchedule: () => repository.getPublishedSchedule(),
        rollbackPublishedSchedule: () => repository.rollbackPublishedSchedule(),
        createScheduleDraftFromRun: (id) => repository.createScheduleDraftFromRun(id),
        listScheduleDrafts: () => repository.listScheduleDrafts(),
        getScheduleDraft: (id) => repository.getScheduleDraft(id),
        updateScheduleDraftAssignment: (id, examTaskId, patch) => (
          repository.updateScheduleDraftAssignment(id, examTaskId, patch)
        ),
        validateScheduleDraft: (id) => repository.validateScheduleDraft(id),
        compareScheduleDraft: (id) => repository.compareScheduleDraft(id),
        suggestScheduleDraftAssignment: (id, examTaskId) => repository.suggestScheduleDraftAssignment(id, examTaskId),
        lockScheduleDraftAssignment: (id, examTaskId) => repository.lockScheduleDraftAssignment(id, examTaskId),
        unlockScheduleDraftAssignment: (id, examTaskId) => repository.unlockScheduleDraftAssignment(id, examTaskId),
        rebalanceScheduleDraft: (id) => repository.rebalanceScheduleDraft(id),
        publishScheduleDraft: (id) => repository.publishScheduleDraft(id),
        discardScheduleDraft: (id) => repository.discardScheduleDraft(id),
        createScheduleJob: (command) => repository.createScheduleJob(command),
        listScheduleJobs: () => repository.listScheduleJobs(),
        getScheduleJob: (id) => repository.getScheduleJob(id),
        transitionScheduleJob: (id, command) => repository.transitionScheduleJob(id, command),
        completeScheduleJob: (id, result) => repository.completeScheduleJob(id, result),
        createAuthUser: (command) => repository.createAuthUser(command),
        findAuthUserByUsername: (username) => repository.findAuthUserByUsername(username),
        createAuthSession: (command) => repository.createAuthSession(command),
        findAuthSessionByTokenDigest: (digest) => repository.findAuthSessionByTokenDigest(digest),
        revokeAuthSession: (id, revokedAt) => repository.revokeAuthSession(id, revokedAt),
      },
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
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
      headers: operatorHeaders,
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
      headers: operatorHeaders,
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
      headers: viewerHeaders,
    });
    const courses = referenceResponse.json().scheduleInput.courses;
    assert.ok(courses.some((course: { id: string; name: string }) => (
      course.id === "c-linear-algebra" && course.name === "线性代数 A"
    )));

    await app.close();
  });

  it("imports and deletes reference data records", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/reference-data/time-slots/import",
      headers: operatorHeaders,
      payload: {
        records: [
          {
            id: "slot-import-a",
            date: "2026-06-21",
            start_time: "08:30",
            end_time: "10:30",
            period_index: 20,
          },
          {
            id: "slot-import-b",
            date: "2026-06-21",
            start_time: "14:00",
            end_time: "16:00",
            period_index: 21,
          },
        ],
      },
    });
    assert.equal(importResponse.statusCode, 200);
    assert.equal(importResponse.json().records.length, 2);

    const upsertResponse = await app.inject({
      method: "POST",
      url: "/api/reference-data/time-slots/import",
      headers: operatorHeaders,
      payload: {
        records: [
          {
            id: "slot-import-a",
            date: "2026-06-22",
            start_time: "09:00",
            end_time: "11:00",
            period_index: 22,
          },
        ],
      },
    });
    assert.equal(upsertResponse.statusCode, 200);
    assert.equal(upsertResponse.json().records[0].date, "2026-06-22");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/reference-data/time-slots/slot-import-b",
      headers: adminHeaders,
    });
    assert.equal(deleteResponse.statusCode, 200);
    assert.equal(deleteResponse.json().deleted.id, "slot-import-b");

    const referenceResponse = await app.inject({
      method: "GET",
      url: "/api/reference-data",
      headers: viewerHeaders,
    });
    const slots = referenceResponse.json().scheduleInput.time_slots;
    assert.ok(slots.some((slot: { id: string; date: string }) => (
      slot.id === "slot-import-a" && slot.date === "2026-06-22"
    )));
    assert.ok(!slots.some((slot: { id: string }) => slot.id === "slot-import-b"));

    await app.close();
  });

  it("rejects invalid reference data payloads", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const response = await app.inject({
      method: "POST",
      url: "/api/reference-data/rooms",
      headers: operatorHeaders,
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

  it("validates room building identifiers", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const invalidResponse = await app.inject({
      method: "POST",
      url: "/api/reference-data/rooms",
      headers: operatorHeaders,
      payload: {
        id: "r-invalid-building",
        name: "楼栋错误考场",
        building_id: "Test Building",
        capacity: 40,
        room_type: "standard",
        equipment_tags: [],
      },
    });
    assert.equal(invalidResponse.statusCode, 409);
    assert.equal(invalidResponse.json().error, "reference_integrity_violation");

    const validResponse = await app.inject({
      method: "POST",
      url: "/api/reference-data/rooms",
      headers: operatorHeaders,
      payload: {
        id: "r-valid-building",
        name: "楼栋合法考场",
        building_id: "test-building",
        capacity: 40,
        room_type: "standard",
        equipment_tags: [],
      },
    });
    assert.equal(validResponse.statusCode, 201);
    assert.equal(validResponse.json().record.building_id, "test-building");

    await app.close();
  });

  it("rejects reference records that point at missing resources", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/reference-data/exam-tasks",
      headers: operatorHeaders,
      payload: {
        id: "e-missing-course",
        course_id: "c-missing",
        student_group_ids: ["g-cs-2301"],
        expected_count: 42,
        duration_minutes: 120,
        required_room_type: "standard",
        required_equipment_tags: [],
        allowed_slot_ids: ["s-001"],
        invigilator_count: 1,
      },
    });
    assert.equal(createResponse.statusCode, 409);
    assert.equal(createResponse.json().error, "reference_integrity_violation");

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/api/reference-data/exam-tasks/e-data-structures",
      headers: operatorHeaders,
      payload: {
        student_group_ids: ["g-missing"],
      },
    });
    assert.equal(updateResponse.statusCode, 409);
    assert.equal(updateResponse.json().error, "reference_integrity_violation");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/reference-data/courses/c-data-structures",
      headers: adminHeaders,
    });
    assert.equal(deleteResponse.statusCode, 409);
    assert.equal(deleteResponse.json().error, "reference_integrity_violation");

    await app.close();
  });

  it("rejects teacher unavailable slots that do not exist", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/teachers/t-zhang/unavailable-slots",
      headers: operatorHeaders,
      payload: {
        unavailable_slot_ids: ["missing-slot"],
      },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "reference_integrity_violation");
    assert.deepEqual(response.json().issues, ["Time slot missing-slot does not exist."]);

    await app.close();
  });

  it("does not expose PostgreSQL integrity error details", async () => {
    const repository = new InMemoryPlatformRepository();
    repository.updateReferenceRecord = async () => {
      const cause = Object.assign(new Error("foreign key violation"), { code: "23503" });
      throw Object.assign(
        new Error("Failed query: insert into teacher_unavailable_slots values ($1, $2)"),
        { cause },
      );
    };
    const app = createApp({ repository, scheduler: new FakeScheduler() });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/teachers/t-zhang/unavailable-slots",
      headers: operatorHeaders,
      payload: {
        unavailable_slot_ids: ["s-001"],
      },
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), {
      error: "data_integrity_violation",
      message: "The request conflicts with persisted data integrity constraints.",
    });
    assert.doesNotMatch(response.body, /Failed query|teacher_unavailable_slots|foreign key/i);

    await app.close();
  });

  it("creates, adjusts, validates, and publishes a schedule draft", async () => {
    const app = createApp({ scheduler: new DraftWorkflowScheduler() });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    assert.equal(runResponse.statusCode, 201);
    const run = runResponse.json();

    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
    });
    assert.equal(draftResponse.statusCode, 201);
    const createdDraft = draftResponse.json();
    assert.equal(createdDraft.draft.sourceRunId, run.run.id);
    assert.equal(createdDraft.draft.status, "validated");
    assert.equal(createdDraft.assignments.length, 6);
    assert.equal(createdDraft.conflicts.length, 0);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/schedule-drafts",
      headers: viewerHeaders,
    });
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(
      listResponse.json().drafts.map((draft: { id: string }) => draft.id),
      [createdDraft.draft.id],
    );

    const conflictingAdjustment = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${createdDraft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-101",
        time_slot_id: "s-001",
        teacher_ids: ["t-zhang"],
      },
    });
    assert.equal(conflictingAdjustment.statusCode, 200);
    const blockedDraft = conflictingAdjustment.json();
    assert.equal(blockedDraft.draft.status, "blocked");
    assert.ok(blockedDraft.conflicts.some((conflict: { type: string }) => (
      conflict.type === "room_time_unique"
    )));
    assert.ok(blockedDraft.conflicts.some((conflict: { type: string }) => (
      conflict.type === "teacher_time_unique"
    )));
    assert.equal(blockedDraft.changeEvents.length, 1);

    const blockedPublish = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${createdDraft.draft.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(blockedPublish.statusCode, 409);
    assert.equal(blockedPublish.json().error, "schedule_draft_has_conflicts");

    const fixedAdjustment = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${createdDraft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-lab-2",
        time_slot_id: "s-005",
        teacher_ids: ["t-li"],
      },
    });
    assert.equal(fixedAdjustment.statusCode, 200);
    const fixedDraft = fixedAdjustment.json();
    assert.equal(fixedDraft.draft.status, "validated");
    assert.equal(fixedDraft.conflicts.length, 0);
    assert.equal(fixedDraft.changeEvents.length, 2);

    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${createdDraft.draft.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishResponse.statusCode, 200);
    assert.equal(publishResponse.json().batch.status, "published");
    assert.equal(publishResponse.json().result.assignments.length, 6);
    assert.equal(publishResponse.json().result.assignments[1].room_id, "r-lab-2");

    const publishedResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule",
    });
    assert.equal(publishedResponse.statusCode, 200);
    assert.equal(publishedResponse.json().run.id, publishResponse.json().run.id);

    for (const path of [
      `/api/schedule-drafts/${createdDraft.draft.id}/validate`,
      `/api/schedule-drafts/${createdDraft.draft.id}/assignments/e-data-structures/lock`,
      `/api/schedule-drafts/${createdDraft.draft.id}/assignments/e-data-structures/unlock`,
    ]) {
      const terminalMutation = await app.inject({
        method: "POST",
        url: path,
        headers: operatorHeaders,
      });
      assert.equal(terminalMutation.statusCode, 409);
      assert.equal(terminalMutation.json().error, "schedule_draft_not_editable");
    }

    await app.close();
  });

  it("treats empty allowed slot lists as unrestricted during draft validation", async () => {
    const repository = new InMemoryPlatformRepository();
    const referenceData = structuredClone(await repository.getReferenceData());
    referenceData.scheduleInput.exam_tasks = referenceData.scheduleInput.exam_tasks.map((task) => (
      task.id === "e-data-structures"
        ? { ...task, allowed_slot_ids: [] }
        : task
    ));
    (repository as unknown as { scheduleInput: ScheduleInput }).scheduleInput = referenceData.scheduleInput;
    const app = createApp({ scheduler: new DraftWorkflowScheduler(), repository });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    assert.equal(runResponse.statusCode, 201);
    const run = runResponse.json();

    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
    });
    assert.equal(draftResponse.statusCode, 201);
    const draft = draftResponse.json();
    assert.equal(draft.draft.status, "validated");
    assert.ok(!draft.conflicts.some((conflict: { type: string }) => conflict.type === "allowed_slot"));

    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishResponse.statusCode, 200);
    assert.equal(publishResponse.json().batch.status, "published");

    await app.close();
  });

  it("blocks draft assignments that reference missing time slots", async () => {
    const repository = new InMemoryPlatformRepository();
    const referenceData = structuredClone(await repository.getReferenceData());
    referenceData.scheduleInput.exam_tasks = referenceData.scheduleInput.exam_tasks.map((task) => (
      task.id === "e-data-structures"
        ? { ...task, allowed_slot_ids: [] }
        : task
    ));
    (repository as unknown as { scheduleInput: ScheduleInput }).scheduleInput = referenceData.scheduleInput;
    const app = createApp({ scheduler: new DraftWorkflowScheduler(), repository });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${runResponse.json().run.id}/drafts`,
      headers: operatorHeaders,
    });
    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draftResponse.json().draft.id}/assignments/e-data-structures`,
      headers: operatorHeaders,
      payload: {
        time_slot_id: "missing-slot",
      },
    });

    assert.equal(updateResponse.statusCode, 200);
    assert.equal(updateResponse.json().draft.status, "blocked");
    assert.ok(updateResponse.json().conflicts.some((conflict: { type: string }) => (
      conflict.type === "time_slot_not_found"
    )));

    await app.close();
  });

  it("compares a draft against source and published versions, then discards it", async () => {
    const app = createApp({ scheduler: new DraftWorkflowScheduler() });

    const baselineRunResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const baselineRun = baselineRunResponse.json();
    await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${baselineRun.run.id}/publish`,
      headers: adminHeaders,
    });

    const sourceRunResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const sourceRun = sourceRunResponse.json();
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${sourceRun.run.id}/drafts`,
      headers: operatorHeaders,
    });
    const draft = draftResponse.json();

    await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-lab-2",
        time_slot_id: "s-005",
        teacher_ids: ["t-li"],
      },
    });

    const compareResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-drafts/${draft.draft.id}/compare`,
      headers: viewerHeaders,
    });
    assert.equal(compareResponse.statusCode, 200);
    const comparison = compareResponse.json();
    assert.equal(comparison.source.run.id, sourceRun.run.id);
    assert.equal(comparison.source.assignmentChanges.changed.length, 1);
    assert.equal(comparison.published.run.id, baselineRun.run.id);
    assert.equal(comparison.published.assignmentChanges.changed.length, 1);
    assert.equal(comparison.summary.changedFromSource, 1);
    assert.equal(comparison.summary.changedFromPublished, 1);

    const discardResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/discard`,
      headers: operatorHeaders,
    });
    assert.equal(discardResponse.statusCode, 200);
    assert.equal(discardResponse.json().draft.status, "discarded");

    const updateAfterDiscard = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-lab-1",
      },
    });
    assert.equal(updateAfterDiscard.statusCode, 409);
    assert.equal(updateAfterDiscard.json().error, "schedule_draft_not_editable");

    const publishAfterDiscard = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishAfterDiscard.statusCode, 409);
    assert.equal(publishAfterDiscard.json().error, "schedule_draft_not_publishable");

    const auditResponse = await app.inject({
      method: "GET",
      url: "/api/audit-events",
      headers: viewerHeaders,
    });
    assert.equal(auditResponse.statusCode, 200);
    assert.ok(auditResponse.json().events.some((event: { action: string }) => (
      event.action === "schedule_draft.discarded"
    )));

    await app.close();
  });

  it("suggests local draft adjustments and applies a conflict-free candidate", async () => {
    const app = createApp({ scheduler: new DraftWorkflowScheduler() });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const run = runResponse.json();
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
    });
    const draft = draftResponse.json();

    await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-101",
        time_slot_id: "s-001",
        teacher_ids: ["t-zhang"],
      },
    });

    const suggestionsResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database/suggestions`,
      headers: viewerHeaders,
    });

    assert.equal(suggestionsResponse.statusCode, 200);
    const suggestions = suggestionsResponse.json();
    assert.equal(suggestions.examTaskId, "e-database");
    assert.ok(suggestions.suggestions.length > 0);
    assert.equal(suggestions.suggestions[0].hardConflictCount, 0);
    assert.equal(suggestions.suggestions[0].assignment.exam_task_id, "e-database");
    assert.ok(suggestions.suggestions[0].reasons.length > 0);

    const appliedSuggestion = suggestions.suggestions[0].assignment;
    const fixedResponse = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: appliedSuggestion.room_id,
        time_slot_id: appliedSuggestion.time_slot_id,
        teacher_ids: appliedSuggestion.teacher_ids,
      },
    });

    assert.equal(fixedResponse.statusCode, 200);
    assert.equal(fixedResponse.json().draft.status, "validated");
    assert.equal(fixedResponse.json().conflicts.length, 0);

    await app.close();
  });

  it("creates asynchronous schedule jobs and exposes progress until a run is created", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: operatorHeaders,
    });
    assert.equal(createResponse.statusCode, 202);
    const created = createResponse.json();
    assert.equal(created.job.status, "queued");
    assert.equal(created.job.progress, 0);

    await waitFor(async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/schedule-jobs/${created.job.id}`,
        headers: viewerHeaders,
      });
      const payload = response.json();
      return payload.job.status === "succeeded" && payload.job.runId;
    });

    const jobResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-jobs/${created.job.id}`,
      headers: viewerHeaders,
    });
    assert.equal(jobResponse.statusCode, 200);
    assert.equal(jobResponse.json().job.status, "succeeded");
    assert.equal(jobResponse.json().job.progress, 100);

    const runResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/${jobResponse.json().job.runId}`,
      headers: viewerHeaders,
    });
    assert.equal(runResponse.statusCode, 200);

    await app.close();
  });

  it("rejects an idempotency key reused for a different schedule request", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });
    const headers = {
      ...operatorHeaders,
      "idempotency-key": "api-conflicting-job-request",
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers,
      payload: {},
    });
    const conflicting = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers,
      payload: {
        fixed_assignments: [{
          exam_task_id: "e-data-structures",
          room_id: "r-101",
          time_slot_id: "s-001",
          teacher_ids: ["t-zhang"],
        }],
      },
    });

    assert.equal(first.statusCode, 202);
    assert.equal(conflicting.statusCode, 409);
    assert.equal(conflicting.json().error, "schedule_job_idempotency_conflict");
    await app.close();
  });

  it("persists asynchronous schedule jobs through app recreation", async () => {
    const repository = new InMemoryPlatformRepository();
    const firstApp = createApp({ scheduler: new FakeScheduler(), repository });

    const createResponse = await firstApp.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: operatorHeaders,
    });
    assert.equal(createResponse.statusCode, 202);
    const created = createResponse.json();

    await waitFor(async () => {
      const response = await firstApp.inject({
        method: "GET",
        url: `/api/schedule-jobs/${created.job.id}`,
        headers: viewerHeaders,
      });
      return response.json().job.status === "succeeded";
    });
    await firstApp.close();

    const secondApp = createApp({ scheduler: new FakeScheduler(), repository });
    const restoredResponse = await secondApp.inject({
      method: "GET",
      url: `/api/schedule-jobs/${created.job.id}`,
      headers: viewerHeaders,
    });
    assert.equal(restoredResponse.statusCode, 200);
    assert.equal(restoredResponse.json().job.status, "succeeded");
    assert.ok(restoredResponse.json().job.runId);

    await secondApp.close();
  });

  it("marks interrupted asynchronous schedule jobs as failed on startup", async () => {
    const repository = new InMemoryPlatformRepository();
    const queuedJob = await repository.createScheduleJob({
      batchId: "batch-2026-spring-final",
      idempotencyKey: "recovery-queued-job",
      requestDigest: "a".repeat(64),
      traceId: "trace-recovery-queued",
    });
    const runningJob = await repository.createScheduleJob({
      batchId: "batch-2026-spring-final",
      idempotencyKey: "recovery-running-job",
      requestDigest: "b".repeat(64),
      traceId: "trace-recovery-running",
    });
    await repository.transitionScheduleJob(runningJob.job.id, {
      to: "running",
      progress: 35,
    });

    const app = createApp({ scheduler: new FakeScheduler(), repository });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/schedule-jobs",
      headers: viewerHeaders,
    });
    assert.equal(response.statusCode, 200);
    const jobs = response.json().jobs;
    const restoredQueuedJob = jobs.find((job: { id: string }) => job.id === queuedJob.job.id);
    const restoredRunningJob = jobs.find((job: { id: string }) => job.id === runningJob.job.id);
    assert.equal(restoredQueuedJob.status, "failed");
    assert.equal(restoredQueuedJob.progress, 100);
    assert.match(restoredQueuedJob.error.message, /interrupted/i);
    assert.equal(restoredRunningJob.status, "failed");
    assert.equal(restoredRunningJob.progress, 100);
    assert.match(restoredRunningJob.error.message, /interrupted/i);

    await app.close();
  });

  it("locks draft assignments and rebalances only unlocked conflicted exams", async () => {
    const app = createApp({ scheduler: new DraftWorkflowScheduler() });

    const runResponse = await app.inject({ method: "POST", url: "/api/schedule-runs", headers: operatorHeaders });
    const run = runResponse.json();
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
    });
    const draft = draftResponse.json();

    const lockResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-data-structures/lock`,
      headers: operatorHeaders,
    });
    assert.equal(lockResponse.statusCode, 200);
    assert.deepEqual(lockResponse.json().lockedExamTaskIds, ["e-data-structures"]);

    const lockedUpdateResponse = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-data-structures`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-lab-1",
      },
    });
    assert.equal(lockedUpdateResponse.statusCode, 409);
    assert.equal(lockedUpdateResponse.json().error, "schedule_draft_assignment_locked");

    await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-101",
        time_slot_id: "s-001",
        teacher_ids: ["t-zhang"],
      },
    });

    const rebalanceResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/rebalance`,
      headers: operatorHeaders,
    });
    assert.equal(rebalanceResponse.statusCode, 200);
    assert.equal(rebalanceResponse.json().draft.status, "validated");
    assert.equal(rebalanceResponse.json().conflicts.length, 0);
    assert.deepEqual(rebalanceResponse.json().lockedExamTaskIds, ["e-data-structures"]);

    const unlockResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-data-structures/unlock`,
      headers: operatorHeaders,
    });
    assert.equal(unlockResponse.statusCode, 200);
    assert.deepEqual(unlockResponse.json().lockedExamTaskIds, []);

    await app.close();
  });

  it("creates a reschedule run from draft locks without mutating the source draft", async () => {
    const scheduler = new DraftWorkflowScheduler();
    const app = createApp({ scheduler });
    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const run = runResponse.json();
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
    });
    const draft = draftResponse.json();
    await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-data-structures/lock`,
      headers: operatorHeaders,
    });
    const beforeResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-drafts/${draft.draft.id}`,
      headers: viewerHeaders,
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/reschedule`,
      headers: operatorHeaders,
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().sourceDraftId, draft.draft.id);
    assert.deepEqual(response.json().reschedule.frozen_exam_task_ids, ["e-data-structures"]);
    assert.deepEqual(
      scheduler.lastInput?.reschedule_context?.movable_exam_task_ids,
      ["e-ai", "e-calculus", "e-database", "e-english", "e-os"],
    );
    const afterResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-drafts/${draft.draft.id}`,
      headers: viewerHeaders,
    });
    assert.deepEqual(afterResponse.json(), beforeResponse.json());

    const viewerResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/reschedule`,
      headers: viewerHeaders,
    });
    assert.equal(viewerResponse.statusCode, 403);

    const adminResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/reschedule`,
      headers: adminHeaders,
    });
    assert.equal(adminResponse.statusCode, 201);
    await app.close();
  });

  it("returns explicit errors when a draft reschedule source is missing or terminal", async () => {
    const app = createApp({ scheduler: new DraftWorkflowScheduler() });
    const missingResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-drafts/draft-missing/reschedule",
      headers: operatorHeaders,
    });
    assert.equal(missingResponse.statusCode, 404);
    assert.equal(missingResponse.json().error, "schedule_draft_not_found");

    for (const terminalAction of ["publish", "discard"] as const) {
      const runResponse = await app.inject({ method: "POST", url: "/api/schedule-runs", headers: operatorHeaders });
      const draftResponse = await app.inject({
        method: "POST",
        url: `/api/schedule-runs/${runResponse.json().run.id}/drafts`,
        headers: operatorHeaders,
      });
      const draftId = draftResponse.json().draft.id;
      const terminalResponse = await app.inject({
        method: "POST",
        url: `/api/schedule-drafts/${draftId}/${terminalAction}`,
        headers: terminalAction === "publish" ? adminHeaders : operatorHeaders,
      });
      assert.equal(terminalResponse.statusCode, 200);

      const response = await app.inject({
        method: "POST",
        url: `/api/schedule-drafts/${draftId}/reschedule`,
        headers: operatorHeaders,
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error, "schedule_draft_not_editable");
    }
    await app.close();
  });

  it("exposes persistent draft assignment locks in the database schema", () => {
    assert.ok("locked" in draftScheduledExams);
  });

  it("exposes migration state, job persistence, and integrity constraints", async () => {
    assert.equal(migrationStateTableName, "schema_migrations");
    assert.ok("status" in scheduleJobs);
    assert.ok(criticalMigrationTables.includes("exam_task_student_groups"));
    assert.ok(criticalMigrationTables.includes("scheduled_exam_invigilators"));
    assert.ok(criticalMigrationTables.includes("draft_exam_invigilators"));
    assert.ok(criticalMigrationTables.includes("teacher_unavailable_slots"));

    const migrations = await loadMigrationFiles();
    const sql = migrations.map((migration) => migration.sql).join("\n");
    assert.ok(migrations.some((migration) => migration.id === "0005_auth_jobs_constraints"));
    assert.ok(migrations.some((migration) => migration.id === "0007_association_tables"));
    assert.match(sql, /CREATE TABLE IF NOT EXISTS schedule_jobs/);
    assert.match(sql, /FOREIGN KEY \(batch_id\) REFERENCES exam_batches\(id\)/);
    assert.match(sql, /UNIQUE \(run_id, room_id, time_slot_id\)/);
    assert.match(sql, /DROP CONSTRAINT IF EXISTS draft_scheduled_exams_draft_room_slot_unique/);
  });

  it("enforces roles, updates teacher unavailable slots, previews notifications, and exports CSV", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const forbiddenResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: viewerHeaders,
    });
    assert.equal(forbiddenResponse.statusCode, 403);
    assert.equal(forbiddenResponse.json().error, "permission_denied");

    const unavailableResponse = await app.inject({
      method: "PATCH",
      url: "/api/teachers/t-zhang/unavailable-slots",
      headers: operatorHeaders,
      payload: {
        unavailable_slot_ids: ["s-002", "s-004"],
      },
    });
    assert.equal(unavailableResponse.statusCode, 200);
    assert.deepEqual(unavailableResponse.json().teacher.unavailable_slot_ids, ["s-002", "s-004"]);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const created = createResponse.json();
    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${created.run.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishResponse.statusCode, 200);

    const notificationsResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule/notifications",
    });
    assert.equal(notificationsResponse.statusCode, 200);
    assert.ok(notificationsResponse.json().notifications.length > 0);
    assert.match(notificationsResponse.json().notifications[0].message, /考试安排已发布/);

    const unauthenticatedExportResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule/export.csv",
    });
    assert.equal(unauthenticatedExportResponse.statusCode, 401);

    const exportResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule/export.csv",
      headers: viewerHeaders,
    });
    assert.equal(exportResponse.statusCode, 200);
    assert.match(exportResponse.headers["content-type"] as string, /text\/csv/);
    assert.match(exportResponse.body, /course,time_slot,room,teachers/);

    const auditResponse = await app.inject({
      method: "GET",
      url: `/api/audit-events?entityType=schedule_run&entityId=${created.run.id}&actor=student`,
      headers: adminHeaders,
    });
    assert.equal(auditResponse.statusCode, 200);
    assert.equal(auditResponse.json().events[0].action, "published_schedule.exported");

    await app.close();
  });
});

function buildRescheduleContext() {
  return {
    baseline_assignments: [
      {
        exam_task_id: "e-data-structures",
        room_id: "r-101",
        time_slot_id: "s-001",
        teacher_ids: ["t-zhang"],
      },
    ],
    movable_exam_task_ids: ["e-data-structures"],
  };
}

async function waitFor(assertion: () => Promise<boolean>, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for condition.");
}
