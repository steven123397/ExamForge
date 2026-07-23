import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  authLoginAttempts,
  auditEvents,
  conflictRecords,
  createDbClient,
  draftExamInvigilators,
  draftScheduledExams,
  examTasks,
  examTaskStudentGroups,
  runMigrations,
  outboxEvents,
  scheduleJobAttempts,
  scheduleJobEvents,
  scheduleJobs,
  scheduleRuns,
  sessions,
  scheduledExamInvigilators,
  scheduledExams,
  seedDemoData,
  teacherUnavailableSlots,
  teachers,
  type ExamForgeDbClient,
} from "@examforge/db";
import type { ScheduleInput, ScheduleResult } from "@examforge/shared";
import { asc, eq, sql } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { AccountRotationService } from "../../src/auth/account-rotation-service.js";
import { AuthService } from "../../src/auth/auth-service.js";
import { PostgresPlatformRepository } from "../../src/postgres-repository.js";
import { hashLoginAttemptKey, hashSessionToken } from "../../src/auth/security.js";
import type { SchedulerClient, SchedulerSolveOptions } from "../../src/scheduler-client.js";
import {
  buildCompleteScheduleResult,
  seedTestAuth,
  testAuthHeaders,
} from "../test-fixtures.js";

const adminHeaders = testAuthHeaders.admin;
const operatorHeaders = testAuthHeaders.operator;
const viewerHeaders = testAuthHeaders.student;
const scheduleDraftLockNamespace = 20_260_711;

const testDatabaseUrl = getTestDatabaseUrl();
let client: ExamForgeDbClient | null = null;

class PostgresDraftScheduler implements SchedulerClient {
  lastInput: ScheduleInput | null = null;

  async solve(input: ScheduleInput, options?: SchedulerSolveOptions): Promise<ScheduleResult> {
    this.lastInput = structuredClone(input);
    options?.onMetadata?.({ schedulerVersion: "scheduler-postgres-test" });
    return buildScheduleResult(input);
  }
}

