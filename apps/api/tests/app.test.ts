import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  criticalMigrationTables,
  draftScheduledExams,
  loadMigrationFiles,
  migrationStateTableName,
  scheduleJobs,
} from "@examforge/db";
import {
  demoScheduleInput,
  type ScheduleInput,
  type ScheduleResult,
} from "@examforge/shared";
import { createApp as createProductionApp, type AppOptions } from "../src/app.js";
import { InMemoryPlatformRepository, type PlatformRepository } from "../src/repository.js";
import { hashLoginAttemptKey, hashSessionToken } from "../src/auth/security.js";
import {
  SchedulerClientError,
  type SchedulerClient,
} from "../src/scheduler-client.js";
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
      credentialVersion: 1,
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
        scoring_contract_version: 1,
        normalized_score: 0,
        total_raw_penalty: 0,
        total_weighted_penalty: 0,
        normalized_penalty_items: [],
      },
      statistics: {
        status: "infeasible",
        elapsed_ms: 1,
        exam_count: input.exam_tasks.length,
        room_count: input.rooms.length,
        slot_count: input.time_slots.length,
        attempted_assignments: 0,
      },
      diagnostics: [],
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
          scoring_contract_version: 1,
          normalized_score: 96,
          total_raw_penalty: 0,
          total_weighted_penalty: 0,
          normalized_penalty_items: [],
        },
        statistics: {
          status: "feasible",
          elapsed_ms: 20,
          exam_count: baseline.length,
          room_count: input.rooms.length,
          slot_count: input.time_slots.length,
          attempted_assignments: baseline.length,
        },
        diagnostics: [],
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

class FailingScheduler implements SchedulerClient {
  constructor(private readonly error: SchedulerClientError) {}

  async solve(): Promise<ScheduleResult> {
    throw this.error;
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

  it("maps scheduler client failures to stable sanitized HTTP errors", async () => {
    const cases = [
      {
        failure: new SchedulerClientError(
          "Schedule input failed semantic validation.",
          "validation",
          "scheduler_input_invalid",
          false,
          "trace-http-validation",
        ),
        expectedStatus: 422,
      },
      {
        failure: new SchedulerClientError(
          "Scheduler request exceeded its deadline.",
          "timeout",
          "scheduler_timeout",
          true,
          "trace-http-timeout",
        ),
        expectedStatus: 504,
      },
      {
        failure: new SchedulerClientError(
          "Scheduler service is unavailable.",
          "unavailable",
          "scheduler_unavailable",
          true,
          "trace-http-unavailable",
        ),
        expectedStatus: 503,
      },
    ] as const;

    for (const testCase of cases) {
      const app = createApp({ scheduler: new FailingScheduler(testCase.failure) });

      const response = await app.inject({
        method: "POST",
        url: "/api/schedule-runs",
        headers: operatorHeaders,
      });

      assert.equal(response.statusCode, testCase.expectedStatus);
      assert.deepEqual(response.json(), {
        error: testCase.failure.code,
        message: testCase.failure.message,
        category: testCase.failure.category,
        retryable: testCase.failure.retryable,
        requestId: testCase.failure.requestId,
      });
      assert.doesNotMatch(response.body, /student_groups|constraint_profile/);
      await app.close();
    }
  });

  it("returns dashboard data", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: operatorHeaders,
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
      headers: operatorHeaders,
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

  it("freezes fixed assignments without executing schedule jobs in the API", async () => {
    const scheduler = new FakeScheduler();
    const repository = new InMemoryPlatformRepository();
    const fixedAssignments = [
      {
        exam_task_id: "e-data-structures",
        room_id: "r-101",
        time_slot_id: "s-001",
        teacher_ids: ["t-zhang"],
      },
    ];
    const app = createApp({ scheduler, repository });

    const response = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: operatorHeaders,
      payload: {
        fixed_assignments: fixedAssignments,
      },
    });
    assert.equal(response.statusCode, 202);
    const claim = await repository.claimScheduleJob(response.json().job.id);
    assert.equal(claim.resolution, "claimed");
    assert.ok(claim.resolution === "claimed");
    assert.deepEqual(claim.requestSnapshot.input.fixed_assignments, fixedAssignments);
    assert.equal(scheduler.lastInput, null);
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

  it("freezes reschedule context without executing schedule jobs in the API", async () => {
    const scheduler = new FakeScheduler();
    const repository = new InMemoryPlatformRepository();
    const app = createApp({ scheduler, repository });
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
    const claim = await repository.claimScheduleJob(response.json().job.id);
    assert.equal(claim.resolution, "claimed");
    assert.ok(claim.resolution === "claimed");
    assert.deepEqual(claim.requestSnapshot.input.reschedule_context, rescheduleContext);
    assert.equal(scheduler.lastInput, null);
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

  it("temporarily locks repeated failed logins without allowing a correct password to bypass it", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });
    const login = (password: string) => app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:3000" },
      remoteAddress: "203.0.113.17",
      payload: {
        username: "operator",
        password,
      },
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      assert.equal((await login("wrong-password")).statusCode, 401);
    }

    const locked = await login("wrong-password");
    assert.equal(locked.statusCode, 429);
    assert.equal(locked.json().error, "login_temporarily_locked");
    assert.ok(Number(locked.headers["retry-after"]) > 0);

    const bypassAttempt = await login("operator-password");
    assert.equal(bypassAttempt.statusCode, 429);
    assert.equal(bypassAttempt.json().error, "login_temporarily_locked");

    await app.close();
  });

