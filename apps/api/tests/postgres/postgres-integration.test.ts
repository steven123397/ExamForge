import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  auditEvents,
  conflictRecords,
  createDbClient,
  draftExamInvigilators,
  draftScheduledExams,
  examTaskStudentGroups,
  runMigrations,
  scheduleJobs,
  scheduledExamInvigilators,
  scheduledExams,
  seedDemoData,
  teacherUnavailableSlots,
  type ExamForgeDbClient,
} from "@examforge/db";
import type { ScheduleInput, ScheduleResult } from "@examforge/shared";
import { eq } from "drizzle-orm";
import { createApp } from "../../src/app.js";
import { PostgresPlatformRepository } from "../../src/postgres-repository.js";
import type { SchedulerClient } from "../../src/scheduler-client.js";

const adminHeaders = { authorization: "Bearer examforge-admin-token" };
const operatorHeaders = { authorization: "Bearer examforge-operator-token" };

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

    const dashboardResponse = await app.inject({ method: "GET", url: "/api/dashboard" });
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

    assert.equal(assignmentRows.length, 2);
    assert.equal(invigilatorRows.length, 2);
    assert.equal(conflictRows.length, 1);
    assert.ok(auditRows.some((event) => event.action === "schedule_run.created"));

    const readResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/${created.run.id}`,
    });
    assert.equal(readResponse.statusCode, 200);
    assert.equal(readResponse.json().result.assignments.length, 2);
    assert.equal(readResponse.json().result.conflicts.length, 1);

    const filteredAudit = await repository.listAuditEvents({
      entityType: "schedule_run",
      entityId: created.run.id,
      actor: "system",
      limit: 50,
    });
    assert.deepEqual(
      filteredAudit.events.map((event) => event.entityId),
      [created.run.id],
    );

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
    assert.equal(initialDraftInvigilators.length, 2);

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
    assert.equal(publishResponse.json().result.assignments.length, 2);
    const publishedInvigilators = await dbClient.db
      .select()
      .from(scheduledExamInvigilators);
    assert.equal(publishedInvigilators.length, 4);

    await app.close();
    client = null;
  });

  it("persists schedule job state transitions and run links", async () => {
    const dbClient = requireClient();
    const repository = new PostgresPlatformRepository(dbClient);
    const referenceData = await repository.getReferenceData();
    const job = await repository.createScheduleJob();
    assert.equal(job.status, "queued");

    const running = await repository.updateScheduleJob(job.id, {
      status: "running",
      progress: 50,
    });
    assert.equal(running?.status, "running");
    assert.equal(running?.progress, 50);

    const run = await repository.createScheduleRun(buildScheduleResult(referenceData.scheduleInput));
    const completed = await repository.updateScheduleJob(job.id, {
      status: "completed",
      progress: 100,
      runId: run.run.id,
    });
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.runId, run.run.id);

    const [jobRow] = await dbClient.db.select().from(scheduleJobs).where(eq(scheduleJobs.id, job.id));
    assert.equal(jobRow.runId, run.run.id);

    const jobList = await repository.listScheduleJobs();
    assert.deepEqual(jobList.jobs.map((item) => item.id), [job.id]);

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

function buildScheduleResult(input: ScheduleInput): ScheduleResult {
  return {
    assignments: [
      {
        exam_task_id: "e-data-structures",
        room_id: "r-101",
        time_slot_id: "s-001",
        teacher_ids: [input.teachers[0].id],
      },
      {
        exam_task_id: "e-database",
        room_id: "r-lab-1",
        time_slot_id: "s-003",
        teacher_ids: [input.teachers[1].id],
      },
    ],
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
      total_score: 88,
      hard_violation_count: 0,
      soft_penalty_items: [],
    },
    statistics: {
      status: "partial",
      elapsed_ms: 12,
      exam_count: input.exam_tasks.length,
      room_count: input.rooms.length,
      slot_count: input.time_slots.length,
      attempted_assignments: 16,
    },
    report: {
      summary: {
        status: "partial",
      },
    },
  };
}
