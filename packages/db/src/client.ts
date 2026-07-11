import { Pool, type PoolClient } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

export type ExamForgeDatabase = NodePgDatabase<typeof schema>;

export interface ExamForgeDbClient {
  db: ExamForgeDatabase;
  pool: Pool;
  close(): Promise<void>;
}

export interface ExamForgeDbSession {
  db: ExamForgeDatabase;
  drain(): Promise<void>;
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

export function createDbSession(connection: PoolClient): ExamForgeDbSession {
  let tail = Promise.resolve();
  const runQuery = connection.query.bind(connection) as unknown as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const serializedConnection = new Proxy(connection, {
    get(target, property) {
      if (property === "query") {
        return (...args: unknown[]) => {
          const result = tail.then(() => runQuery(...args));
          tail = result.then(() => undefined, () => undefined);
          return result;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    db: drizzle(serializedConnection, { schema }),
    async drain() {
      while (true) {
        const current = tail;
        await current;
        if (current === tail) {
          return;
        }
      }
    },
  };
}
