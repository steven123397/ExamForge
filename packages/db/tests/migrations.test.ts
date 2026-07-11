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
    assert.deepEqual(result.missingConstraints, []);
    assert.deepEqual(result.backfillMismatches, []);
    assert.ok(result.checkedConstraints.includes("exam_task_student_groups.primary_key"));
    assert.ok(result.checkedConstraints.includes("scheduled_exam_invigilators.teacher_foreign_key"));
    assert.ok(result.checkedConstraints.includes("draft_exam_invigilators.teacher_foreign_key"));
    assert.ok(result.checkedConstraints.includes("teacher_unavailable_slots.primary_key"));
  });

  it("detects missing association constraints and JSONB backfill rows", async () => {
    assert.ok(client);
    await runMigrations(client);
    await seedDemoData(client);
    await client.pool.query(`
      ALTER TABLE scheduled_exam_invigilators
      DROP CONSTRAINT scheduled_exam_invigilators_teacher_id_fkey
    `);
    await client.pool.query("DELETE FROM teacher_unavailable_slots");

    const result = await checkMigrations(client);

    assert.ok(result.missingConstraints.includes(
      "scheduled_exam_invigilators.teacher_foreign_key",
    ));
    assert.ok(result.backfillMismatches.includes("teacher_unavailable_slots"));
  });

  it("detects association rows that are not present in JSONB compatibility fields", async () => {
    assert.ok(client);
    await runMigrations(client);
    await seedDemoData(client);
    await client.pool.query(`
      INSERT INTO teacher_unavailable_slots (teacher_id, time_slot_id)
      VALUES ('t-li', 's-001')
    `);

    const result = await checkMigrations(client);

    assert.ok(result.backfillMismatches.includes("teacher_unavailable_slots"));
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
