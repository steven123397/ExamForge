import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createDbClient, loadMigrationFiles, type ExamForgeDbClient } from "../src/index.js";
import { checkMigrations } from "../src/migration-check.js";

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