describe("PostgreSQL platform integration", () => {
  beforeEach(async () => {
    client = createDbClient(testDatabaseUrl);
    await resetDatabase(client);
    await runMigrations(client);
    await seedDemoData(client);
    await seedTestAuth(new PostgresPlatformRepository(client));
  });

  afterEach(async () => {
    await closeClient();
  });

  it("persists schedule runs, assignments, conflicts, and audit events", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const app = createApp({
      repository,
      scheduler: new PostgresDraftScheduler(),
    });

    const readinessResponse = await app.inject({ method: "GET", url: "/ready" });
    assert.equal(readinessResponse.statusCode, 200);
    assert.deepEqual(readinessResponse.json(), {
      ok: true,
      service: "examforge-api",
      storage: "postgres",
    });

    const dashboardResponse = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: operatorHeaders,
    });
    assert.equal(dashboardResponse.statusCode, 200);
    assert.equal(dashboardResponse.json().metrics.examTaskCount, 6);

    const [taskGroupRows, unavailableRows] = await Promise.all([
      dbClient.db.select().from(examTaskStudentGroups),
      dbClient.db.select().from(teacherUnavailableSlots),
    ]);
    assert.ok(taskGroupRows.length > 0);
    assert.ok(unavailableRows.length > 0);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json();

    const [assignmentRows, invigilatorRows, conflictRows, auditRows] = await Promise.all([
      dbClient.db.select().from(scheduledExams).where(eq(scheduledExams.runId, created.run.id)),
      dbClient.db
        .select()
        .from(scheduledExamInvigilators),
      dbClient.db.select().from(conflictRecords).where(eq(conflictRecords.runId, created.run.id)),
      dbClient.db.select().from(auditEvents).where(eq(auditEvents.entityId, created.run.id)),
    ]);

    assert.equal(assignmentRows.length, 6);
    assert.equal(invigilatorRows.length, 7);
    assert.equal(conflictRows.length, 1);
    assert.ok(auditRows.some((event) => event.action === "schedule_run.created"));
    const [createdRunRow] = await dbClient.db
      .select()
      .from(scheduleRuns)
      .where(eq(scheduleRuns.id, created.run.id));
    assert.equal(createdRunRow.constraintProfileVersionId, "constraint-profile-default-v1");
    assert.equal(createdRunRow.constraintProfileSnapshot.schemaVersion, 1);
    assert.deepEqual(
      createdRunRow.constraintProfileSnapshot.config,
      (await repository.getReferenceData()).scheduleInput.constraint_profile,
    );
    assert.equal(createdRunRow.schedulerVersion, "scheduler-postgres-test");
    assert.equal(createdRunRow.scoringContractVersion, 1);
    assert.equal(createdRunRow.normalizedScore, created.result.score.normalized_score);
    assert.equal(created.run.constraintProfileVersionId, "constraint-profile-default-v1");
    assert.equal(created.run.schedulerVersion, "scheduler-postgres-test");
    assert.equal(created.run.normalizedScore, created.result.score.normalized_score);

    const readResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/${created.run.id}`,
      headers: operatorHeaders,
    });
    assert.equal(readResponse.statusCode, 200);
    assert.equal(readResponse.json().result.assignments.length, 6);
    assert.equal(readResponse.json().result.conflicts.length, 1);

    const filteredAudit = await repository.listAuditEvents({
      entityType: "schedule_run",
      entityId: created.run.id,
      actor: "operator",
      limit: 50,
    });
    assert.deepEqual(
      filteredAudit.events.map((event) => event.entityId),
      [created.run.id],
    );
    assert.equal(filteredAudit.events[0]?.actorUserId, "user-operator");
    assert.deepEqual(filteredAudit.events[0]?.actorRoles, ["operator"]);

    await app.close();
    client = null;
  });

  it("denies teacher and student PostgreSQL sessions every operational read", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const app = createApp({ repository, scheduler: new PostgresDraftScheduler() });
    const operationalPaths = [
      "/api/dashboard",
      "/api/reference-data",
      "/api/schedule-runs",
      "/api/schedule-runs/missing-run",
      "/api/schedule-runs/compare?baseId=missing-a&targetId=missing-b",
      "/api/schedule-drafts",
      "/api/schedule-drafts/missing-draft",
      "/api/schedule-drafts/missing-draft/compare",
      "/api/schedule-drafts/missing-draft/assignments/missing-exam/suggestions",
      "/api/audit-events",
      "/api/published-schedule/operations",
      "/api/published-schedule/export.csv",
    ];

    for (const [role, headers] of [
      ["teacher", testAuthHeaders.teacher],
      ["student", viewerHeaders],
    ] as const) {
      for (const url of operationalPaths) {
        const response = await app.inject({ method: "GET", url, headers });
        assert.equal(response.statusCode, 403, `${url} must reject ${role}`);
        assert.equal(response.json().error, "permission_denied");
      }
    }

    await app.close();
    client = null;
  });

  it("persists login sessions, rejects expired or disabled access, and revokes replay", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const app = createApp({ repository, scheduler: new PostgresDraftScheduler() });
    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:3000" },
      payload: { username: "operator", password: "operator-password" },
    });
    assert.equal(loginResponse.statusCode, 200);
    assert.equal(loginResponse.body.includes("passwordHash"), false);
    assert.equal(loginResponse.body.includes("tokenDigest"), false);
    const setCookie = loginResponse.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";")[0];
    assert.ok(cookie);
    const rawToken = cookie.slice(cookie.indexOf("=") + 1);
    const persisted = await dbClient.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenDigest, hashSessionToken(rawToken)));
    assert.equal(persisted.length, 1);
    assert.notEqual(persisted[0].tokenDigest, rawToken);

    const meResponse = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    assert.equal(meResponse.statusCode, 200);
    assert.deepEqual(meResponse.json().user.roles, ["operator"]);

    const wrongPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:3000" },
      payload: { username: "operator", password: "wrong" },
    });
    assert.equal(wrongPassword.statusCode, 401);
    const disabled = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:3000" },
      payload: { username: "disabled", password: "disabled-password" },
    });
    assert.equal(disabled.statusCode, 403);

    const expiredToken = "expired-postgres-session";
    await repository.createAuthSession({
      id: "expired-postgres-session",
      userId: "user-student",
      tokenDigest: hashSessionToken(expiredToken),
      createdAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-02T00:00:00.000Z",
      userAgent: null,
      ipAddress: null,
      credentialVersion: 1,
    });
    const expired = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie: `examforge_session=${expiredToken}` },
    });
    assert.equal(expired.statusCode, 401);

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { origin: "http://localhost:3000", cookie },
    });
    assert.equal(logout.statusCode, 204);
    const replay = await app.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { cookie },
    });
    assert.equal(replay.statusCode, 401);

    await app.close();
    client = null;
  });

  it("shares login failure locks across PostgreSQL API instances and records one desensitized lock audit", async () => {
    const firstClient = requireClient();
    const secondClient = createDbClient(testDatabaseUrl);
    const firstApp = createApp({
      repository: new PostgresPlatformRepository(firstClient),
      scheduler: new PostgresDraftScheduler(),
    });
    const secondApp = createApp({
      repository: new PostgresPlatformRepository(secondClient),
      scheduler: new PostgresDraftScheduler(),
    });
    const source = "203.0.113.31";
    const login = (app: ReturnType<typeof createApp>, password: string) => app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://localhost:3000" },
      remoteAddress: source,
      payload: { username: "operator", password },
    });

    try {
      const failures = await Promise.all(Array.from({ length: 5 }, (_, index) => (
        login(index % 2 === 0 ? firstApp : secondApp, "wrong-password")
      )));
      assert.equal(failures.filter((response) => response.statusCode === 401).length, 4);
      assert.equal(failures.filter((response) => response.statusCode === 429).length, 1);

      const correctPassword = await login(secondApp, "operator-password");
      assert.equal(correctPassword.statusCode, 429);
      assert.ok(Number(correctPassword.headers["retry-after"]) > 0);

      const keyDigest = hashLoginAttemptKey(source, "operator");
      const [attempt] = await firstClient.db.select()
        .from(authLoginAttempts)
        .where(eq(authLoginAttempts.keyDigest, keyDigest));
      assert.equal(attempt?.failureCount, 5);
      assert.ok(attempt?.lockedUntil);

      const audits = await firstClient.db.select().from(auditEvents)
        .where(eq(auditEvents.action, "auth.login_temporarily_locked"));
      assert.equal(audits.length, 1);
      assert.equal(audits[0]?.actor, "system");
      assert.equal(audits[0]?.entityId, keyDigest);
      assert.deepEqual(audits[0]?.payload, {
        failureCount: 5,
        retryAfterSeconds: 900,
      });
      assert.equal(JSON.stringify(audits[0]).includes("wrong-password"), false);
      assert.equal(JSON.stringify(audits[0]).includes(source), false);
    } finally {
      await firstApp.close();
      await secondApp.close();
      client = null;
    }
  });

  it("filters and paginates PostgreSQL schedule runs and audit events", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const referenceData = await repository.getReferenceData();
    const profiles = await repository.listConstraintProfiles(true);
    const profile = profiles.find((candidate) => candidate.isDefault) ?? profiles[0];
    const version = profile?.versions.find((candidate) => candidate.id === profile.currentVersionId);
    assert.ok(profile && version);
    const created = [];
    for (const [index, status] of ["feasible", "infeasible", "feasible"].entries()) {
      const result = buildScheduleResult(referenceData.scheduleInput);
      result.statistics.status = status as ScheduleResult["statistics"]["status"];
      const response = await repository.createScheduleRun(result, {
        constraintProfileVersionId: version.id,
        constraintProfileSnapshot: {
          schemaVersion: 1,
          profileId: profile.id,
          profileVersionId: version.id,
          versionNumber: version.versionNumber,
          digest: version.digest,
          config: version.config,
        },
        schedulerVersion: `postgres-list-${index}`,
      });
      created.push(response.run);
    }

    const firstPage = await repository.listScheduleRuns({
      status: "feasible",
      page: 1,
      pageSize: 1,
    });
    const secondPage = await repository.listScheduleRuns({
      status: "feasible",
      page: 2,
      pageSize: 1,
    });
    assert.equal(firstPage.total, 2);
    assert.equal(firstPage.pageCount, 2);
    assert.equal(secondPage.runs.length, 1);
    const expectedFeasible = created
      .filter((run) => run.status === "feasible")
      .reverse()
      .map((run) => run.id);
    assert.deepEqual(
      [...firstPage.runs, ...secondPage.runs].map((run) => run.id),
      expectedFeasible,
    );

    await repository.recordAuditEvent(
      "postgres.trace.created",
      "schedule_run",
      created[0].id,
      { traceId: "postgres-trace-list" },
      "operator",
    );
    await repository.recordAuditEvent(
      "postgres.trace.created",
      "schedule_run",
      created[1].id,
      { traceId: "postgres-trace-other" },
      "admin",
    );
    const auditPage = await repository.listAuditEvents({
      action: "postgres.trace.created",
      traceId: "postgres-trace-list",
      page: 1,
      pageSize: 1,
    });
    assert.equal(auditPage.total, 1);
    assert.equal(auditPage.events[0].entityId, created[0].id);
    assert.deepEqual((await repository.listAuditEvents({
      action: "postgres.trace.created",
      page: 9,
      pageSize: 20,
    })).events, []);

    await repository.close();
    client = null;
  });

  it("keeps PostgreSQL run, audit, and dashboard order when timestamps are equal", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const referenceData = await repository.getReferenceData();
    const profiles = await repository.listConstraintProfiles(true);
    const profile = profiles.find((candidate) => candidate.isDefault) ?? profiles[0];
    const version = profile?.versions.find((candidate) => candidate.id === profile.currentVersionId);
    assert.ok(profile && version);

    const createdRunIds: string[] = [];
    mock.timers.enable({
      apis: ["Date"],
      now: new Date("2026-07-23T12:00:00.000Z"),
    });
    try {
      for (let index = 0; index < 10; index += 1) {
        const response = await repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput), {
          constraintProfileVersionId: version.id,
          constraintProfileSnapshot: {
            schemaVersion: 1,
            profileId: profile.id,
            profileVersionId: version.id,
            versionNumber: version.versionNumber,
            digest: version.digest,
            config: version.config,
          },
          schedulerVersion: `postgres-same-timestamp-${index}`,
        });
        createdRunIds.push(response.run.id);
      }
    } finally {
      mock.timers.reset();
    }
    await dbClient.pool.query(`
      UPDATE audit_events
      SET created_at = '2026-07-23T12:00:00.000Z'
      WHERE action = 'schedule_run.created'
    `);

    const expected = [...createdRunIds].reverse();
    const [firstRunPage, secondRunPage] = await Promise.all([
      repository.listScheduleRuns({ page: 1, pageSize: 5 }),
      repository.listScheduleRuns({ page: 2, pageSize: 5 }),
    ]);
    assert.deepEqual(
      [...firstRunPage.runs, ...secondRunPage.runs].map((run) => run.id),
      expected,
    );
    assert.equal((await repository.getDashboard()).latestRun?.id, expected[0]);

    const [firstAuditPage, secondAuditPage] = await Promise.all([
      repository.listAuditEvents({ action: "schedule_run.created", page: 1, pageSize: 5 }),
      repository.listAuditEvents({ action: "schedule_run.created", page: 2, pageSize: 5 }),
    ]);
    assert.deepEqual(
      [...firstAuditPage.events, ...secondAuditPage.events].map((event) => event.entityId),
      expected,
    );

    await repository.close();
    client = null;
  });

  it("rotates PostgreSQL credentials atomically, revokes all sessions, and rejects a stale login version", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const authService = new AuthService(repository);
    const metadata = {
      userAgent: "ExamForge PostgreSQL rotation test",
      ipAddress: "203.0.113.39",
    };
    const first = await authService.login("operator", "operator-password", metadata);
    const second = await authService.login("operator", "operator-password", metadata);
    assert.equal(first.status, "authenticated");
    assert.equal(second.status, "authenticated");
    const beforeRotation = await repository.findAuthUserByUsername("operator");
    assert.ok(beforeRotation);

    const newPassword = "rotated-postgres-operator-password-20260723";
    const rotation = await new AccountRotationService(
      repository,
      () => new Date("2026-07-23T08:30:00.000Z"),
    ).rotate({
      username: "operator",
      password: newPassword,
      actor: "maintenance:ticket-20260723",
    });
    assert.deepEqual(rotation, {
      status: "rotated",
      credentialVersion: 2,
      revokedSessionCount: 3,
    });

    const staleSession = await repository.createAuthSession({
      id: "stale-operator-session",
      userId: beforeRotation.id,
      tokenDigest: hashSessionToken("stale-operator-session"),
      createdAt: "2026-07-23T08:30:01.000Z",
      expiresAt: "2026-07-23T20:30:01.000Z",
      userAgent: "stale credential test",
      ipAddress: "203.0.113.39",
      credentialVersion: beforeRotation.credentialVersion,
    });
    assert.equal(staleSession, null);
    assert.equal(await authService.authenticate(first.token), null);
    assert.equal(await authService.authenticate(second.token), null);
    assert.deepEqual(
      await authService.login("operator", "operator-password", metadata),
      { status: "invalid_credentials" },
    );
    assert.equal((await authService.login("operator", newPassword, metadata)).status, "authenticated");

    const [sessionRows, rotationAudits] = await Promise.all([
      dbClient.db.select().from(sessions).where(eq(sessions.userId, beforeRotation.id)),
      dbClient.db.select().from(auditEvents).where(eq(auditEvents.action, "auth.password_rotated")),
    ]);
    assert.equal(sessionRows.filter((session) => session.revokedAt !== null).length, 3);
    assert.equal(sessionRows.filter((session) => session.credentialVersion === 2).length, 1);
    assert.equal(rotationAudits.length, 1);
    assert.equal(rotationAudits[0]?.actor, "maintenance:ticket-20260723");
    assert.equal(rotationAudits[0]?.entityId, beforeRotation.id);
    assert.deepEqual(rotationAudits[0]?.payload, {
      credentialVersion: 2,
      revokedSessionCount: 3,
    });
    assert.equal(JSON.stringify(rotationAudits[0]).includes("operator-password"), false);
    assert.equal(JSON.stringify(rotationAudits[0]).includes(newPassword), false);
  });

  it("rolls back a PostgreSQL rotation when its audit cannot be written", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const authService = new AuthService(repository);
    const metadata = {
      userAgent: "ExamForge PostgreSQL atomicity test",
      ipAddress: "203.0.113.40",
    };
    const original = await authService.login("operator", "operator-password", metadata);
    assert.equal(original.status, "authenticated");
    await dbClient.db.execute(sql`DROP TABLE audit_events`);

    await assert.rejects(
      new AccountRotationService(repository).rotate({
        username: "operator",
        password: "rolled-back-postgres-password-20260723",
        actor: "maintenance:ticket-20260723",
      }),
    );

    assert.notEqual(await authService.authenticate(original.token), null);
    assert.equal((await authService.login("operator", "operator-password", metadata)).status, "authenticated");
    assert.deepEqual(
      await authService.login(
        "operator",
        "rolled-back-postgres-password-20260723",
        metadata,
      ),
      { status: "invalid_credentials" },
    );
  });

  it("persists current audience scopes, self-service audits, and restart reads", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const app = createApp({ repository, scheduler: new PostgresDraftScheduler() });

    const run = (await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    })).json();
    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishResponse.statusCode, 200);

    const publicSchedule = await app.inject({
      method: "GET",
      url: "/api/published-schedule",
    });
    assert.equal(publicSchedule.statusCode, 200);
    assert.deepEqual(Object.keys(publicSchedule.json()).sort(), [
      "batch",
      "contractVersion",
      "entries",
    ]);
    const publicSerialized = JSON.stringify(publicSchedule.json());
    for (const field of [
      "run",
      "result",
      "score",
      "conflicts",
      "diagnostics",
      "report",
      "statistics",
      "exam_task_id",
      "room_id",
      "time_slot_id",
      "teacher_ids",
    ]) {
      assert.equal(publicSerialized.includes(`\"${field}\"`), false, `${field} must not be public`);
    }

    const publicNotifications = await app.inject({
      method: "GET",
      url: "/api/published-schedule/notifications",
    });
    assert.equal(publicNotifications.statusCode, 200);
    assert.deepEqual(Object.keys(publicNotifications.json()).sort(), [
      "batch",
      "contractVersion",
      "notifications",
    ]);
    assert.equal(JSON.stringify(publicNotifications.json()).includes("\"run\""), false);

    const anonymousOperational = await app.inject({
      method: "GET",
      url: "/api/published-schedule/operations",
    });
    assert.equal(anonymousOperational.statusCode, 401);
    for (const headers of [testAuthHeaders.teacher, viewerHeaders]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/published-schedule/operations",
        headers,
      });
      assert.equal(response.statusCode, 403);
    }
    const operationalSchedule = await app.inject({
      method: "GET",
      url: "/api/published-schedule/operations",
      headers: operatorHeaders,
    });
    assert.equal(operationalSchedule.statusCode, 200);
    assert.equal(operationalSchedule.json().run.id, run.run.id);
    assert.ok(operationalSchedule.json().result.score.total_score > 0);

    const teacherAudience = await app.inject({
      method: "GET",
      url: "/api/me/audience",
      headers: testAuthHeaders.teacher,
    });
    assert.equal(teacherAudience.statusCode, 200);
    assert.equal(teacherAudience.json().teacher.id, "t-zhang");

    const teacherMutation = await app.inject({
      method: "PATCH",
      url: "/api/me/teacher-unavailable-slots",
      headers: testAuthHeaders.teacher,
      payload: { unavailable_slot_ids: ["s-001", "s-004"] },
    });
    assert.equal(teacherMutation.statusCode, 200);
    assert.deepEqual(teacherMutation.json().teacher.unavailable_slot_ids, ["s-001", "s-004"]);

    const [audit] = await dbClient.db.select().from(auditEvents)
      .where(eq(auditEvents.action, "teacher.unavailable_slots_updated"));
    assert.equal(audit.actor, "teacher");
    assert.equal(audit.actorUserId, "user-teacher");
    assert.deepEqual(audit.actorRoles, ["teacher"]);

    const anonymousPreview = await app.inject({
      method: "GET",
      url: "/api/published-schedule/teachers/t-zhang",
    });
    assert.equal(anonymousPreview.statusCode, 401);

    await app.close();
    client = null;

    client = createDbClient(testDatabaseUrl);
    const restartedRepository = new PostgresPlatformRepository(client);
    const restartedApp = createApp({
      repository: restartedRepository,
      scheduler: new PostgresDraftScheduler(),
    });
    const restartedTeacherSchedule = await restartedApp.inject({
      method: "GET",
      url: "/api/me/published-schedule",
      headers: testAuthHeaders.teacher,
    });
    assert.equal(restartedTeacherSchedule.statusCode, 200);
    assert.equal(restartedTeacherSchedule.json().kind, "teacher");
    assert.ok(restartedTeacherSchedule.json().assignments.length > 0);

    const restartedStudentSchedule = await restartedApp.inject({
      method: "GET",
      url: "/api/me/published-schedule",
      headers: testAuthHeaders.student,
    });
    assert.equal(restartedStudentSchedule.statusCode, 200);
    assert.equal(restartedStudentSchedule.json().kind, "student");
    assert.deepEqual(
      restartedStudentSchedule.json().audience.studentGroups.map((group: { id: string }) => group.id),
      ["g-cs-2301"],
    );

    await restartedApp.close();
    client = null;
  });

  it("builds scheduler reference data from association tables", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const referenceData = await repository.getReferenceData();

    assert.equal(referenceData.scheduleInput.reschedule_context, null);

    const unavailableRows = await dbClient.db
      .select()
      .from(teacherUnavailableSlots)
      .where(eq(teacherUnavailableSlots.teacherId, "t-zhang"));
    const teacher = referenceData.scheduleInput.teachers.find((item) => item.id === "t-zhang");
    assert.ok(teacher);
    assert.deepEqual(
      [...teacher.unavailable_slot_ids].sort(),
      unavailableRows.map((row) => row.timeSlotId).sort(),
    );

    const taskGroupRows = await dbClient.db
      .select()
      .from(examTaskStudentGroups)
      .where(eq(examTaskStudentGroups.examTaskId, "e-data-structures"));
    const task = referenceData.scheduleInput.exam_tasks.find((item) => item.id === "e-data-structures");
    assert.ok(task);
    assert.deepEqual(
      [...task.student_group_ids].sort(),
      taskGroupRows.map((row) => row.studentGroupId).sort(),
    );

    await repository.close();
    client = null;
  });

  it("maps missing teacher unavailable slots to a stable integrity error", async () => {
    const app = createApp({
      repository: new PostgresPlatformRepository(requireClient()),
      scheduler: new PostgresDraftScheduler(),
    });

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
    assert.doesNotMatch(response.body, /Failed query|teacher_unavailable_slots|insert into/i);

    await app.close();
    client = null;
  });

  it("reads schedule and draft invigilators from association tables", async () => {
    const dbClient = requireClient();
    const app = createApp({
      repository: new PostgresPlatformRepository(dbClient),
      scheduler: new PostgresDraftScheduler(),
    });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    assert.equal(runResponse.statusCode, 201);
    const run = runResponse.json();

    const publishRunResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishRunResponse.statusCode, 200);

    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
    });
    assert.equal(draftResponse.statusCode, 201);
    const draft = draftResponse.json();

    const runDetailResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/${run.run.id}`,
      headers: operatorHeaders,
    });
    assert.equal(runDetailResponse.statusCode, 200);
    const runAssignment = runDetailResponse.json().result.assignments.find(
      (assignment: { exam_task_id: string }) => assignment.exam_task_id === "e-data-structures",
    );
    assert.deepEqual(runAssignment.teacher_ids, ["t-zhang"]);

    const teacherScheduleResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule/teachers/t-zhang",
      headers: operatorHeaders,
    });
    assert.equal(teacherScheduleResponse.statusCode, 200);
    assert.ok(teacherScheduleResponse.json().assignments.some(
      (item: { assignment: { exam_task_id: string } }) => (
        item.assignment.exam_task_id === "e-data-structures"
      ),
    ));

    const draftDetailResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-drafts/${draft.draft.id}`,
      headers: operatorHeaders,
    });
    assert.equal(draftDetailResponse.statusCode, 200);
    const draftAssignment = draftDetailResponse.json().assignments.find(
      (assignment: { exam_task_id: string }) => assignment.exam_task_id === "e-data-structures",
    );
    assert.deepEqual(draftAssignment.teacher_ids, ["t-zhang"]);

    const comparisonResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-drafts/${draft.draft.id}/compare`,
      headers: operatorHeaders,
    });
    assert.equal(comparisonResponse.statusCode, 200);
    assert.equal(comparisonResponse.json().summary.changedFromSource, 0);

    const publishDraftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishDraftResponse.statusCode, 200);
    const publishedAssignment = publishDraftResponse.json().result.assignments.find(
      (assignment: { exam_task_id: string }) => assignment.exam_task_id === "e-data-structures",
    );
    assert.deepEqual(publishedAssignment.teacher_ids, ["t-zhang"]);

    await app.close();
    client = null;
  });

  it("does not synthesize relationship data when association rows are absent", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const app = createApp({
      repository,
      scheduler: new PostgresDraftScheduler(),
    });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    assert.equal(runResponse.statusCode, 201);
    const run = runResponse.json();

    const publishRunResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishRunResponse.statusCode, 200);

    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
    });
    assert.equal(draftResponse.statusCode, 201);
    const draft = draftResponse.json();

    const [[teacherRow], [taskRow], [scheduledExamRow], [draftExamRow]] = await Promise.all([
      dbClient.db.select().from(teachers).where(eq(teachers.id, "t-zhang")),
      dbClient.db.select().from(examTasks).where(eq(examTasks.id, "e-data-structures")),
      dbClient.db.select().from(scheduledExams).where(eq(scheduledExams.examTaskId, "e-data-structures")),
      dbClient.db.select().from(draftScheduledExams).where(eq(draftScheduledExams.examTaskId, "e-data-structures")),
    ]);
    await Promise.all([
      dbClient.db.delete(teacherUnavailableSlots).where(eq(teacherUnavailableSlots.teacherId, teacherRow.id)),
      dbClient.db.delete(examTaskStudentGroups).where(eq(examTaskStudentGroups.examTaskId, taskRow.id)),
      dbClient.db.delete(scheduledExamInvigilators),
      dbClient.db.delete(draftExamInvigilators),
    ]);

    const referenceData = await repository.getReferenceData();
    const teacher = referenceData.scheduleInput.teachers.find((item) => item.id === teacherRow.id);
    const task = referenceData.scheduleInput.exam_tasks.find((item) => item.id === taskRow.id);
    assert.deepEqual(teacher?.unavailable_slot_ids, []);
    assert.deepEqual(task?.student_group_ids, []);

    const runDetail = await repository.getScheduleRun(run.run.id);
    const runAssignment = runDetail?.result.assignments.find(
      (assignment) => assignment.exam_task_id === scheduledExamRow.examTaskId,
    );
    assert.deepEqual(runAssignment?.teacher_ids, []);

    const teacherScheduleResponse = await app.inject({
      method: "GET",
      url: `/api/published-schedule/teachers/${teacherRow.id}`,
      headers: operatorHeaders,
    });
    assert.equal(teacherScheduleResponse.statusCode, 200);
    assert.equal(teacherScheduleResponse.json().assignments.some(
      (item: { assignment: { exam_task_id: string } }) => (
        item.assignment.exam_task_id === scheduledExamRow.examTaskId
      ),
    ), false);

    const draftDetail = await repository.getScheduleDraft(draft.draft.id);
    const draftAssignment = draftDetail?.assignments.find(
      (assignment) => assignment.exam_task_id === draftExamRow.examTaskId,
    );
    assert.deepEqual(draftAssignment?.teacher_ids, []);

    const comparison = await repository.compareScheduleDraft(draft.draft.id);
    assert.equal(comparison?.summary.changedFromSource, 0);

    await app.close();
    client = null;
  });

  it("persists draft conflict blocking, repair, and publish workflow", async () => {
    const dbClient = requireClient();
    const app = createApp({
      repository: new PostgresPlatformRepository(dbClient),
      scheduler: new PostgresDraftScheduler(),
    });

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
    const initialDraftInvigilators = await dbClient.db
      .select()
      .from(draftExamInvigilators);
    assert.equal(initialDraftInvigilators.length, 7);

    const conflictResponse = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-101",
        time_slot_id: "s-001",
        teacher_ids: ["t-zhang"],
      },
    });
    assert.equal(conflictResponse.statusCode, 200);
    assert.equal(conflictResponse.json().draft.status, "blocked");
    assert.ok(conflictResponse.json().conflicts.length > 0);

    const blockedPublish = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(blockedPublish.statusCode, 409);
    assert.equal(blockedPublish.json().error, "schedule_draft_has_conflicts");

    const repairResponse = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-lab-2",
        time_slot_id: "s-005",
        teacher_ids: ["t-li"],
      },
    });
    assert.equal(repairResponse.statusCode, 200);
    assert.equal(repairResponse.json().draft.status, "validated");
    assert.equal(repairResponse.json().conflicts.length, 0);
    const [databaseDraftAssignment] = await dbClient.db
      .select()
      .from(draftScheduledExams)
      .where(eq(draftScheduledExams.examTaskId, "e-database"));
    const repairedInvigilators = await dbClient.db
      .select()
      .from(draftExamInvigilators)
      .where(eq(draftExamInvigilators.draftScheduledExamId, databaseDraftAssignment.id));
    assert.deepEqual(repairedInvigilators.map((row) => row.teacherId), ["t-li"]);

    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishResponse.statusCode, 200);
    assert.equal(publishResponse.json().batch.status, "published");
    assert.equal(publishResponse.json().result.assignments.length, 6);
    const publishedInvigilators = await dbClient.db
      .select()
      .from(scheduledExamInvigilators);
    assert.equal(publishedInvigilators.length, 14);

    await app.close();
    client = null;
  });

  it("rejects incomplete PostgreSQL runs and drafts from publication", async () => {
    const repository = new PostgresPlatformRepository(requireClient());
    const referenceData = await repository.getReferenceData();
    const sourceRun = await repository.createScheduleRun(
      buildIncompleteScheduleResult(referenceData.scheduleInput),
    );

    const runPublishResult = await repository.publishScheduleRun(sourceRun.run.id);
    assert.equal(runPublishResult, "not_publishable");

    const draft = await repository.createScheduleDraftFromRun(sourceRun.run.id);
    assert.ok(draft);
    assert.equal(draft.draft.status, "blocked");
    assert.equal(
      draft.conflicts.filter((conflict) => conflict.type === "exam_task_unassigned").length,
      referenceData.scheduleInput.exam_tasks.length,
    );

    const draftPublishResult = await repository.publishScheduleDraft(draft.draft.id);
    assert.equal(draftPublishResult, "conflict");
  });

  it("serializes concurrent PostgreSQL run publications with one successful audit", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const app = createApp({ repository, scheduler: new PostgresDraftScheduler() });
    const referenceData = await repository.getReferenceData();
    const [firstRun, secondRun] = await Promise.all([
      repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput)),
      repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput)),
    ]);

    const responses = await runBatchPublicationOperationsInOrder(
      dbClient,
      referenceData.batch.id,
      () => app.inject({
        method: "POST",
        url: `/api/schedule-runs/${firstRun.run.id}/publish`,
        headers: adminHeaders,
      }),
      () => app.inject({
        method: "POST",
        url: `/api/schedule-runs/${secondRun.run.id}/publish`,
        headers: adminHeaders,
      }),
    );

    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409]);
    const conflictResponse = responses.find((response) => response.statusCode === 409);
    assert.equal(conflictResponse?.json().error, "schedule_run_publication_conflict");

    const published = await repository.getPublishedSchedule();
    assert.ok(published);
    assert.ok([firstRun.run.id, secondRun.run.id].includes(published.run.id));

    const audits = await repository.listAuditEvents({ entityType: "schedule_run", limit: 20 });
    const publishAudits = audits.events.filter((event) => event.action === "schedule_run.published");
    assert.equal(publishAudits.length, 1);
    assert.equal(publishAudits[0]?.entityId, published.run.id);

    await app.close();
    client = null;
  });

  it("serializes concurrent PostgreSQL rollback and run publication", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const app = createApp({ repository, scheduler: new PostgresDraftScheduler() });
    const referenceData = await repository.getReferenceData();
    const [initialRun, replacementRun] = await Promise.all([
      repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput)),
      repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput)),
    ]);
    const initialPublication = await repository.publishScheduleRun(initialRun.run.id);
    assert.ok(initialPublication && initialPublication !== "not_publishable");

    const [rollbackResponse, publishResponse] = await runBatchPublicationOperationsInOrder(
      dbClient,
      referenceData.batch.id,
      () => app.inject({
        method: "POST",
        url: "/api/published-schedule/rollback",
        headers: adminHeaders,
      }),
      () => app.inject({
        method: "POST",
        url: `/api/schedule-runs/${replacementRun.run.id}/publish`,
        headers: adminHeaders,
      }),
    );

    assert.deepEqual([rollbackResponse.statusCode, publishResponse.statusCode].sort(), [200, 409]);
    if (rollbackResponse.statusCode === 409) {
      assert.equal(rollbackResponse.json().error, "published_schedule_publication_conflict");
    }
    if (publishResponse.statusCode === 409) {
      assert.equal(publishResponse.json().error, "schedule_run_publication_conflict");
    }

    const published = await repository.getPublishedSchedule();
    if (rollbackResponse.statusCode === 200) {
      assert.equal(published, null);
    } else {
      assert.equal(published?.run.id, replacementRun.run.id);
    }

    const audits = await repository.listAuditEvents({ limit: 50 });
    assert.equal(
      audits.events.filter((event) => (
        event.action === "schedule_run.rollback" && event.entityId === referenceData.batch.id
      )).length,
      rollbackResponse.statusCode === 200 ? 1 : 0,
    );
    assert.equal(
      audits.events.filter((event) => (
        event.action === "schedule_run.published" && event.entityId === replacementRun.run.id
      )).length,
      publishResponse.statusCode === 200 ? 1 : 0,
    );

    await app.close();
    client = null;
  });

  it("serializes concurrent PostgreSQL draft and run publication", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const app = createApp({ repository, scheduler: new PostgresDraftScheduler() });
    const referenceData = await repository.getReferenceData();
    const [sourceRun, competingRun] = await Promise.all([
      repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput)),
      repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput)),
    ]);
    const draft = await repository.createScheduleDraftFromRun(sourceRun.run.id);
    assert.ok(draft);

    const [draftResponse, runResponse] = await runBatchPublicationOperationsInOrder(
      dbClient,
      referenceData.batch.id,
      () => app.inject({
        method: "POST",
        url: `/api/schedule-drafts/${draft.draft.id}/publish`,
        headers: adminHeaders,
      }),
      () => app.inject({
        method: "POST",
        url: `/api/schedule-runs/${competingRun.run.id}/publish`,
        headers: adminHeaders,
      }),
    );

    assert.deepEqual([draftResponse.statusCode, runResponse.statusCode].sort(), [200, 409]);
    if (draftResponse.statusCode === 409) {
      assert.equal(draftResponse.json().error, "schedule_draft_publication_conflict");
    }
    if (runResponse.statusCode === 409) {
      assert.equal(runResponse.json().error, "schedule_run_publication_conflict");
    }

    const audits = await repository.listAuditEvents({ limit: 50 });
    assert.equal(
      audits.events.filter((event) => (
        event.action === "schedule_draft.published" && event.entityId === draft.draft.id
      )).length,
      draftResponse.statusCode === 200 ? 1 : 0,
    );
    assert.equal(
      audits.events.filter((event) => (
        event.action === "schedule_run.published" && event.entityId === competingRun.run.id
      )).length,
      runResponse.statusCode === 200 ? 1 : 0,
    );

    await app.close();
    client = null;
  });

  it("rolls back the PostgreSQL publication pointer when the success audit insert fails", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const referenceData = await repository.getReferenceData();
    const run = await repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput));

    await dbClient.pool.query(`
      CREATE FUNCTION reject_schedule_run_publish_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'schedule_run.published' THEN
          RAISE EXCEPTION 'forced schedule run publication audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_schedule_run_publish_audit_trigger
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_schedule_run_publish_audit();
    `);

    await assert.rejects(
      repository.publishScheduleRun(run.run.id),
      (error: unknown) => hasCauseMessage(error, /forced schedule run publication audit failure/),
    );
    assert.equal(await repository.getPublishedSchedule(), null);
    const audits = await repository.listAuditEvents({
      entityType: "schedule_run",
      entityId: run.run.id,
      limit: 20,
    });
    assert.equal(
      audits.events.filter((event) => event.action === "schedule_run.published").length,
      0,
    );
  });

  it("rolls back the PostgreSQL rollback pointer when the rollback audit insert fails", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const referenceData = await repository.getReferenceData();
    const run = await repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput));
    const published = await repository.publishScheduleRun(run.run.id);
    assert.ok(published && published !== "not_publishable");

    await dbClient.pool.query(`
      CREATE FUNCTION reject_schedule_run_rollback_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'schedule_run.rollback' THEN
          RAISE EXCEPTION 'forced schedule run rollback audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_schedule_run_rollback_audit_trigger
      BEFORE INSERT ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_schedule_run_rollback_audit();
    `);

    await assert.rejects(
      repository.rollbackPublishedSchedule(),
      (error: unknown) => hasCauseMessage(error, /forced schedule run rollback audit failure/),
    );
    assert.equal((await repository.getPublishedSchedule())?.run.id, run.run.id);
    const audits = await repository.listAuditEvents({
      entityType: "exam_batch",
      entityId: referenceData.batch.id,
      limit: 20,
    });
    assert.equal(
      audits.events.filter((event) => event.action === "schedule_run.rollback").length,
      0,
    );
  });

  it("allows only one concurrent PostgreSQL draft publication", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const referenceData = await repository.getReferenceData();
    const sourceRun = await repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput));
    const draft = await repository.createScheduleDraftFromRun(sourceRun.run.id);
    assert.ok(draft);
    const runsBefore = await repository.listScheduleRuns();

    const results = await Promise.all([
      repository.publishScheduleDraft(draft.draft.id),
      repository.publishScheduleDraft(draft.draft.id),
    ]);

    assert.equal(results.filter((result) => result === "not_publishable").length, 1);
    assert.equal(results.filter((result) => (
      result !== null && result !== "conflict" && result !== "not_publishable"
    )).length, 1);
    const runsAfter = await repository.listScheduleRuns();
    assert.equal(runsAfter.runs.length, runsBefore.runs.length + 1);
    const publishAudits = await repository.listAuditEvents({
      entityType: "schedule_draft",
      entityId: draft.draft.id,
      limit: 10,
    });
    assert.equal(
      publishAudits.events.filter((event) => event.action === "schedule_draft.published").length,
      1,
    );

    await repository.close();
    client = null;
  });

  it("completes PostgreSQL draft mutations with a single pool connection", async () => {
    const singleConnectionClient = createDbClient(testDatabaseUrl);
    singleConnectionClient.pool.options.max = 1;
    const repository = new PostgresPlatformRepository(singleConnectionClient);
    let completedWithinDeadline = false;
    try {
      const referenceData = await repository.getReferenceData();
      const sourceRun = await repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput));
      const draft = await repository.createScheduleDraftFromRun(sourceRun.run.id);
      assert.ok(draft);

      const mutation = repository.discardScheduleDraft(draft.draft.id);
      completedWithinDeadline = await Promise.race([
        mutation.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      if (!completedWithinDeadline) {
        singleConnectionClient.pool.options.max = 2;
        const wakePool = singleConnectionClient.pool.query("SELECT 1");
        await Promise.all([mutation, wakePool]);
      }
      const result = await mutation;
      assert.ok(result && result !== "not_discardable");
      assert.equal(result.draft.status, "discarded");
    } finally {
      await repository.close();
    }
    assert.equal(completedWithinDeadline, true, "draft mutation exhausted the PostgreSQL connection pool");
  });

  it("serializes lock mutations behind PostgreSQL draft terminal transitions", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const referenceData = await repository.getReferenceData();
    const sourceRun = await repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput));

    const draftToPublish = await repository.createScheduleDraftFromRun(sourceRun.run.id);
    assert.ok(draftToPublish);
    const [publishResult, lateLockResult] = await runDraftOperationsInOrder(
      dbClient,
      draftToPublish.draft.id,
      () => repository.publishScheduleDraft(draftToPublish.draft.id),
      () => repository.lockScheduleDraftAssignment(draftToPublish.draft.id, "e-data-structures"),
    );
    assert.notEqual(publishResult, null);
    assert.notEqual(publishResult, "conflict");
    assert.notEqual(publishResult, "not_publishable");
    assert.equal(lateLockResult, "not_editable");
    const publishedDraft = await repository.getScheduleDraft(draftToPublish.draft.id);
    assert.equal(publishedDraft?.draft.status, "published");
    assert.deepEqual(publishedDraft?.lockedExamTaskIds, []);

    const draftToDiscard = await repository.createScheduleDraftFromRun(sourceRun.run.id);
    assert.ok(draftToDiscard);
    const initialLock = await repository.lockScheduleDraftAssignment(
      draftToDiscard.draft.id,
      "e-data-structures",
    );
    assert.ok(initialLock && initialLock !== "not_editable");
    assert.deepEqual(initialLock.lockedExamTaskIds, ["e-data-structures"]);
    const [discardResult, lateUnlockResult] = await runDraftOperationsInOrder(
      dbClient,
      draftToDiscard.draft.id,
      () => repository.discardScheduleDraft(draftToDiscard.draft.id),
      () => repository.unlockScheduleDraftAssignment(draftToDiscard.draft.id, "e-data-structures"),
    );
    assert.notEqual(discardResult, null);
    assert.notEqual(discardResult, "not_discardable");
    assert.equal(lateUnlockResult, "not_editable");
    const discardedDraft = await repository.getScheduleDraft(draftToDiscard.draft.id);
    assert.equal(discardedDraft?.draft.status, "discarded");
    assert.deepEqual(discardedDraft?.lockedExamTaskIds, ["e-data-structures"]);

    const draftToValidateAfterPublish = await repository.createScheduleDraftFromRun(sourceRun.run.id);
    assert.ok(draftToValidateAfterPublish);
    const [secondPublishResult, lateValidateAfterPublish] = await runDraftOperationsInOrder(
      dbClient,
      draftToValidateAfterPublish.draft.id,
      () => repository.publishScheduleDraft(draftToValidateAfterPublish.draft.id),
      () => repository.validateScheduleDraft(draftToValidateAfterPublish.draft.id),
    );
    assert.notEqual(secondPublishResult, null);
    assert.notEqual(secondPublishResult, "conflict");
    assert.notEqual(secondPublishResult, "not_publishable");
    assert.equal(lateValidateAfterPublish, "not_editable");

    const draftToValidateAfterDiscard = await repository.createScheduleDraftFromRun(sourceRun.run.id);
    assert.ok(draftToValidateAfterDiscard);
    const [secondDiscardResult, lateValidateAfterDiscard] = await runDraftOperationsInOrder(
      dbClient,
      draftToValidateAfterDiscard.draft.id,
      () => repository.discardScheduleDraft(draftToValidateAfterDiscard.draft.id),
      () => repository.validateScheduleDraft(draftToValidateAfterDiscard.draft.id),
    );
    assert.notEqual(secondDiscardResult, null);
    assert.notEqual(secondDiscardResult, "not_discardable");
    assert.equal(lateValidateAfterDiscard, "not_editable");

    await repository.close();
    client = null;
  });

  it("persists job creation with an event and pending outbox in one transaction", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const referenceData = await repository.getReferenceData();
    const command = {
      batchId: referenceData.batch.id,
      idempotencyKey: "postgres-idempotent-job",
      requestDigest: "a".repeat(64),
      requestSnapshot: {
        version: 1 as const,
        input: referenceData.scheduleInput,
      },
      traceId: "trace-postgres-idempotent-job",
    };
    const [first, second] = await Promise.all([
      repository.createScheduleJob(command),
      repository.createScheduleJob(command),
    ]);
    assert.equal(first.job.id, second.job.id);
    assert.equal(Number(first.created) + Number(second.created), 1);
    const job = first.job;
    assert.equal(job.status, "queued");
    assert.equal(job.batchId, referenceData.batch.id);
    assert.equal(job.idempotencyKey, command.idempotencyKey);

    assert.equal((await dbClient.db.select().from(scheduleJobEvents)).length, 1);
    const pendingOutbox = await dbClient.db.select().from(outboxEvents);
    assert.equal(pendingOutbox.length, 1);
    assert.equal(pendingOutbox[0].publishedAt, null);
    assert.equal(typeof pendingOutbox[0].payload.sequence, "number");

    const [createdRow] = await dbClient.db
      .select()
      .from(scheduleJobs)
      .where(eq(scheduleJobs.id, job.id));
    assert.equal(createdRow.requestVersion, 2);
    assert.ok("version" in createdRow.requestPayload);
    assert.equal(createdRow.requestPayload.version, 2);
    assert.deepEqual(createdRow.requestPayload.input, command.requestSnapshot.input);
    assert.equal(
      createdRow.requestPayload.version === 2
        ? createdRow.requestPayload.constraintProfile.profileVersionId
        : null,
      "constraint-profile-default-v1",
    );
    assert.equal(createdRow.constraintProfileVersionId, "constraint-profile-default-v1");
    assert.equal(createdRow.constraintProfileSnapshot.schemaVersion, 1);
    assert.deepEqual(
      createdRow.constraintProfileSnapshot.config,
      referenceData.scheduleInput.constraint_profile,
    );

    const claims = await Promise.all([
      repository.claimScheduleJob(job.id),
      repository.claimScheduleJob(job.id),
    ]);
    assert.deepEqual(
      claims.map((claim) => claim.resolution).sort(),
      ["claimed", "not_claimable"],
    );
    const firstClaim = claims.find((claim) => claim.resolution === "claimed");
    assert.ok(firstClaim && firstClaim.resolution === "claimed");
    assert.equal(firstClaim.job.status, "running");
    assert.equal(firstClaim.requestSnapshot.version, 2);
    assert.deepEqual(firstClaim.requestSnapshot.input, command.requestSnapshot.input);
    assert.equal(firstClaim.attempt.status, "started");
    assert.equal(firstClaim.attempt.schedulerRequestId, `${job.traceId}:attempt:1`);

    const retryAt = "2026-07-13T08:00:01.000Z";
    const retry = await repository.failScheduleJobAttempt(job.id, {
      attemptId: firstClaim.attempt.id,
      error: {
        category: "unavailable",
        code: "scheduler_unavailable",
        message: "Scheduler service is unavailable.",
        retryable: true,
      },
      outcome: "retry",
      retryAt,
    });
    assert.equal(retry.resolution, "apply");
    assert.equal(retry.job?.status, "queued");
    const retryOutbox = (await dbClient.db.select().from(outboxEvents))
      .find((event) => event.eventType === "schedule_job.retry_scheduled");
    assert.equal(retryOutbox?.availableAt.toISOString(), retryAt);

    const secondClaim = await repository.claimScheduleJob(job.id);
    assert.equal(secondClaim.resolution, "claimed");
    assert.ok(secondClaim.resolution === "claimed");
    assert.equal(secondClaim.attempt.attemptNumber, 2);

    const result = buildScheduleResult(referenceData.scheduleInput);
    const staleCompletion = await repository.completeScheduleJob(job.id, {
      attemptId: firstClaim.attempt.id,
      result,
    });
    assert.equal(staleCompletion.resolution, "stale_attempt");
    const [firstCompletion, duplicateCompletion] = await Promise.all([
      repository.completeScheduleJob(job.id, {
        attemptId: secondClaim.attempt.id,
        result,
      }),
      repository.completeScheduleJob(job.id, {
        attemptId: secondClaim.attempt.id,
        result,
      }),
    ]);
    assert.deepEqual(
      [firstCompletion.resolution, duplicateCompletion.resolution].sort(),
      ["apply", "idempotent"],
    );
    assert.equal(firstCompletion.job?.runId, duplicateCompletion.job?.runId);
    assert.equal((await dbClient.db.select().from(scheduleRuns)).length, 1);
    const [completedRun] = await dbClient.db
      .select()
      .from(scheduleRuns)
      .where(eq(scheduleRuns.id, firstCompletion.job?.runId ?? ""));
    assert.equal(completedRun.constraintProfileVersionId, createdRow.constraintProfileVersionId);
    assert.deepEqual(
      completedRun.constraintProfileSnapshot,
      createdRow.constraintProfileSnapshot,
    );
    assert.equal(completedRun.schedulerVersion, "unknown");
    assert.equal(completedRun.scoringContractVersion, result.score.scoring_contract_version);
    assert.equal(completedRun.normalizedScore, result.score.normalized_score);
    const attempts = await dbClient.db
      .select()
      .from(scheduleJobAttempts)
      .orderBy(asc(scheduleJobAttempts.attemptNumber));
    assert.deepEqual(attempts.map((attempt) => attempt.status), ["failed", "succeeded"]);
    assert.ok(attempts.every(
      (attempt) => attempt.durationMs !== null && attempt.durationMs >= 0,
    ));

    const [jobRow] = await dbClient.db.select().from(scheduleJobs).where(eq(scheduleJobs.id, job.id));
    assert.equal(jobRow.runId, firstCompletion.job?.runId);

    const jobList = await repository.listScheduleJobs();
    assert.deepEqual(jobList.jobs.map((item) => item.id), [job.id]);
    const detail = await repository.getScheduleJobDetail(job.id);
    assert.ok(detail);
    assert.equal(detail.job.attemptCount, 2);
    assert.deepEqual(detail.attempts.map((attempt) => attempt.status), ["failed", "succeeded"]);
    assert.deepEqual(detail.events.map((event) => event.type), [
      "schedule_job.queued",
      "schedule_job.attempt_started",
      "schedule_job.running",
      "schedule_job.retry_scheduled",
      "schedule_job.attempt_started",
      "schedule_job.running",
      "schedule_job.run_created",
      "schedule_job.succeeded",
    ]);
    assert.ok(detail.events.every((event, index) => (
      index === 0 || event.sequence > detail.events[index - 1].sequence
    )));

    await repository.close();
    client = null;
  });

  it("filters and paginates schedule jobs in PostgreSQL with stable metadata", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const app = createApp({ repository, scheduler: new PostgresDraftScheduler() });
    const created = [];
    for (const [index, headers] of [operatorHeaders, adminHeaders, operatorHeaders].entries()) {
      const response = await app.inject({
        method: "POST",
        url: "/api/schedule-jobs",
        headers: { ...headers, "idempotency-key": `postgres-filters-${index}` },
      });
      assert.equal(response.statusCode, 202);
      created.push(response.json().job);
    }
    assert.equal((await app.inject({
      method: "POST",
      url: `/api/schedule-jobs/${created[0].id}/cancel`,
      headers: operatorHeaders,
    })).statusCode, 200);

    const firstPage = await app.inject({
      method: "GET",
      url: "/api/schedule-jobs?page=1&pageSize=2",
      headers: operatorHeaders,
    });
    const secondPage = await app.inject({
      method: "GET",
      url: "/api/schedule-jobs?page=2&pageSize=2",
      headers: operatorHeaders,
    });
    assert.equal(firstPage.statusCode, 200);
    assert.equal(firstPage.json().total, 3);
    assert.equal(firstPage.json().pageCount, 2);
    assert.equal(secondPage.json().jobs.length, 1);
    const expectedIds = created
      .slice()
      .reverse()
      .map((job) => job.id);
    assert.deepEqual([
      ...firstPage.json().jobs,
      ...secondPage.json().jobs,
    ].map((job) => job.id), expectedIds);

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

    const bounded = new URLSearchParams({
      from: created[0].createdAt,
      to: created.at(-1).createdAt,
      constraintProfileVersionId: created[0].constraintProfileVersionId,
    });
    const boundedResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-jobs?${bounded}`,
      headers: operatorHeaders,
    });
    assert.equal(boundedResponse.json().total, 3);

    const emptyPage = await app.inject({
      method: "GET",
      url: "/api/schedule-jobs?page=99&pageSize=20",
      headers: operatorHeaders,
    });
    assert.deepEqual(emptyPage.json().jobs, []);
    assert.equal(emptyPage.json().total, 3);
    assert.equal(emptyPage.json().page, 99);

    await app.close();
    client = null;
  });

  it("keeps PostgreSQL schedule-job pagination in creation order when timestamps are equal", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const app = createApp({ repository, scheduler: new PostgresDraftScheduler() });
    const createdJobIds: string[] = [];
    mock.timers.enable({
      apis: ["Date"],
      now: new Date("2026-07-23T12:00:00.000Z"),
    });
    try {
      for (let index = 0; index < 10; index += 1) {
        const response = await app.inject({
          method: "POST",
          url: "/api/schedule-jobs",
          headers: { ...operatorHeaders, "idempotency-key": `postgres-same-timestamp-job-${index}` },
        });
        assert.equal(response.statusCode, 202);
        createdJobIds.push(response.json().job.id);
      }
    } finally {
      mock.timers.reset();
    }

    const expected = [...createdJobIds].reverse();
    const [firstPage, secondPage] = await Promise.all([
      repository.listScheduleJobs({ page: 1, pageSize: 5 }),
      repository.listScheduleJobs({ page: 2, pageSize: 5 }),
    ]);
    assert.deepEqual(
      [...firstPage.jobs, ...secondPage.jobs].map((job) => job.id),
      expected,
    );

    await app.close();
    client = null;
  });

  it("persists constraint profile governance with CAS and actor audits", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const app = createApp({ repository, scheduler: new PostgresDraftScheduler() });

    const createdResponse = await app.inject({
      method: "POST",
      url: "/api/constraint-profiles",
      headers: adminHeaders,
      payload: {
        name: "PostgreSQL governed profile",
        config: {
          hard_rules: ["room_capacity", "teacher_time_unique"],
          soft_weights: { room_utilization: 4 },
          time_limit_seconds: 12,
        },
      },
    });
    assert.equal(createdResponse.statusCode, 201);
    const created = createdResponse.json().profile;

    const versionPayload = {
      expectedCurrentVersionId: created.currentVersionId,
      config: {
        ...created.versions[0].config,
        time_limit_seconds: 18,
      },
    };
    const concurrentVersions = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/constraint-profiles/${created.id}/versions`,
        headers: adminHeaders,
        payload: versionPayload,
      }),
      app.inject({
        method: "POST",
        url: `/api/constraint-profiles/${created.id}/versions`,
        headers: adminHeaders,
        payload: versionPayload,
      }),
    ]);
    assert.deepEqual(
      concurrentVersions.map((response) => response.statusCode).sort(),
      [201, 409],
    );

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/constraint-profiles/${created.id}`,
      headers: adminHeaders,
    });
    assert.equal(detailResponse.statusCode, 200);
    assert.equal(detailResponse.json().profile.versions.length, 2);
    assert.equal(detailResponse.json().profile.versions[1].versionNumber, 2);

    const defaultConflict = await app.inject({
      method: "PATCH",
      url: "/api/constraint-profiles/constraint-profile-default/status",
      headers: adminHeaders,
      payload: { status: "disabled" },
    });
    assert.equal(defaultConflict.statusCode, 409);

    const defaultResponse = await app.inject({
      method: "PUT",
      url: `/api/constraint-profiles/${created.id}/default`,
      headers: adminHeaders,
    });
    assert.equal(defaultResponse.statusCode, 200);
    const disableOldDefault = await app.inject({
      method: "PATCH",
      url: "/api/constraint-profiles/constraint-profile-default/status",
      headers: adminHeaders,
      payload: { status: "disabled" },
    });
    assert.equal(disableOldDefault.statusCode, 200);

    const operatorList = await app.inject({
      method: "GET",
      url: "/api/constraint-profiles",
      headers: operatorHeaders,
    });
    assert.equal(operatorList.statusCode, 200);
    assert.ok(operatorList.json().profiles.every((profile: { status: string }) => (
      profile.status === "active"
    )));

    const profileAudits = await dbClient.db.select().from(auditEvents)
      .where(eq(auditEvents.entityId, created.id));
    assert.deepEqual(
      profileAudits.map((event) => event.action).sort(),
      [
        "constraint_profile.created",
        "constraint_profile.default_changed",
        "constraint_profile.version_created",
      ],
    );
    assert.ok(profileAudits.every((event) => event.actorUserId === "user-admin"));
    assert.ok(profileAudits.every((event) => {
      const payload = event.payload as Record<string, unknown>;
      return typeof payload.traceId === "string" && payload.traceId.length > 0;
    }));

    await app.close();
    client = null;
  });

  it("freezes a selected strategy across default changes, disablement, and retries", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const scheduler = new PostgresDraftScheduler();
    const app = createApp({ repository, scheduler });
    const referenceData = await repository.getReferenceData();

    const profileResponse = await app.inject({
      method: "POST",
      url: "/api/constraint-profiles",
      headers: adminHeaders,
      payload: {
        name: "Frozen selected strategy",
        config: {
          ...referenceData.scheduleInput.constraint_profile,
          soft_weights: {
            ...referenceData.scheduleInput.constraint_profile.soft_weights,
            room_utilization: 17,
          },
        },
      },
    });
    const profile = profileResponse.json().profile;
    const selectedVersion = profile.versions[0];
    const synchronousResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
      payload: { constraintProfileVersionId: selectedVersion.id },
    });
    assert.equal(synchronousResponse.statusCode, 201);
    const synchronousRun = synchronousResponse.json().run;
    assert.deepEqual(scheduler.lastInput?.constraint_profile, selectedVersion.config);
    assert.equal(synchronousRun.constraintProfileVersionId, selectedVersion.id);
    assert.deepEqual(synchronousRun.constraintProfileSnapshot.config, selectedVersion.config);
    assert.equal(synchronousRun.schedulerVersion, "scheduler-postgres-test");
    const [synchronousRunRow] = await dbClient.db.select().from(scheduleRuns)
      .where(eq(scheduleRuns.id, synchronousRun.id));
    assert.equal(synchronousRunRow.constraintProfileVersionId, selectedVersion.id);
    assert.deepEqual(synchronousRunRow.constraintProfileSnapshot.config, selectedVersion.config);
    assert.equal(synchronousRunRow.schedulerVersion, "scheduler-postgres-test");

    const idempotencyKey = "postgres-selected-strategy";
    const jobResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: { ...operatorHeaders, "idempotency-key": idempotencyKey },
      payload: { constraintProfileVersionId: selectedVersion.id },
    });
    assert.equal(jobResponse.statusCode, 202);
    const job = jobResponse.json().job;

    assert.equal((await app.inject({
      method: "PUT",
      url: `/api/constraint-profiles/${profile.id}/default`,
      headers: adminHeaders,
    })).statusCode, 200);
    assert.equal((await app.inject({
      method: "PUT",
      url: "/api/constraint-profiles/constraint-profile-default/default",
      headers: adminHeaders,
    })).statusCode, 200);
    assert.equal((await app.inject({
      method: "PATCH",
      url: `/api/constraint-profiles/${profile.id}/status`,
      headers: adminHeaders,
      payload: { status: "disabled" },
    })).statusCode, 200);

    const conflictingSubmission = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: { ...operatorHeaders, "idempotency-key": idempotencyKey },
      payload: {},
    });
    assert.equal(conflictingSubmission.statusCode, 409);
    assert.equal(conflictingSubmission.json().error, "schedule_job_idempotency_conflict");

    const [jobRow] = await dbClient.db.select().from(scheduleJobs)
      .where(eq(scheduleJobs.id, job.id));
    assert.equal(jobRow.requestVersion, 2);
    assert.equal(jobRow.constraintProfileVersionId, selectedVersion.id);
    assert.equal(jobRow.constraintProfileSnapshot.schemaVersion, 1);
    assert.deepEqual(jobRow.constraintProfileSnapshot.config, selectedVersion.config);
    assert.ok("version" in jobRow.requestPayload);
    assert.equal(jobRow.requestPayload.version, 2);
    assert.deepEqual(jobRow.requestPayload.input.constraint_profile, selectedVersion.config);

    const claim = await repository.claimScheduleJob(job.id);
    assert.equal(claim.resolution, "claimed");
    assert.ok(claim.resolution === "claimed");
    assert.equal(claim.requestSnapshot.version, 2);
    assert.deepEqual(claim.requestSnapshot.input.constraint_profile, selectedVersion.config);
    const result = buildScheduleResult({
      ...referenceData.scheduleInput,
      constraint_profile: selectedVersion.config,
    });
    const completion = await repository.completeScheduleJob(job.id, {
      attemptId: claim.attempt.id,
      result,
      schedulerVersion: "0.1.0-test",
    });
    assert.equal(completion.resolution, "apply");
    const [runRow] = await dbClient.db.select().from(scheduleRuns)
      .where(eq(scheduleRuns.id, completion.job?.runId ?? ""));
    assert.equal(runRow.constraintProfileVersionId, selectedVersion.id);
    assert.deepEqual(runRow.constraintProfileSnapshot, jobRow.constraintProfileSnapshot);
    assert.equal(runRow.schedulerVersion, "0.1.0-test");
    assert.equal(runRow.scoringContractVersion, result.score.scoring_contract_version);
    assert.equal(runRow.normalizedScore, result.score.normalized_score);

    await app.close();
    client = null;
  });

  it("reclaims a stalled running job only for a newer delivery attempt", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const referenceData = await repository.getReferenceData();
    const created = await repository.createScheduleJob({
      batchId: referenceData.batch.id,
      idempotencyKey: "postgres-stalled-job-reclaim",
      requestDigest: "c".repeat(64),
      requestSnapshot: {
        version: 1,
        input: referenceData.scheduleInput,
      },
      traceId: "trace-postgres-stalled-job-reclaim",
    });

    const first = await repository.claimScheduleJob(created.job.id, {
      deliveryAttempt: 1,
      reclaimRunning: true,
    });
    assert.equal(first.resolution, "claimed");

    const duplicate = await repository.claimScheduleJob(created.job.id, {
      deliveryAttempt: 1,
      reclaimRunning: true,
    });
    assert.equal(duplicate.resolution, "not_claimable");

    const reclaimResults = await Promise.all([
      repository.claimScheduleJob(created.job.id, {
        deliveryAttempt: 2,
        reclaimRunning: true,
      }),
      repository.claimScheduleJob(created.job.id, {
        deliveryAttempt: 2,
        reclaimRunning: true,
      }),
    ]);
    assert.deepEqual(
      reclaimResults.map((result) => result.resolution).sort(),
      ["claimed", "not_claimable"],
    );
    const reclaimed = reclaimResults.find((result) => result.resolution === "claimed");
    assert.ok(reclaimed?.resolution === "claimed");
    assert.equal(reclaimed.attempt.attemptNumber, 2);

    const attempts = await dbClient.db
      .select()
      .from(scheduleJobAttempts)
      .orderBy(asc(scheduleJobAttempts.attemptNumber));
    assert.deepEqual(attempts.map((attempt) => attempt.status), ["failed", "started"]);
    assert.equal(attempts[0]?.error?.code, "worker_delivery_reclaimed");
    assert.equal(attempts[0]?.error?.retryable, true);
    const retryEvents = (await dbClient.db.select().from(scheduleJobEvents))
      .filter((event) => event.eventType === "schedule_job.retry_scheduled");
    assert.equal(retryEvents.length, 1);

    await repository.close();
    client = null;
  });

  it("serializes queued and running cancellation requests", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const referenceData = await repository.getReferenceData();
    const createJob = (suffix: string) => repository.createScheduleJob({
      batchId: referenceData.batch.id,
      idempotencyKey: `postgres-cancel-${suffix}`,
      requestDigest: suffix.repeat(64).slice(0, 64),
      requestSnapshot: { version: 1 as const, input: referenceData.scheduleInput },
      traceId: `trace-postgres-cancel-${suffix}`,
    });
    const queued = await createJob("q");
    const running = await createJob("r");
    await repository.claimScheduleJob(running.job.id, { deliveryAttempt: 1 });

    const queuedResults = await Promise.all([
      repository.requestScheduleJobCancellation(queued.job.id),
      repository.requestScheduleJobCancellation(queued.job.id),
    ]);
    assert.deepEqual(
      queuedResults.map((result) => result.resolution).sort(),
      ["cancelled", "idempotent"],
    );
    assert.equal(queuedResults[0]?.job?.status, "cancelled");

    const runningResults = await Promise.all([
      repository.requestScheduleJobCancellation(running.job.id),
      repository.requestScheduleJobCancellation(running.job.id),
    ]);
    assert.deepEqual(
      runningResults.map((result) => result.resolution).sort(),
      ["idempotent", "requested"],
    );
    assert.equal(runningResults[0]?.job?.status, "running");
    assert.equal(await repository.isScheduleJobCancellationRequested(running.job.id), true);

    const events = await dbClient.db.select().from(scheduleJobEvents);
    assert.equal(events.filter((event) => (
      event.jobId === queued.job.id && event.eventType === "schedule_job.cancelled"
    )).length, 1);
    assert.equal(events.filter((event) => (
      event.jobId === running.job.id && event.eventType === "schedule_job.cancellation_requested"
    )).length, 1);

    await repository.close();
    client = null;
  });

  it("replays ordered job events and validates event cursors", async () => {
    const repository = new PostgresPlatformRepository(requireClient());
    const referenceData = await repository.getReferenceData();
    const createJob = (suffix: string) => repository.createScheduleJob({
      batchId: referenceData.batch.id,
      idempotencyKey: `postgres-events-${suffix}`,
      requestDigest: suffix.repeat(64).slice(0, 64),
      requestSnapshot: { version: 1 as const, input: referenceData.scheduleInput },
      traceId: `trace-postgres-events-${suffix}`,
    });
    const firstJob = await createJob("f");
    await repository.claimScheduleJob(firstJob.job.id, { deliveryAttempt: 1 });
    const secondJob = await createJob("s");

    const history = await repository.listScheduleJobEvents(firstJob.job.id);
    assert.deepEqual(history.map((event) => event.type), [
      "schedule_job.queued",
      "schedule_job.attempt_started",
      "schedule_job.running",
    ]);
    assert.ok(history.every((event, index) => (
      index === 0 || event.sequence > history[index - 1].sequence
    )));
    assert.deepEqual(
      await repository.resolveScheduleJobEventCursor(firstJob.job.id, history[0].eventId),
      { resolution: "valid", sequence: history[0].sequence },
    );
    assert.deepEqual(
      await repository.listScheduleJobEvents(firstJob.job.id, {
        afterSequence: history[0].sequence,
      }),
      history.slice(1),
    );
    const [secondJobEvent] = await repository.listScheduleJobEvents(secondJob.job.id);
    assert.deepEqual(
      await repository.resolveScheduleJobEventCursor(firstJob.job.id, secondJobEvent.eventId),
      { resolution: "wrong_job", sequence: null },
    );
    assert.deepEqual(
      await repository.resolveScheduleJobEventCursor(firstJob.job.id, "event-missing"),
      { resolution: "unknown", sequence: null },
    );

    await repository.close();
    client = null;
  });

  it("allows only one concurrent terminal transition", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const referenceData = await repository.getReferenceData();
    const created = await repository.createScheduleJob({
      batchId: referenceData.batch.id,
      idempotencyKey: "postgres-terminal-race",
      requestDigest: "b".repeat(64),
      requestSnapshot: {
        version: 1,
        input: referenceData.scheduleInput,
      },
      traceId: "trace-postgres-terminal-race",
    });
    await repository.transitionScheduleJob(created.job.id, { to: "running", progress: 35 });

    const results = await Promise.all([
      repository.transitionScheduleJob(created.job.id, { to: "cancelled", progress: 100 }),
      repository.transitionScheduleJob(created.job.id, { to: "timed_out", progress: 100 }),
    ]);

    assert.deepEqual(results.map((result) => result.resolution).sort(), ["apply", "reject"]);
    const finalJob = await repository.getScheduleJob(created.job.id);
    assert.ok(finalJob?.status === "cancelled" || finalJob?.status === "timed_out");
    await repository.close();
    client = null;
  });
});

