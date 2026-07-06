import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExamForgeDbClient } from "./client.js";
import { createDbClient } from "./client.js";

export const migrationStateTableName = "schema_migrations";

export interface MigrationFile {
  id: string;
  filename: string;
  sql: string;
}

const defaultMigrationDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

export async function loadMigrationFiles(
  migrationDir = defaultMigrationDir,
): Promise<MigrationFile[]> {
  const filenames = (await readdir(migrationDir))
    .filter((filename) => filename.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(filenames.map(async (filename) => ({
    id: filename.replace(/\.sql$/, ""),
    filename,
    sql: await readFile(path.join(migrationDir, filename), "utf8"),
  })));
}

export async function runMigrations(
  client: ExamForgeDbClient = createDbClient(),
  migrationDir = defaultMigrationDir,
): Promise<MigrationFile[]> {
  const migrations = await loadMigrationFiles(migrationDir);
  const connection = await client.pool.connect();
  const applied: MigrationFile[] = [];

  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(2026070701)");
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ${migrationStateTableName} (
        id text PRIMARY KEY,
        filename text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const result = await connection.query<{ id: string }>(
      `SELECT id FROM ${migrationStateTableName}`,
    );
    const appliedIds = new Set(result.rows.map((row) => row.id));

    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) {
        continue;
      }
      await connection.query(migration.sql);
      await connection.query(
        `INSERT INTO ${migrationStateTableName} (id, filename) VALUES ($1, $2)`,
        [migration.id, migration.filename],
      );
      applied.push(migration);
    }

    await connection.query("COMMIT");
    return applied;
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = createDbClient();
  try {
    const applied = await runMigrations(client);
    console.log(JSON.stringify({
      migrated: true,
      applied: applied.map((migration) => migration.id),
    }, null, 2));
  } finally {
    await client.close();
  }
}