  it("uses forwarded login sources only from a loopback reverse proxy", async () => {
    const repository = new InMemoryPlatformRepository({ authUsers: testAuthUsers });
    const app = createApp({ repository, scheduler: new FakeScheduler() });
    const forwardedSource = "203.0.113.23";

    const forwarded = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: {
        origin: "http://localhost:3000",
        "x-forwarded-for": forwardedSource,
      },
      remoteAddress: "127.0.0.1",
      payload: { username: "operator", password: "wrong-password" },
    });
    assert.equal(forwarded.statusCode, 401);
    assert.equal(
      (await repository.getLoginFailureLock(
        hashLoginAttemptKey(forwardedSource, "operator"),
        new Date().toISOString(),
      )).failureCount,
      1,
    );

    const untrusted = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: {
        origin: "http://localhost:3000",
        "x-forwarded-for": forwardedSource,
      },
      remoteAddress: "198.51.100.24",
      payload: { username: "operator", password: "wrong-password" },
    });
    assert.equal(untrusted.statusCode, 401);
    assert.equal(
      (await repository.getLoginFailureLock(
        hashLoginAttemptKey(forwardedSource, "operator"),
        new Date().toISOString(),
      )).failureCount,
      1,
    );
    assert.equal(
      (await repository.getLoginFailureLock(
        hashLoginAttemptKey("198.51.100.24", "operator"),
        new Date().toISOString(),
      )).failureCount,
      1,
    );

    await app.close();
  });

  it("shares a login lock across equivalent normalized usernames", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });
    const login = (username: string) => app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:3000" },
      remoteAddress: "203.0.113.25",
      payload: { username, password: "wrong-password" },
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      assert.equal((await login("  ＯＰＥＲＡＴＯＲ  ")).statusCode, 401);
    }
    assert.equal((await login("operator")).statusCode, 429);

    await app.close();
  });

  it("enforces server-side roles for operational reads", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });
    const operationalReads = [
      { path: "/api/dashboard", allowedRoles: ["admin", "operator"] },
      { path: "/api/reference-data", allowedRoles: ["admin", "operator"] },
      { path: "/api/constraint-profiles", allowedRoles: ["admin", "operator"] },
      { path: "/api/constraint-profiles/constraint-profile-default", allowedRoles: ["admin", "operator"] },
      { path: "/api/schedule-jobs", allowedRoles: ["admin", "operator"] },
      { path: "/api/schedule-jobs/missing-job", allowedRoles: ["admin", "operator"] },
      { path: "/api/schedule-runs", allowedRoles: ["admin", "operator"] },
      { path: "/api/schedule-runs/missing-run", allowedRoles: ["admin", "operator"] },
      {
        path: "/api/schedule-runs/compare?baseId=missing-a&targetId=missing-b",
        allowedRoles: ["admin", "operator"],
      },
      { path: "/api/schedule-drafts", allowedRoles: ["admin", "operator"] },
      { path: "/api/schedule-drafts/missing-draft", allowedRoles: ["admin", "operator"] },
      {
        path: "/api/schedule-drafts/missing-draft/compare",
        allowedRoles: ["admin", "operator"],
      },
      {
        path: "/api/schedule-drafts/missing-draft/assignments/missing-exam/suggestions",
        allowedRoles: ["admin", "operator"],
      },
      { path: "/api/audit-events", allowedRoles: ["admin"] },
      {
        path: "/api/published-schedule/teachers/t-zhang",
        allowedRoles: ["admin", "operator"],
      },
      {
        path: "/api/published-schedule/student-groups/g-cs-2301",
        allowedRoles: ["admin", "operator"],
      },
      { path: "/api/published-schedule/operations", allowedRoles: ["admin", "operator"] },
    ];

    for (const { path, allowedRoles } of operationalReads) {
      for (const headers of [undefined, { authorization: "Bearer forged-token" }]) {
        const response = await app.inject({ method: "GET", url: path, headers });
        assert.equal(response.statusCode, 401, `${path} must reject unauthenticated reads`);
        assert.equal(response.json().error, "not_authenticated");
      }

      for (const [role, headers] of [
        ["teacher", testAuthHeaders.teacher],
        ["student", testAuthHeaders.student],
      ] as const) {
        const response = await app.inject({ method: "GET", url: path, headers });
        assert.equal(response.statusCode, 403, `${path} must reject ${role} reads`);
        assert.equal(response.json().error, "permission_denied");
      }

      for (const [role, headers] of [
        ["admin", adminHeaders],
        ["operator", operatorHeaders],
      ] as const) {
        const response = await app.inject({ method: "GET", url: path, headers });
        if (allowedRoles.includes(role)) {
          assert.notEqual(response.statusCode, 401, `${path} must accept ${role} authentication`);
          assert.notEqual(response.statusCode, 403, `${path} must allow ${role} reads`);
        } else {
          assert.equal(response.statusCode, 403, `${path} must reject ${role} reads`);
        }
      }
    }

    await app.close();
  });

  it("keeps only aggregate published reads anonymous and protects audience previews", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });
    for (const path of [
      "/api/published-schedule",
      "/api/published-schedule/notifications",
    ]) {
      const response = await app.inject({ method: "GET", url: path });
      assert.equal(response.statusCode, 404);
      assert.notEqual(response.json().error, "not_authenticated");
    }

    for (const path of [
      "/api/published-schedule/teachers/t-zhang",
      "/api/published-schedule/student-groups/g-cs-2301",
      "/api/published-schedule/operations",
    ]) {
      const anonymousResponse = await app.inject({ method: "GET", url: path });
      assert.equal(anonymousResponse.statusCode, 401);
      const audienceResponse = await app.inject({
        method: "GET",
        url: path,
        headers: testAuthHeaders.teacher,
      });
      assert.equal(audienceResponse.statusCode, 403);
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
      headers: operatorHeaders,
    });
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(
      listResponse.json().runs.map((run: { id: string }) => run.id),
      [second.run.id, first.run.id],
    );

    const auditResponse = await app.inject({
      method: "GET",
      url: "/api/audit-events",
      headers: adminHeaders,
    });
    assert.equal(auditResponse.statusCode, 200);
    assert.equal(auditResponse.json().events.length, 2);
    assert.equal(auditResponse.json().events[0].action, "schedule_run.created");

    const filteredAuditResponse = await app.inject({
      method: "GET",
      url: `/api/audit-events?entityType=schedule_run&entityId=${first.run.id}&actor=operator`,
      headers: adminHeaders,
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
      headers: adminHeaders,
    });
    assert.equal(invalidAuditFilterResponse.statusCode, 400);
    assert.equal(invalidAuditFilterResponse.json().error, "invalid_audit_filter");

    const compareResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/compare?baseId=${first.run.id}&targetId=${second.run.id}`,
      headers: operatorHeaders,
    });
    assert.equal(compareResponse.statusCode, 200);
    assert.equal(compareResponse.json().baseRun.id, first.run.id);
    assert.equal(compareResponse.json().targetRun.id, second.run.id);
    assert.equal(compareResponse.json().deltas.score, 1);

    await app.close();
  });

  it("keeps in-memory run and audit pagination in creation order when timestamps are equal", async () => {
    mock.timers.enable({
      apis: ["Date"],
      now: new Date("2026-07-23T12:00:00.000Z"),
    });
    const app = createApp({ scheduler: new FakeScheduler() });
    try {
      const createdRunIds: string[] = [];
      for (let index = 0; index < 10; index += 1) {
        const response = await app.inject({
          method: "POST",
          url: "/api/schedule-runs",
          headers: operatorHeaders,
        });
        assert.equal(response.statusCode, 201);
        createdRunIds.push(response.json().run.id);
      }

      const expected = [...createdRunIds].reverse();
      const [firstRunPage, secondRunPage] = await Promise.all([1, 2].map((page) => app.inject({
        method: "GET",
        url: `/api/schedule-runs?page=${page}&pageSize=5`,
        headers: operatorHeaders,
      })));
      assert.deepEqual(
        [...firstRunPage.json().runs, ...secondRunPage.json().runs]
          .map((run: { id: string }) => run.id),
        expected,
      );

      const [firstAuditPage, secondAuditPage] = await Promise.all([1, 2].map((page) => app.inject({
        method: "GET",
        url: `/api/audit-events?action=schedule_run.created&page=${page}&pageSize=5`,
        headers: adminHeaders,
      })));
      assert.deepEqual(
        [...firstAuditPage.json().events, ...secondAuditPage.json().events]
          .map((event: { entityId: string }) => event.entityId),
        expected,
      );
    } finally {
      await app.close();
      mock.timers.reset();
    }
  });

  it("filters and paginates schedule runs and audit events with stable metadata", async () => {
    const repository = new InMemoryPlatformRepository({ authUsers: testAuthUsers });
    const app = createApp({ repository, scheduler: new FakeScheduler() });
    const profiles = await repository.listConstraintProfiles(true);
    const profile = profiles.find((candidate) => candidate.isDefault) ?? profiles[0];
    const version = profile?.versions.find((candidate) => candidate.id === profile.currentVersionId);
    assert.ok(profile && version);
    for (const [index, status] of ["feasible", "infeasible", "feasible"].entries()) {
      const result = buildCompleteScheduleResult(demoScheduleInput);
      result.statistics.status = status as ScheduleResult["statistics"]["status"];
      await repository.createScheduleRun(result, {
        constraintProfileVersionId: version.id,
        constraintProfileSnapshot: {
          schemaVersion: 1,
          profileId: profile.id,
          profileVersionId: version.id,
          versionNumber: version.versionNumber,
          digest: version.digest,
          config: version.config,
        },
        schedulerVersion: `test-${index}`,
      });
    }

    const feasiblePage = await app.inject({
      method: "GET",
      url: "/api/schedule-runs?status=feasible&page=1&pageSize=1",
      headers: operatorHeaders,
    });
    assert.equal(feasiblePage.statusCode, 200);
    assert.equal(feasiblePage.json().runs.length, 1);
    assert.equal(feasiblePage.json().total, 2);
    assert.equal(feasiblePage.json().pageCount, 2);

    const emptyRunPage = await app.inject({
      method: "GET",
      url: "/api/schedule-runs?page=99&pageSize=20",
      headers: operatorHeaders,
    });
    assert.deepEqual(emptyRunPage.json().runs, []);
    assert.equal(emptyRunPage.json().total, 3);

    const invalidRunFilter = await app.inject({
      method: "GET",
      url: "/api/schedule-runs?status=published",
      headers: operatorHeaders,
    });
    assert.equal(invalidRunFilter.statusCode, 400);
    assert.equal(invalidRunFilter.json().error, "invalid_schedule_run_filter");

    await repository.recordAuditEvent?.(
      "test.trace.created",
      "schedule_run",
      "trace-run-1",
      { traceId: "trace-list-1" },
      "operator",
    );
    await repository.recordAuditEvent?.(
      "test.trace.updated",
      "schedule_run",
      "trace-run-2",
      { traceId: "trace-list-2" },
      "admin",
    );
    const auditPage = await app.inject({
      method: "GET",
      url: "/api/audit-events?action=test.trace.created&traceId=trace-list-1&page=1&pageSize=1",
      headers: adminHeaders,
    });
    assert.equal(auditPage.statusCode, 200);
    assert.equal(auditPage.json().events.length, 1);
    assert.equal(auditPage.json().events[0].action, "test.trace.created");
    assert.equal(auditPage.json().total, 1);
    assert.equal(auditPage.json().page, 1);
    assert.equal(auditPage.json().pageSize, 1);

    const emptyAuditPage = await app.inject({
      method: "GET",
      url: "/api/audit-events?action=test.trace.created&page=9&pageSize=20",
      headers: adminHeaders,
    });
    assert.deepEqual(emptyAuditPage.json().events, []);
    assert.equal(emptyAuditPage.json().total, 1);

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
    assert.equal(publishedResponse.json().contractVersion, 1);
    assert.equal(publishedResponse.json().entries.length, 6);

    const operationalResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule/operations",
      headers: operatorHeaders,
    });
    assert.equal(operationalResponse.statusCode, 200);
    assert.equal(operationalResponse.json().run.id, created.run.id);

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

  it("projects anonymous published schedules and notifications without operational run data", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const created = (await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    })).json();
    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${created.run.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishResponse.statusCode, 200);

    const publishedResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule",
    });
    assert.equal(publishedResponse.statusCode, 200);
    const published = publishedResponse.json();
    assert.equal(published.contractVersion, 1);
    assert.deepEqual(Object.keys(published).sort(), ["batch", "contractVersion", "entries"]);
    assert.deepEqual(Object.keys(published.batch).sort(), ["endDate", "name", "startDate"]);
    assert.ok(published.entries.length > 0);
    assert.deepEqual(Object.keys(published.entries[0]).sort(), [
      "courseName",
      "date",
      "endTime",
      "roomName",
      "startTime",
      "studentGroupNames",
    ]);

    const notificationsResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule/notifications",
    });
    assert.equal(notificationsResponse.statusCode, 200);
    const notifications = notificationsResponse.json();
    assert.equal(notifications.contractVersion, 1);
    assert.deepEqual(Object.keys(notifications).sort(), ["batch", "contractVersion", "notifications"]);
    assert.ok(notifications.notifications.length > 0);
    assert.deepEqual(Object.keys(notifications.notifications[0]).sort(), [
      "assignmentCount",
      "message",
      "studentGroupName",
    ]);

    for (const response of [published, notifications]) {
      const serialized = JSON.stringify(response);
      for (const field of [
        "run",
        "result",
        "score",
        "conflicts",
        "diagnostics",
        "report",
        "statistics",
        "constraintProfile",
        "exam_task_id",
        "room_id",
        "time_slot_id",
        "teacher_ids",
        "studentGroupId",
      ]) {
        assert.equal(serialized.includes(`\"${field}\"`), false, `${field} must not be public`);
      }
    }

    for (const headers of [undefined, { authorization: "Bearer forged-token" }]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/published-schedule/operations",
        headers,
      });
      assert.equal(response.statusCode, 401);
    }
    for (const headers of [testAuthHeaders.teacher, testAuthHeaders.student]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/published-schedule/operations",
        headers,
      });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error, "permission_denied");
    }
    for (const headers of [adminHeaders, operatorHeaders]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/published-schedule/operations",
        headers,
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().run.id, created.run.id);
      assert.ok(response.json().result.score.total_score > 0);
    }

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
      headers: operatorHeaders,
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
      headers: operatorHeaders,
    });
    assert.equal(teacherResponse.statusCode, 200);
    assert.equal(teacherResponse.json().viewer.id, teacher.id);
    assert.ok(teacherResponse.json().assignments.length > 0);
    assert.equal(teacherResponse.json().assignments[0].teachers[0].id, teacher.id);

    const studentResponse = await app.inject({
      method: "GET",
      url: `/api/published-schedule/student-groups/${studentGroup.id}`,
      headers: adminHeaders,
    });
    assert.equal(studentResponse.statusCode, 200);
    assert.equal(studentResponse.json().viewer.id, studentGroup.id);
    assert.ok(studentResponse.json().assignments.length > 0);
    assert.equal(studentResponse.json().assignments[0].studentGroups[0].id, studentGroup.id);

    await app.close();
  });

  it("serves current audience schedules and teacher self-service without arbitrary IDs", async () => {
    const repository = new InMemoryPlatformRepository({ authUsers: testAuthUsers });
    await repository.setTeacherAudienceScope("user-teacher", "t-zhang");
    await repository.addStudentGroupAudienceScope("user-student", "g-cs-2301");
    await repository.addStudentGroupAudienceScope("user-student", "g-ai-2301");
    const app = createApp({ repository, scheduler: new FakeScheduler() });

    const created = (await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    })).json();
    await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${created.run.id}/publish`,
      headers: adminHeaders,
    });

    const teacherAudience = await app.inject({
      method: "GET",
      url: "/api/me/audience",
      headers: testAuthHeaders.teacher,
    });
    assert.equal(teacherAudience.statusCode, 200);
    assert.equal(teacherAudience.json().kind, "teacher");
    assert.equal(teacherAudience.json().teacher.id, "t-zhang");

    const teacherSchedule = await app.inject({
      method: "GET",
      url: "/api/me/published-schedule",
      headers: testAuthHeaders.teacher,
    });
    assert.equal(teacherSchedule.statusCode, 200);
    assert.equal(teacherSchedule.json().kind, "teacher");
    assert.ok(teacherSchedule.json().assignments.length > 0);

    const teacherAvailability = await app.inject({
      method: "GET",
      url: "/api/me/teacher-unavailable-slots",
      headers: testAuthHeaders.teacher,
    });
    assert.equal(teacherAvailability.statusCode, 200);
    assert.equal(teacherAvailability.json().teacher.id, "t-zhang");
    assert.equal(teacherAvailability.json().timeSlots.length, 6);
    assert.equal("exam_tasks" in teacherAvailability.json(), false);

    const studentAvailability = await app.inject({
      method: "GET",
      url: "/api/me/teacher-unavailable-slots",
      headers: testAuthHeaders.student,
    });
    assert.equal(studentAvailability.statusCode, 403);
    assert.equal(studentAvailability.json().error, "audience_scope_invalid");

    const teacherMutation = await app.inject({
      method: "PATCH",
      url: "/api/me/teacher-unavailable-slots",
      headers: testAuthHeaders.teacher,
      payload: { unavailable_slot_ids: ["s-001", "s-004"] },
    });
    assert.equal(teacherMutation.statusCode, 200);
    assert.equal(teacherMutation.json().teacher.id, "t-zhang");
    assert.deepEqual(teacherMutation.json().teacher.unavailable_slot_ids, ["s-001", "s-004"]);

    const arbitraryIdMutation = await app.inject({
      method: "PATCH",
      url: "/api/me/teacher-unavailable-slots",
      headers: testAuthHeaders.teacher,
      payload: { teacherId: "t-li", unavailable_slot_ids: ["s-002"] },
    });
    assert.equal(arbitraryIdMutation.statusCode, 400);

    const studentSchedule = await app.inject({
      method: "GET",
      url: "/api/me/published-schedule",
      headers: testAuthHeaders.student,
    });
    assert.equal(studentSchedule.statusCode, 200);
    assert.equal(studentSchedule.json().kind, "student");
    const studentAssignmentIds = studentSchedule.json().assignments.map(
      (item: { assignment: { exam_task_id: string } }) => item.assignment.exam_task_id,
    );
    assert.equal(new Set(studentAssignmentIds).size, studentAssignmentIds.length);

    const operatorAudience = await app.inject({
      method: "GET",
      url: "/api/me/audience",
      headers: operatorHeaders,
    });
    assert.equal(operatorAudience.statusCode, 403);
    assert.equal(operatorAudience.json().error, "audience_scope_missing");

    const audit = await app.inject({
      method: "GET",
      url: "/api/audit-events?entityType=teacher&entityId=t-zhang",
      headers: adminHeaders,
    });
    assert.equal(audit.statusCode, 200);
    assert.equal(audit.json().events[0].action, "teacher.unavailable_slots_updated");
    assert.equal(audit.json().events[0].actorUserId, "user-teacher");

    await app.close();
  });

  it("governs constraint profiles with admin mutations and operator read access", async () => {
    const app = createApp();

    const operatorList = await app.inject({
      method: "GET",
      url: "/api/constraint-profiles",
      headers: operatorHeaders,
    });
    assert.equal(operatorList.statusCode, 200);
    assert.equal(operatorList.json().profiles.length, 1);
    assert.equal(operatorList.json().profiles[0].isDefault, true);

    const viewerList = await app.inject({
      method: "GET",
      url: "/api/constraint-profiles",
      headers: viewerHeaders,
    });
    assert.equal(viewerList.statusCode, 403);

    const operatorCreate = await app.inject({
      method: "POST",
      url: "/api/constraint-profiles",
      headers: operatorHeaders,
      payload: { name: "Operator cannot create", config: demoScheduleInput.constraint_profile },
    });
    assert.equal(operatorCreate.statusCode, 403);

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/constraint-profiles",
      headers: adminHeaders,
      payload: {
        name: "High quality",
        config: {
          ...demoScheduleInput.constraint_profile,
          soft_weights: {
            ...demoScheduleInput.constraint_profile.soft_weights,
            room_utilization: 9,
          },
        },
      },
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json().profile;
    assert.equal(created.name, "High quality");
    assert.equal(created.versions.length, 1);

    const versionResponse = await app.inject({
      method: "POST",
      url: `/api/constraint-profiles/${created.id}/versions`,
      headers: adminHeaders,
      payload: {
        expectedCurrentVersionId: created.currentVersionId,
        config: {
          ...created.versions[0].config,
          time_limit_seconds: 20,
        },
      },
    });
    assert.equal(versionResponse.statusCode, 201);
    const versioned = versionResponse.json().profile;
    assert.equal(versioned.versions.length, 2);
    assert.equal(versioned.versions[1].versionNumber, 2);

    const staleVersion = await app.inject({
      method: "POST",
      url: `/api/constraint-profiles/${created.id}/versions`,
      headers: adminHeaders,
      payload: {
        expectedCurrentVersionId: created.currentVersionId,
        config: created.versions[0].config,
      },
    });
    assert.equal(staleVersion.statusCode, 409);
    assert.equal(staleVersion.json().error, "constraint_profile_version_conflict");

    const disableDefault = await app.inject({
      method: "PATCH",
      url: "/api/constraint-profiles/constraint-profile-default/status",
      headers: adminHeaders,
      payload: { status: "disabled" },
    });
    assert.equal(disableDefault.statusCode, 409);
    assert.equal(disableDefault.json().error, "default_constraint_profile_cannot_be_disabled");

    const setDefault = await app.inject({
      method: "PUT",
      url: `/api/constraint-profiles/${created.id}/default`,
      headers: adminHeaders,
    });
    assert.equal(setDefault.statusCode, 200);
    assert.equal(setDefault.json().profile.isDefault, true);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/constraint-profiles",
      headers: adminHeaders,
      payload: {
        name: "Invalid",
        config: {
          ...demoScheduleInput.constraint_profile,
          soft_weights: { room_utilization: 1001 },
        },
      },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "invalid_constraint_profile");

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
        listConstraintProfiles: (includeDisabled) => (
          repository.listConstraintProfiles(includeDisabled)
        ),
        getConstraintProfile: (id) => repository.getConstraintProfile(id),
        resolveConstraintProfile: (versionId) => repository.resolveConstraintProfile(versionId),
        createConstraintProfile: (command) => repository.createConstraintProfile(command),
        createConstraintProfileVersion: (command) => (
          repository.createConstraintProfileVersion(command)
        ),
        setConstraintProfileStatus: (command) => (
          repository.setConstraintProfileStatus(command)
        ),
        setDefaultConstraintProfile: (command) => (
          repository.setDefaultConstraintProfile(command)
        ),
        createReferenceRecord: (resource, record) => repository.createReferenceRecord(resource, record),
        updateReferenceRecord: (resource, id, patch) => repository.updateReferenceRecord(resource, id, patch),
        importReferenceRecords: (resource, records) => repository.importReferenceRecords(resource, records),
        deleteReferenceRecord: (resource, id) => repository.deleteReferenceRecord(resource, id),
        createScheduleRun: (result, context) => repository.createScheduleRun(result, context),
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
        getScheduleJobDetail: (id) => repository.getScheduleJobDetail(id),
        requestScheduleJobCancellation: (id) => repository.requestScheduleJobCancellation(id),
        isScheduleJobCancellationRequested: (id) => (
          repository.isScheduleJobCancellationRequested(id)
        ),
        listScheduleJobEvents: (jobId, options) => (
          repository.listScheduleJobEvents(jobId, options)
        ),
        resolveScheduleJobEventCursor: (jobId, eventId) => (
          repository.resolveScheduleJobEventCursor(jobId, eventId)
        ),
        claimScheduleJob: (id, command) => repository.claimScheduleJob(id, command),
        failScheduleJobAttempt: (id, command) => repository.failScheduleJobAttempt(id, command),
        transitionScheduleJob: (id, command) => repository.transitionScheduleJob(id, command),
        completeScheduleJob: (id, command) => repository.completeScheduleJob(id, command),
        createAuthUser: (command) => repository.createAuthUser(command),
        findAuthUserByUsername: (username) => repository.findAuthUserByUsername(username),
        createAuthSession: (command) => repository.createAuthSession(command),
        findAuthSessionByTokenDigest: (digest) => repository.findAuthSessionByTokenDigest(digest),
        revokeAuthSession: (id, revokedAt) => repository.revokeAuthSession(id, revokedAt),
        rotateAuthUserPassword: (command) => repository.rotateAuthUserPassword(command),
        getLoginFailureLock: (keyDigest, attemptedAt) => (
          repository.getLoginFailureLock(keyDigest, attemptedAt)
        ),
        recordLoginFailure: (keyDigest, attemptedAt, policy) => (
          repository.recordLoginFailure(keyDigest, attemptedAt, policy)
        ),
        clearLoginFailures: (keyDigest) => repository.clearLoginFailures(keyDigest),
        getAudienceScope: (userId) => repository.getAudienceScope(userId),
        setTeacherAudienceScope: (userId, teacherId) => (
          repository.setTeacherAudienceScope(userId, teacherId)
        ),
        addStudentGroupAudienceScope: (userId, studentGroupId) => (
          repository.addStudentGroupAudienceScope(userId, studentGroupId)
        ),
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
      headers: operatorHeaders,
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
      headers: operatorHeaders,
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
      headers: operatorHeaders,
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
    assert.equal(publishedResponse.json().contractVersion, 1);
    assert.equal(publishedResponse.json().entries.length, 6);

    const operationalResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule/operations",
      headers: operatorHeaders,
    });
    assert.equal(operationalResponse.statusCode, 200);
    assert.equal(operationalResponse.json().run.id, publishResponse.json().run.id);

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
      headers: operatorHeaders,
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
      headers: adminHeaders,
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
      headers: operatorHeaders,
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

  it("creates durable queued jobs without an API process executor", async () => {
    const scheduler = new FakeScheduler();
    const app = createApp({ scheduler });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: operatorHeaders,
    });
    assert.equal(createResponse.statusCode, 202);
    const created = createResponse.json();
    assert.equal(created.job.status, "queued");
    assert.equal(created.job.progress, 0);

    const jobResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-jobs/${created.job.id}`,
      headers: operatorHeaders,
    });
    assert.equal(jobResponse.statusCode, 200);
    assert.equal(jobResponse.json().job.status, "queued");
    assert.equal(jobResponse.json().job.progress, 0);
    assert.equal(jobResponse.json().job.runId, null);
    assert.deepEqual(jobResponse.json().attempts, []);
    assert.equal(jobResponse.json().events.length, 1);
    assert.equal(jobResponse.json().events[0].type, "schedule_job.queued");

    const deniedList = await app.inject({
      method: "GET",
      url: "/api/schedule-jobs",
      headers: testAuthHeaders.teacher,
    });
    assert.equal(deniedList.statusCode, 403);

    const deniedDetail = await app.inject({
      method: "GET",
      url: `/api/schedule-jobs/${created.job.id}`,
      headers: viewerHeaders,
    });
    assert.equal(deniedDetail.statusCode, 403);
    assert.equal(scheduler.lastInput, null);

    await app.close();
  });

  it("filters and paginates schedule jobs with stable metadata", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });
    const created = [];
    for (const [index, headers] of [operatorHeaders, adminHeaders, operatorHeaders].entries()) {
      const response = await app.inject({
        method: "POST",
        url: "/api/schedule-jobs",
        headers: { ...headers, "idempotency-key": `filters-${index}` },
      });
      assert.equal(response.statusCode, 202);
      created.push(response.json().job);
    }
    await app.inject({
      method: "POST",
      url: `/api/schedule-jobs/${created[0].id}/cancel`,
      headers: operatorHeaders,
    });

    const firstPage = await app.inject({
      method: "GET",
      url: "/api/schedule-jobs?page=1&pageSize=1",
      headers: operatorHeaders,
    });
    assert.equal(firstPage.statusCode, 200);
    assert.equal(firstPage.json().jobs.length, 1);
    assert.equal(firstPage.json().total, 3);
    assert.equal(firstPage.json().page, 1);
    assert.equal(firstPage.json().pageSize, 1);
    assert.equal(firstPage.json().pageCount, 3);

    const adminOnly = await app.inject({
      method: "GET",
      url: "/api/schedule-jobs?submittedBy=admin",
      headers: operatorHeaders,
    });
    assert.equal(adminOnly.json().total, 1);
    assert.equal(adminOnly.json().jobs[0].submittedBy, "admin");

    const cancelledOnly = await app.inject({
      method: "GET",
      url: "/api/schedule-jobs?status=cancelled",
      headers: operatorHeaders,
    });
    assert.equal(cancelledOnly.json().total, 1);
    assert.equal(cancelledOnly.json().jobs[0].id, created[0].id);

    const emptyPage = await app.inject({
      method: "GET",
      url: "/api/schedule-jobs?page=99&pageSize=20",
      headers: operatorHeaders,
    });
    assert.deepEqual(emptyPage.json().jobs, []);
    assert.equal(emptyPage.json().total, 3);
    assert.equal(emptyPage.json().page, 99);

    const invalidDate = await app.inject({
      method: "GET",
      url: "/api/schedule-jobs?from=not-a-date",
      headers: operatorHeaders,
    });
    assert.equal(invalidDate.statusCode, 400);
    assert.equal(invalidDate.json().error, "invalid_schedule_job_filter");

    await app.close();
  });

  it("keeps in-memory schedule-job pagination in creation order when timestamps are equal", async () => {
    mock.timers.enable({
      apis: ["Date"],
      now: new Date("2026-07-23T12:00:00.000Z"),
    });
    const app = createApp({ scheduler: new FakeScheduler() });
    try {
      const createdJobIds: string[] = [];
      for (let index = 0; index < 10; index += 1) {
        const response = await app.inject({
          method: "POST",
          url: "/api/schedule-jobs",
          headers: { ...operatorHeaders, "idempotency-key": `same-timestamp-job-${index}` },
        });
        assert.equal(response.statusCode, 202);
        createdJobIds.push(response.json().job.id);
      }

      const expected = [...createdJobIds].reverse();
      const [firstPage, secondPage] = await Promise.all([1, 2].map((page) => app.inject({
        method: "GET",
        url: `/api/schedule-jobs?page=${page}&pageSize=5`,
        headers: operatorHeaders,
      })));
      assert.deepEqual(
        [...firstPage.json().jobs, ...secondPage.json().jobs]
          .map((job: { id: string }) => job.id),
        expected,
      );
    } finally {
      await app.close();
      mock.timers.reset();
    }
  });

  it("cancels queued jobs and records cooperative cancellation for running jobs", async () => {
    const repository = new InMemoryPlatformRepository();
    const app = createApp({ scheduler: new FakeScheduler(), repository });
    const queued = await repository.createScheduleJob({
      batchId: "batch-2026-spring-final",
      idempotencyKey: "cancel-queued-job",
      requestDigest: "d".repeat(64),
      requestSnapshot: { version: 1, input: demoScheduleInput },
      traceId: "trace-cancel-queued-job",
    });
    const running = await repository.createScheduleJob({
      batchId: "batch-2026-spring-final",
      idempotencyKey: "cancel-running-job",
      requestDigest: "e".repeat(64),
      requestSnapshot: { version: 1, input: demoScheduleInput },
      traceId: "trace-cancel-running-job",
    });
    await repository.claimScheduleJob(running.job.id, { deliveryAttempt: 1 });

    const denied = await app.inject({
      method: "POST",
      url: `/api/schedule-jobs/${queued.job.id}/cancel`,
      headers: testAuthHeaders.teacher,
    });
    assert.equal(denied.statusCode, 403);

    const queuedCancellation = await app.inject({
      method: "POST",
      url: `/api/schedule-jobs/${queued.job.id}/cancel`,
      headers: operatorHeaders,
    });
    assert.equal(queuedCancellation.statusCode, 200);
    assert.equal(queuedCancellation.json().job.status, "cancelled");
    assert.equal(queuedCancellation.json().job.progress, 100);
    assert.ok(queuedCancellation.json().job.cancellationRequestedAt);

    const runningCancellation = await app.inject({
      method: "POST",
      url: `/api/schedule-jobs/${running.job.id}/cancel`,
      headers: operatorHeaders,
    });
    assert.equal(runningCancellation.statusCode, 202);
    assert.equal(runningCancellation.json().job.status, "running");
    assert.ok(runningCancellation.json().job.cancellationRequestedAt);

    const duplicateCancellation = await app.inject({
      method: "POST",
      url: `/api/schedule-jobs/${running.job.id}/cancel`,
      headers: operatorHeaders,
    });
    assert.equal(duplicateCancellation.statusCode, 200);
    assert.equal(duplicateCancellation.json().job.status, "running");

    const missing = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs/missing-job/cancel",
      headers: operatorHeaders,
    });
    assert.equal(missing.statusCode, 404);

    await app.close();
  });

  it("streams authorized schedule job history as versioned SSE frames", async () => {
    const repository = new InMemoryPlatformRepository();
    const created = await repository.createScheduleJob({
      batchId: "batch-2026-spring-final",
      idempotencyKey: "sse-terminal-job",
      requestDigest: "f".repeat(64),
      requestSnapshot: { version: 1, input: demoScheduleInput },
      traceId: "trace-sse-terminal-job",
    });
    await repository.requestScheduleJobCancellation(created.job.id);
    const history = await repository.listScheduleJobEvents(created.job.id);
    const app = createApp({
      scheduler: new FakeScheduler(),
      repository,
      eventNotifier: {
        async subscribe() {
          return async () => undefined;
        },
      },
    });

    const unauthenticated = await app.inject({
      method: "GET",
      url: `/api/schedule-jobs/${created.job.id}/events`,
    });
    assert.equal(unauthenticated.statusCode, 401);
    const forbidden = await app.inject({
      method: "GET",
      url: `/api/schedule-jobs/${created.job.id}/events`,
      headers: testAuthHeaders.teacher,
    });
    assert.equal(forbidden.statusCode, 403);
    const unknownCursor = await app.inject({
      method: "GET",
      url: `/api/schedule-jobs/${created.job.id}/events`,
      headers: { ...operatorHeaders, "last-event-id": "event-missing" },
    });
    assert.equal(unknownCursor.statusCode, 400);
    assert.equal(unknownCursor.json().error, "schedule_job_event_cursor_unknown");

    const response = await app.inject({
      method: "GET",
      url: `/api/schedule-jobs/${created.job.id}/events`,
      headers: operatorHeaders,
    });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers["content-type"]), /^text\/event-stream/);
    assert.match(response.body, new RegExp(`id: ${history[0].eventId}`));
    assert.match(response.body, /event: schedule_job\.queued\.v1/);
    assert.match(response.body, /event: schedule_job\.cancelled\.v1/);
    const dataLines = response.body
      .split("\n")
      .filter((line) => line.startsWith("data: "));
    assert.deepEqual(
      dataLines.map((line) => JSON.parse(line.slice(6)).eventId),
      history.map((event) => event.eventId),
    );

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

  it("preserves queued schedule jobs through app recreation", async () => {
    const repository = new InMemoryPlatformRepository();
    const firstApp = createApp({ scheduler: new FakeScheduler(), repository });

    const createResponse = await firstApp.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: operatorHeaders,
    });
    assert.equal(createResponse.statusCode, 202);
    const created = createResponse.json();

    await firstApp.close();

    const secondApp = createApp({ scheduler: new FakeScheduler(), repository });
    const restoredResponse = await secondApp.inject({
      method: "GET",
      url: `/api/schedule-jobs/${created.job.id}`,
      headers: operatorHeaders,
    });
    assert.equal(restoredResponse.statusCode, 200);
    assert.equal(restoredResponse.json().job.status, "queued");
    assert.equal(restoredResponse.json().job.runId, null);

    await secondApp.close();
  });

  it("does not rewrite queued or running jobs on API startup", async () => {
    const repository = new InMemoryPlatformRepository();
    const queuedJob = await repository.createScheduleJob({
      batchId: "batch-2026-spring-final",
      idempotencyKey: "recovery-queued-job",
      requestDigest: "a".repeat(64),
      requestSnapshot: { version: 1, input: demoScheduleInput },
      traceId: "trace-recovery-queued",
    });
    const runningJob = await repository.createScheduleJob({
      batchId: "batch-2026-spring-final",
      idempotencyKey: "recovery-running-job",
      requestDigest: "b".repeat(64),
      requestSnapshot: { version: 1, input: demoScheduleInput },
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
      headers: operatorHeaders,
    });
    assert.equal(response.statusCode, 200);
    const jobs = response.json().jobs;
    const restoredQueuedJob = jobs.find((job: { id: string }) => job.id === queuedJob.job.id);
    const restoredRunningJob = jobs.find((job: { id: string }) => job.id === runningJob.job.id);
    assert.equal(restoredQueuedJob.status, "queued");
    assert.equal(restoredQueuedJob.progress, 0);
    assert.equal(restoredQueuedJob.error, null);
    assert.equal(restoredRunningJob.status, "running");
    assert.equal(restoredRunningJob.progress, 35);
    assert.equal(restoredRunningJob.error, null);

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
      headers: operatorHeaders,
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
      headers: operatorHeaders,
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

    for (const [role, headers] of [
      ["teacher", testAuthHeaders.teacher],
      ["student", viewerHeaders],
    ] as const) {
      const response = await app.inject({
        method: "GET",
        url: "/api/published-schedule/export.csv",
        headers,
      });
      assert.equal(response.statusCode, 403, `CSV export must reject ${role}`);
      assert.equal(response.json().error, "permission_denied");
    }

    for (const [role, headers] of [
      ["admin", adminHeaders],
      ["operator", operatorHeaders],
    ] as const) {
      const response = await app.inject({
        method: "GET",
        url: "/api/published-schedule/export.csv",
        headers,
      });
      assert.equal(response.statusCode, 200, `CSV export must allow ${role}`);
      assert.match(response.headers["content-type"] as string, /text\/csv/);
      assert.match(response.body, /course,time_slot,room,teachers/);
    }

    const auditResponse = await app.inject({
      method: "GET",
      url: `/api/audit-events?entityType=schedule_run&entityId=${created.run.id}&actor=operator`,
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
