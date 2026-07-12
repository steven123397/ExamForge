import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createDbClient,
  createDbSession,
  loadMigrationFiles,
  runMigrations,
  seedDemoData,
  type ExamForgeDbClient,
} from "../src/index.js";
import { checkMigrations } from "../src/migration-check.js";
import { sql } from "drizzle-orm";

const testDatabaseUrl = getTestDatabaseUrl();
let client: ExamForgeDbClient | null = null;

describe("database migration checks", () => {
  beforeEach(async () => {
    client = createDbClient(testDatabaseUrl);
    await resetDatabase(client);
  });

  afterEach(async () => {
    await client?.close();
    client = null;
  });

  it("runs all migrations from an empty database and does not replay them", async () => {
    const migrationFiles = await loadMigrationFiles();
    const result = await checkMigrations(client);

    assert.equal(result.migrationCount, migrationFiles.length);
    assert.equal(result.firstRunAppliedCount, migrationFiles.length);
    assert.equal(result.secondRunAppliedCount, 0);
    assert.deepEqual(result.missingTables, []);
    assert.ok(result.checkedTables.includes("schedule_jobs"));
    assert.ok(result.checkedTables.includes("schema_migrations"));
    assert.ok(result.checkedTables.includes("exam_task_student_groups"));
    assert.ok(result.checkedTables.includes("scheduled_exam_invigilators"));
    assert.ok(result.checkedTables.includes("draft_exam_invigilators"));
    assert.ok(result.checkedTables.includes("teacher_unavailable_slots"));
    assert.ok(result.checkedTables.includes("schedule_job_attempts"));
    assert.ok(result.checkedTables.includes("schedule_job_events"));
    assert.ok(result.checkedTables.includes("outbox_events"));
    assert.ok(result.checkedTables.includes("users"));
    assert.ok(result.checkedTables.includes("roles"));
    assert.ok(result.checkedTables.includes("user_roles"));
    assert.ok(result.checkedTables.includes("sessions"));
    assert.deepEqual(result.missingConstraints, []);
    assert.deepEqual(result.backfillMismatches, []);
    assert.deepEqual(result.legacyRelationColumns, []);
    assert.ok(result.checkedConstraints.includes("exam_task_student_groups.primary_key"));
    assert.ok(result.checkedConstraints.includes("scheduled_exam_invigilators.teacher_foreign_key"));
    assert.ok(result.checkedConstraints.includes("draft_exam_invigilators.teacher_foreign_key"));
    assert.ok(result.checkedConstraints.includes("teacher_unavailable_slots.primary_key"));
    assert.ok(result.checkedConstraints.includes("schedule_jobs.idempotency_key_unique"));
    assert.ok(result.checkedConstraints.includes("schedule_job_attempts.job_foreign_key"));
    assert.ok(result.checkedConstraints.includes("schedule_job_events.job_foreign_key"));
    assert.ok(result.checkedConstraints.includes("outbox_events.event_foreign_key"));
    assert.ok(result.checkedConstraints.includes("users.username_unique"));
    assert.ok(result.checkedConstraints.includes("user_roles.primary_key"));
    assert.ok(result.checkedConstraints.includes("sessions.token_digest_unique"));
    assert.deepEqual(result.scheduleJobStatuses, [
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "timed_out",
    ]);
  });

  it("upgrades completed jobs from the fourth-version schema exactly once", async () => {
    assert.ok(client);
    await applyMigrationsThrough(client, "0007_association_tables");
    await client.pool.query(`
      INSERT INTO exam_batches (
        id, name, status, start_date, end_date, constraint_profile
      ) VALUES (
        'batch-v4', 'Fourth-version batch', 'ready', '2026-07-10', '2026-07-14', '{}'::jsonb
      );
      INSERT INTO schedule_jobs (id, status, progress)
      VALUES ('job-completed-v4', 'completed', 100)
    `);

    const firstRun = await runMigrations(client);
    const secondRun = await runMigrations(client);
    const statusResult = await client.pool.query<{ status: string }>(
      "SELECT status::text AS status FROM schedule_jobs WHERE id = 'job-completed-v4'",
    );
    const enumResult = await client.pool.query<{ value: string }>(`
      SELECT enumlabel AS value
      FROM pg_enum
      WHERE enumtypid = 'schedule_job_status'::regtype
      ORDER BY enumsortorder
    `);

    assert.deepEqual(firstRun.map((migration) => migration.id), [
      "0008_schedule_job_status",
      "0009_schedule_job_delivery",
      "0010_remove_legacy_relation_jsonb",
      "0011_identity_sessions",
    ]);
    assert.deepEqual(secondRun, []);
    assert.equal(statusResult.rows[0]?.status, "succeeded");
    assert.deepEqual(enumResult.rows.map((row) => row.value), [
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "timed_out",
    ]);
  });

  it("rejects removing legacy columns when an association row is missing", async () => {
    assert.ok(client);
    await applyMigrationsThrough(client, "0009_schedule_job_delivery");
    await seedLegacyTeacherUnavailableData(client);
    await client.pool.query("DELETE FROM teacher_unavailable_slots");

    await assert.rejects(runMigrations(client), /association drift: teacher_unavailable_slots/);
    const columnResult = await client.pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'teachers'
          AND column_name = 'unavailable_slot_ids'
      ) AS exists
    `);
    assert.equal(columnResult.rows[0]?.exists, true);
  });

  it("rejects removing legacy columns when an association row is extra", async () => {
    assert.ok(client);
    await applyMigrationsThrough(client, "0009_schedule_job_delivery");
    await seedLegacyTeacherUnavailableData(client);
    await client.pool.query(`
      INSERT INTO teacher_unavailable_slots (teacher_id, time_slot_id)
      VALUES ('t-li', 's-001')
    `);

    await assert.rejects(runMigrations(client), /association drift: teacher_unavailable_slots/);
  });

  it("drains queued session queries after a query fails", async () => {
    assert.ok(client);
    const connection = await client.pool.connect();
    try {
      const session = createDbSession(connection);
      const startedAt = Date.now();
      const failedQuery = session.db.execute(sql.raw("SELECT * FROM examforge_missing_table"));
      const delayedQuery = session.db.execute(sql.raw("SELECT pg_sleep(0.15)"));

      await assert.rejects(Promise.all([failedQuery, delayedQuery]));
      await session.drain();

      assert.ok(Date.now() - startedAt >= 100);
    } finally {
      connection.release();
    }
  });
});

function getTestDatabaseUrl() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? "";
  if (!databaseUrl.trim()) {
    throw new Error("TEST_DATABASE_URL is required for migration tests.");
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

async function applyMigrationsThrough(dbClient: ExamForgeDbClient, finalId: string) {
  const migrations = await loadMigrationFiles();
  const selected = migrations.filter((migration) => migration.id <= finalId);
  assert.equal(selected.at(-1)?.id, finalId);
  const connection = await dbClient.pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query(`
      CREATE TABLE schema_migrations (
        id text PRIMARY KEY,
        filename text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const migration of selected) {
      await connection.query(migration.sql);
      await connection.query(
        "INSERT INTO schema_migrations (id, filename) VALUES ($1, $2)",
        [migration.id, migration.filename],
      );
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

async function seedLegacyTeacherUnavailableData(dbClient: ExamForgeDbClient) {
  await dbClient.pool.query(`
    INSERT INTO departments (id, name) VALUES ('cs', 'Computer Science');
    INSERT INTO exam_batches (
      id, name, status, start_date, end_date, constraint_profile
    ) VALUES (
      'batch-v4-relations', 'Fourth-version relations', 'ready',
      '2026-07-10', '2026-07-14', '{}'::jsonb
    );
    INSERT INTO teachers (id, name, department_id, unavailable_slot_ids) VALUES
      ('t-zhang', 'Teacher Zhang', 'cs', '["s-001"]'::jsonb),
      ('t-li', 'Teacher Li', 'cs', '[]'::jsonb);
    INSERT INTO time_slots (
      id, batch_id, date, start_time, end_time, period_index
    ) VALUES (
      's-001', 'batch-v4-relations', '2026-07-10', '09:00', '11:00', 0
    );
    INSERT INTO teacher_unavailable_slots (teacher_id, time_slot_id)
    VALUES ('t-zhang', 's-001');
  `);
}
