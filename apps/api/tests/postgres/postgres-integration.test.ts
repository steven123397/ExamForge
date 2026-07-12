import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
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
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { PostgresPlatformRepository } from "../../src/postgres-repository.js";
import { hashSessionToken } from "../../src/auth/security.js";
import type { SchedulerClient } from "../../src/scheduler-client.js";
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
  async solve(input: ScheduleInput): Promise<ScheduleResult> {
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
      headers: viewerHeaders,
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

    const readResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/${created.run.id}`,
      headers: viewerHeaders,
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
      headers: viewerHeaders,
    });
    assert.equal(runDetailResponse.statusCode, 200);
    const runAssignment = runDetailResponse.json().result.assignments.find(
      (assignment: { exam_task_id: string }) => assignment.exam_task_id === "e-data-structures",
    );
    assert.deepEqual(runAssignment.teacher_ids, ["t-zhang"]);

    const teacherScheduleResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule/teachers/t-zhang",
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
      headers: viewerHeaders,
    });
    assert.equal(draftDetailResponse.statusCode, 200);
    const draftAssignment = draftDetailResponse.json().assignments.find(
      (assignment: { exam_task_id: string }) => assignment.exam_task_id === "e-data-structures",
    );
    assert.deepEqual(draftAssignment.teacher_ids, ["t-zhang"]);

    const comparisonResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-drafts/${draft.draft.id}/compare`,
      headers: viewerHeaders,
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

    const running = await repository.transitionScheduleJob(job.id, {
      to: "running",
      progress: 50,
    });
    assert.equal(running.resolution, "apply");
    assert.equal(running.job?.status, "running");
    assert.equal((await dbClient.db.select().from(scheduleJobAttempts)).length, 1);

    const result = buildScheduleResult(referenceData.scheduleInput);
    const [firstCompletion, duplicateCompletion] = await Promise.all([
      repository.completeScheduleJob(job.id, result),
      repository.completeScheduleJob(job.id, result),
    ]);
    assert.deepEqual(
      [firstCompletion.resolution, duplicateCompletion.resolution].sort(),
      ["apply", "idempotent"],
    );
    assert.equal(firstCompletion.job?.runId, duplicateCompletion.job?.runId);
    assert.equal((await dbClient.db.select().from(scheduleRuns)).length, 1);

    const [jobRow] = await dbClient.db.select().from(scheduleJobs).where(eq(scheduleJobs.id, job.id));
    assert.equal(jobRow.runId, firstCompletion.job?.runId);

    const jobList = await repository.listScheduleJobs();
    assert.deepEqual(jobList.jobs.map((item) => item.id), [job.id]);

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
