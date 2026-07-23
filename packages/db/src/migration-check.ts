import { createHash } from "node:crypto";
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
  "constraint_profiles",
  "constraint_profile_versions",
  "audit_events",
  "users",
  "roles",
  "user_roles",
  "sessions",
  "auth_login_attempts",
  "user_teacher_scopes",
  "user_student_group_scopes",
];

const criticalMigrationConstraints = [
  {
    id: "users.username_unique",
    tableName: "users",
    definition: "UNIQUE (username)",
  },
  {
    id: "users.credential_version_check",
    tableName: "users",
    constraintName: "users_credential_version_check",
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
    id: "sessions.credential_version_check",
    tableName: "sessions",
    constraintName: "sessions_credential_version_check",
  },
  {
    id: "auth_login_attempts.failure_count_check",
    tableName: "auth_login_attempts",
    constraintName: "auth_login_attempts_failure_count_check",
  },
  {
    id: "user_teacher_scopes.user_primary_key",
    tableName: "user_teacher_scopes",
    constraintName: "user_teacher_scopes_pk",
  },
  {
    id: "user_teacher_scopes.teacher_unique",
    tableName: "user_teacher_scopes",
    constraintName: "user_teacher_scopes_teacher_id_unique",
  },
  {
    id: "user_teacher_scopes.user_foreign_key",
    tableName: "user_teacher_scopes",
    constraintName: "user_teacher_scopes_user_id_fk",
  },
  {
    id: "user_teacher_scopes.teacher_foreign_key",
    tableName: "user_teacher_scopes",
    constraintName: "user_teacher_scopes_teacher_id_fk",
  },
  {
    id: "user_student_group_scopes.primary_key",
    tableName: "user_student_group_scopes",
    constraintName: "user_student_group_scopes_pk",
  },
  {
    id: "user_student_group_scopes.user_foreign_key",
    tableName: "user_student_group_scopes",
    constraintName: "user_student_group_scopes_user_id_fk",
  },
  {
    id: "user_student_group_scopes.student_group_foreign_key",
    tableName: "user_student_group_scopes",
    constraintName: "user_student_group_scopes_student_group_id_fk",
  },
  {
    id: "schedule_jobs.idempotency_key_unique",
    tableName: "schedule_jobs",
    definition: "UNIQUE (idempotency_key)",
  },
  {
    id: "schedule_jobs.created_sequence_unique",
    tableName: "schedule_jobs",
    constraintName: "schedule_jobs_created_sequence_unique",
  },
  {
    id: "schedule_jobs.request_snapshot_check",
    tableName: "schedule_jobs",
    constraintName: "schedule_jobs_request_snapshot_check",
  },
  {
    id: "schedule_job_attempts.job_foreign_key",
    tableName: "schedule_job_attempts",
    definition: "FOREIGN KEY (job_id) REFERENCES schedule_jobs(id) ON DELETE CASCADE",
  },
  {
    id: "schedule_job_attempts.status_check",
    tableName: "schedule_job_attempts",
    constraintName: "schedule_job_attempts_status_check",
  },
  {
    id: "schedule_job_events.job_foreign_key",
    tableName: "schedule_job_events",
    definition: "FOREIGN KEY (job_id) REFERENCES schedule_jobs(id) ON DELETE CASCADE",
  },
  {
    id: "schedule_job_events.sequence_unique",
    tableName: "schedule_job_events",
    constraintName: "schedule_job_events_sequence_unique",
  },
  {
    id: "schedule_runs.created_sequence_unique",
    tableName: "schedule_runs",
    constraintName: "schedule_runs_created_sequence_unique",
  },
  {
    id: "audit_events.created_sequence_unique",
    tableName: "audit_events",
    constraintName: "audit_events_created_sequence_unique",
  },
  {
    id: "outbox_events.event_foreign_key",
    tableName: "outbox_events",
    definition: "FOREIGN KEY (event_id) REFERENCES schedule_job_events(id) ON DELETE CASCADE",
  },
  {
    id: "constraint_profiles.current_version_foreign_key",
    tableName: "constraint_profiles",
    constraintName: "constraint_profiles_current_version_fk",
  },
  {
    id: "constraint_profile_versions.profile_version_unique",
    tableName: "constraint_profile_versions",
    constraintName: "constraint_profile_versions_profile_version_unique",
  },
  {
    id: "schedule_jobs.constraint_profile_version_foreign_key",
    tableName: "schedule_jobs",
    constraintName: "schedule_jobs_constraint_profile_version_id_fk",
  },
  {
    id: "schedule_jobs.constraint_profile_snapshot_check",
    tableName: "schedule_jobs",
    constraintName: "schedule_jobs_constraint_profile_snapshot_check",
  },
  {
    id: "schedule_runs.constraint_profile_version_foreign_key",
    tableName: "schedule_runs",
    constraintName: "schedule_runs_constraint_profile_version_id_fk",
  },
  {
    id: "schedule_runs.constraint_profile_snapshot_check",
    tableName: "schedule_runs",
    constraintName: "schedule_runs_constraint_profile_snapshot_check",
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
  defaultConstraintProfileCount: number;
  constraintProfileMismatches: string[];
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
  const constraintProfileMismatches: string[] = [];

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
    constraintName: string;
    definition: string;
  }>(`
    SELECT
      constraint_row.conrelid::regclass::text AS "tableName",
      constraint_row.conname AS "constraintName",
      pg_get_constraintdef(constraint_row.oid) AS definition
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.connamespace = 'public'::regnamespace
  `);
  const availableConstraints = new Set(
    constraintResult.rows.map((row) => `${row.tableName}:${row.definition}`),
  );
  const availableConstraintNames = new Set(
    constraintResult.rows.map((row) => `${row.tableName}:${row.constraintName}`),
  );
  for (const constraint of criticalMigrationConstraints) {
    const available = "constraintName" in constraint
      ? availableConstraintNames.has(`${constraint.tableName}:${constraint.constraintName}`)
      : availableConstraints.has(`${constraint.tableName}:${constraint.definition}`);
    if (!available) {
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

  const defaultProfileResult = await client.pool.query<{ count: string }>(`
    SELECT count(*)::text AS count
    FROM constraint_profiles
    WHERE is_default
  `);
  const defaultConstraintProfileCount = Number(defaultProfileResult.rows[0]?.count ?? 0);
  if (defaultConstraintProfileCount !== 1) {
    constraintProfileMismatches.push(
      `constraint_profiles.default_count:${defaultConstraintProfileCount}`,
    );
  }

  const invalidCurrentProfiles = await client.pool.query<{ id: string }>(`
    SELECT profile.id
    FROM constraint_profiles AS profile
    LEFT JOIN constraint_profile_versions AS version
      ON version.id = profile.current_version_id
      AND version.profile_id = profile.id
    WHERE version.id IS NULL
    ORDER BY profile.id
  `);
  for (const row of invalidCurrentProfiles.rows) {
    constraintProfileMismatches.push(`constraint_profiles.current_version:${row.id}`);
  }

  const versionRows = await client.pool.query<{
    id: string;
    digest: string;
    config: unknown;
  }>(`
    SELECT id, digest, config
    FROM constraint_profile_versions
    ORDER BY id
  `);
  for (const row of versionRows.rows) {
    const actualDigest = createHash("sha256")
      .update(canonicalJson(row.config))
      .digest("hex");
    if (actualDigest !== row.digest) {
      constraintProfileMismatches.push(`constraint_profile_versions.digest:${row.id}`);
    }
  }

  for (const tableName of ["schedule_jobs", "schedule_runs"] as const) {
    const mismatchedSnapshots = await client.pool.query<{ id: string }>(`
      SELECT record.id
      FROM ${tableName} AS record
      LEFT JOIN constraint_profile_versions AS version
        ON version.id = record.constraint_profile_version_id
      WHERE record.constraint_profile_version_id IS NOT NULL
        AND (
          version.id IS NULL
          OR record.constraint_profile_snapshot ->> 'profileId' <> version.profile_id
          OR record.constraint_profile_snapshot ->> 'profileVersionId' <> version.id
          OR (record.constraint_profile_snapshot ->> 'versionNumber')::integer
            <> version.version_number
          OR record.constraint_profile_snapshot ->> 'digest' <> version.digest
          OR record.constraint_profile_snapshot -> 'config' <> version.config
        )
      ORDER BY record.id
    `);
    for (const row of mismatchedSnapshots.rows) {
      constraintProfileMismatches.push(`${tableName}.snapshot:${row.id}`);
    }
  }

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
    defaultConstraintProfileCount,
    constraintProfileMismatches,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = createDbClient(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL);
  try {
    console.log(JSON.stringify(await checkMigrations(client), null, 2));
  } finally {
    await client.close();
  }
}
