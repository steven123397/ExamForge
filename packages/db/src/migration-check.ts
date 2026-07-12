import { pathToFileURL } from "node:url";
import { createDbClient, type ExamForgeDbClient } from "./client.js";
import { loadMigrationFiles, migrationStateTableName, runMigrations } from "./migrations.js";

export const criticalMigrationTables = [
  migrationStateTableName,
  "exam_batches",
  "schedule_runs",
  "scheduled_exams",
  "exam_task_student_groups",
  "scheduled_exam_invigilators",
  "schedule_drafts",
  "draft_exam_invigilators",
  "teacher_unavailable_slots",
  "schedule_jobs",
  "schedule_job_attempts",
  "schedule_job_events",
  "outbox_events",
  "audit_events",
  "users",
  "roles",
  "user_roles",
  "sessions",
];

const criticalMigrationConstraints = [
  {
    id: "users.username_unique",
    tableName: "users",
    definition: "UNIQUE (username)",
  },
  {
    id: "user_roles.primary_key",
    tableName: "user_roles",
    definition: "PRIMARY KEY (user_id, role_id)",
  },
  {
    id: "sessions.token_digest_unique",
    tableName: "sessions",
    definition: "UNIQUE (token_digest)",
  },
  {
    id: "schedule_jobs.idempotency_key_unique",
    tableName: "schedule_jobs",
    definition: "UNIQUE (idempotency_key)",
  },
  {
    id: "schedule_job_attempts.job_foreign_key",
    tableName: "schedule_job_attempts",
    definition: "FOREIGN KEY (job_id) REFERENCES schedule_jobs(id) ON DELETE CASCADE",
  },
  {
    id: "schedule_job_events.job_foreign_key",
    tableName: "schedule_job_events",
    definition: "FOREIGN KEY (job_id) REFERENCES schedule_jobs(id) ON DELETE CASCADE",
  },
  {
    id: "outbox_events.event_foreign_key",
    tableName: "outbox_events",
    definition: "FOREIGN KEY (event_id) REFERENCES schedule_job_events(id) ON DELETE CASCADE",
  },
  {
    id: "exam_task_student_groups.primary_key",
    tableName: "exam_task_student_groups",
    definition: "PRIMARY KEY (exam_task_id, student_group_id)",
  },
  {
    id: "exam_task_student_groups.exam_task_foreign_key",
    tableName: "exam_task_student_groups",
    definition: "FOREIGN KEY (exam_task_id) REFERENCES exam_tasks(id) ON DELETE CASCADE",
  },
  {
    id: "exam_task_student_groups.student_group_foreign_key",
    tableName: "exam_task_student_groups",
    definition: "FOREIGN KEY (student_group_id) REFERENCES student_groups(id)",
  },
  {
    id: "scheduled_exam_invigilators.primary_key",
    tableName: "scheduled_exam_invigilators",
    definition: 'PRIMARY KEY (scheduled_exam_id, "position")',
  },
  {
    id: "scheduled_exam_invigilators.scheduled_exam_foreign_key",
    tableName: "scheduled_exam_invigilators",
    definition: "FOREIGN KEY (scheduled_exam_id) REFERENCES scheduled_exams(id) ON DELETE CASCADE",
  },
  {
    id: "scheduled_exam_invigilators.teacher_foreign_key",
    tableName: "scheduled_exam_invigilators",
    definition: "FOREIGN KEY (teacher_id) REFERENCES teachers(id)",
  },
  {
    id: "draft_exam_invigilators.primary_key",
    tableName: "draft_exam_invigilators",
    definition: 'PRIMARY KEY (draft_scheduled_exam_id, "position")',
  },
  {
    id: "draft_exam_invigilators.draft_exam_foreign_key",
    tableName: "draft_exam_invigilators",
    definition: "FOREIGN KEY (draft_scheduled_exam_id) REFERENCES draft_scheduled_exams(id) ON DELETE CASCADE",
  },
  {
    id: "draft_exam_invigilators.teacher_foreign_key",
    tableName: "draft_exam_invigilators",
    definition: "FOREIGN KEY (teacher_id) REFERENCES teachers(id)",
  },
  {
    id: "teacher_unavailable_slots.primary_key",
    tableName: "teacher_unavailable_slots",
    definition: "PRIMARY KEY (teacher_id, time_slot_id)",
  },
  {
    id: "teacher_unavailable_slots.teacher_foreign_key",
    tableName: "teacher_unavailable_slots",
    definition: "FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE",
  },
  {
    id: "teacher_unavailable_slots.time_slot_foreign_key",
    tableName: "teacher_unavailable_slots",
    definition: "FOREIGN KEY (time_slot_id) REFERENCES time_slots(id) ON DELETE CASCADE",
  },
] as const;

