import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type ExamForgeDatabase = NodePgDatabase<typeof schema>;

export interface ExamForgeDbClient {
  db: ExamForgeDatabase;
  pool: Pool;
  close(): Promise<void>;
}

export function createDbClient(databaseUrl = process.env.DATABASE_URL): ExamForgeDbClient {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required to create a PostgreSQL client.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  };
}