function getTestDatabaseUrl() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
  if (!databaseUrl.trim()) {
    throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests.");
  }
  const parsed = new URL(databaseUrl);
  if (!parsed.pathname.includes("test")) {
    throw new Error("TEST_DATABASE_URL must point to an isolated test database.");
  }
  return databaseUrl;
}

async function resetDatabase(dbClient: ExamForgeDbClient) {
  await dbClient.pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await dbClient.pool.query("CREATE SCHEMA public");
}

function requireClient() {
  assert.ok(client, "PostgreSQL test client must be initialized.");
  return client;
}

async function closeClient() {
  if (!client) {
    return;
  }
  try {
    await client.close();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("Called end on pool more than once")) {
      throw error;
    }
  } finally {
    client = null;
  }
}

function hasCauseMessage(error: unknown, pattern: RegExp) {
  const cause = error instanceof Error
    ? (error as Error & { cause?: unknown }).cause
    : undefined;
  return cause instanceof Error && pattern.test(cause.message);
}

async function runBatchPublicationOperationsInOrder<T, U>(
  dbClient: ExamForgeDbClient,
  batchId: string,
  first: () => Promise<T>,
  second: () => Promise<U>,
) {
  const blocker = await dbClient.pool.connect();
  let released = false;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM exam_batches WHERE id = $1 FOR UPDATE", [batchId]);
    const firstResult = first();
    await waitForBatchPublicationLockWaiters(dbClient, 1);
    const secondResult = second();
    await waitForBatchPublicationLockWaiters(dbClient, 2);
    await blocker.query("COMMIT");
    released = true;
    return await Promise.all([firstResult, secondResult] as const);
  } finally {
    if (!released) {
      await blocker.query("ROLLBACK");
    }
    blocker.release();
  }
}

