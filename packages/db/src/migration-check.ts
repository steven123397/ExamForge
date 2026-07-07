import { pathToFileURL } from "node:url";
import { createDbClient, type ExamForgeDbClient } from "./client.js";
import { loadMigrationFiles, migrationStateTableName, runMigrations } from "./migrations.js";

const criticalTables = [
  migrationStateTableName,
  "exam_batches",
  "schedule_runs",
  "scheduled_exams",
  "schedule_drafts",
  "schedule_jobs",
  "audit_events",
];

export interface MigrationCheckResult {
  migrationCount: number;
  firstRunAppliedCount: number;
  secondRunAppliedCount: number;
  checkedTables: string[];
  missingTables: string[];
}

export async function checkMigrations(
  client: ExamForgeDbClient = createDbClient(),
): Promise<MigrationCheckResult> {
  const migrationFiles = await loadMigrationFiles();
  const firstRunApplied = await runMigrations(client);
  const secondRunApplied = await runMigrations(client);
  const missingTables: string[] = [];

  for (const tableName of criticalTables) {
    const result = await client.pool.query<{ exists: string | null }>(
      "SELECT to_regclass($1) AS exists",
      [`public.${tableName}`],
    );
    if (!result.rows[0]?.exists) {
      missingTables.push(tableName);
    }
  }

  return {
    migrationCount: migrationFiles.length,
    firstRunAppliedCount: firstRunApplied.length,
    secondRunAppliedCount: secondRunApplied.length,
    checkedTables: criticalTables,
    missingTables,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = createDbClient(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);
  try {
    console.log(JSON.stringify(await checkMigrations(client), null, 2));
  } finally {
    await client.close();
  }
}