const legacyRelationColumns = [
  ["exam_tasks", "student_group_ids"],
  ["scheduled_exams", "teacher_ids"],
  ["draft_scheduled_exams", "teacher_ids"],
  ["teachers", "unavailable_slot_ids"],
] as const;

export interface MigrationCheckResult {
  migrationCount: number;
  firstRunAppliedCount: number;
  secondRunAppliedCount: number;
  checkedTables: string[];
  missingTables: string[];
  checkedConstraints: string[];
  missingConstraints: string[];
  backfillMismatches: string[];
  legacyRelationColumns: string[];
  scheduleJobStatuses: string[];
}

export async function checkMigrations(
  client: ExamForgeDbClient = createDbClient(),
): Promise<MigrationCheckResult> {
  const migrationFiles = await loadMigrationFiles();
  const firstRunApplied = await runMigrations(client);
  const secondRunApplied = await runMigrations(client);
  const missingTables: string[] = [];
  const missingConstraints: string[] = [];
  const backfillMismatches: string[] = [];
  const remainingLegacyRelationColumns: string[] = [];

  for (const tableName of criticalMigrationTables) {
    const result = await client.pool.query<{ exists: string | null }>(
      "SELECT to_regclass($1) AS exists",
      [`public.${tableName}`],
    );
    if (!result.rows[0]?.exists) {
      missingTables.push(tableName);
    }
  }

  const constraintResult = await client.pool.query<{
    tableName: string;
    definition: string;
  }>(`
    SELECT
      constraint_row.conrelid::regclass::text AS "tableName",
      pg_get_constraintdef(constraint_row.oid) AS definition
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.connamespace = 'public'::regnamespace
  `);
  const availableConstraints = new Set(
    constraintResult.rows.map((row) => `${row.tableName}:${row.definition}`),
  );
  for (const constraint of criticalMigrationConstraints) {
    if (!availableConstraints.has(`${constraint.tableName}:${constraint.definition}`)) {
      missingConstraints.push(constraint.id);
    }
  }

  for (const [tableName, columnName] of legacyRelationColumns) {
    const result = await client.pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS exists
    `, [tableName, columnName]);
    if (result.rows[0]?.exists) {
      remainingLegacyRelationColumns.push(`${tableName}.${columnName}`);
    }
  }

  const scheduleJobStatusResult = await client.pool.query<{ value: string }>(`
    SELECT enumlabel AS value
    FROM pg_enum
    WHERE enumtypid = 'schedule_job_status'::regtype
    ORDER BY enumsortorder
  `);

  return {
    migrationCount: migrationFiles.length,
    firstRunAppliedCount: firstRunApplied.length,
    secondRunAppliedCount: secondRunApplied.length,
    checkedTables: criticalMigrationTables,
    missingTables,
    checkedConstraints: criticalMigrationConstraints.map((constraint) => constraint.id),
    missingConstraints,
    backfillMismatches,
    legacyRelationColumns: remainingLegacyRelationColumns,
    scheduleJobStatuses: scheduleJobStatusResult.rows.map((row) => row.value),
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