async function waitForBatchPublicationLockWaiters(
  dbClient: ExamForgeDbClient,
  expected: number,
) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await dbClient.pool.query<{ count: string }>(`
      SELECT count(*) AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%exam_batches%'
    `);
    if (Number(result.rows[0]?.count ?? 0) >= expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expected} PostgreSQL batch publication lock waiter(s).`);
}

async function runDraftOperationsInOrder<T, U>(
  dbClient: ExamForgeDbClient,
  draftId: string,
  first: () => Promise<T>,
  second: () => Promise<U>,
) {
  const blocker = await dbClient.pool.connect();
  let released = false;
  try {
    await blocker.query("SELECT pg_advisory_lock($1, hashtext($2))", [
      scheduleDraftLockNamespace,
      draftId,
    ]);
    const firstResult = first();
    await waitForAdvisoryLockWaiters(dbClient, draftId, 1);
    const secondResult = second();
    await waitForAdvisoryLockWaiters(dbClient, draftId, 2);
    await blocker.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
      scheduleDraftLockNamespace,
      draftId,
    ]);
    released = true;
    return await Promise.all([firstResult, secondResult] as const);
  } finally {
    if (!released) {
      await blocker.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
        scheduleDraftLockNamespace,
        draftId,
      ]);
    }
    blocker.release();
  }
}

async function waitForAdvisoryLockWaiters(
  dbClient: ExamForgeDbClient,
  draftId: string,
  expected: number,
) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const result = await dbClient.pool.query<{ count: string }>(
      `
        SELECT count(*) AS count
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND classid::bigint = $1
          AND objid::bigint = ((hashtext($2)::bigint + 4294967296) % 4294967296)
          AND objsubid = 2
          AND NOT granted
      `,
      [scheduleDraftLockNamespace, draftId],
    );
    if (Number(result.rows[0]?.count ?? 0) >= expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expected} PostgreSQL advisory lock waiter(s).`);
}

function buildScheduleResult(input: ScheduleInput): ScheduleResult {
  const result = buildCompleteScheduleResult(input);
  return {
    ...result,
    conflicts: [
      {
        type: "room_utilization_warning",
        severity: "warning",
        affected_ids: ["r-lab-1"],
        message: "测试用 PostgreSQL warning 冲突。",
        suggestion: "用于验证 conflict_records 持久化。",
      },
    ],
    score: {
      ...result.score,
      total_score: 88,
    },
    statistics: {
      ...result.statistics,
      elapsed_ms: 12,
      attempted_assignments: 16,
    },
    report: {
      summary: {
        status: "feasible",
      },
    },
  };
}

function buildIncompleteScheduleResult(input: ScheduleInput): ScheduleResult {
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
