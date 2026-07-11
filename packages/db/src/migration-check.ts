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
  "audit_events",
];

const criticalMigrationConstraints = [
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

const associationBackfillChecks = [
  {
    id: "exam_task_student_groups",
    sql: `
      WITH expected AS (
        SELECT task.id AS exam_task_id, group_id.value AS student_group_id
        FROM exam_tasks AS task
        CROSS JOIN LATERAL jsonb_array_elements_text(task.student_group_ids) AS group_id(value)
      ), mismatches AS (
        (SELECT * FROM expected EXCEPT SELECT exam_task_id, student_group_id FROM exam_task_student_groups)
        UNION ALL
        (SELECT exam_task_id, student_group_id FROM exam_task_student_groups EXCEPT SELECT * FROM expected)
      )
      SELECT COUNT(*)::integer AS count FROM mismatches
    `,
  },
  {
    id: "scheduled_exam_invigilators",
    sql: `
      WITH expected AS (
        SELECT scheduled_exam.id AS scheduled_exam_id,
          teacher_id.position::integer AS position,
          teacher_id.value AS teacher_id
        FROM scheduled_exams AS scheduled_exam
        CROSS JOIN LATERAL jsonb_array_elements_text(scheduled_exam.teacher_ids)
          WITH ORDINALITY AS teacher_id(value, position)
      ), mismatches AS (
        (SELECT * FROM expected EXCEPT SELECT scheduled_exam_id, position, teacher_id FROM scheduled_exam_invigilators)
        UNION ALL
        (SELECT scheduled_exam_id, position, teacher_id FROM scheduled_exam_invigilators EXCEPT SELECT * FROM expected)
      )
      SELECT COUNT(*)::integer AS count FROM mismatches
    `,
  },
  {
    id: "draft_exam_invigilators",
    sql: `
      WITH expected AS (
        SELECT scheduled_exam.id AS draft_scheduled_exam_id,
          teacher_id.position::integer AS position,
          teacher_id.value AS teacher_id
        FROM draft_scheduled_exams AS scheduled_exam
        CROSS JOIN LATERAL jsonb_array_elements_text(scheduled_exam.teacher_ids)
          WITH ORDINALITY AS teacher_id(value, position)
      ), mismatches AS (
        (SELECT * FROM expected EXCEPT SELECT draft_scheduled_exam_id, position, teacher_id FROM draft_exam_invigilators)
        UNION ALL
        (SELECT draft_scheduled_exam_id, position, teacher_id FROM draft_exam_invigilators EXCEPT SELECT * FROM expected)
      )
      SELECT COUNT(*)::integer AS count FROM mismatches
    `,
  },
  {
    id: "teacher_unavailable_slots",
    sql: `
      WITH expected AS (
        SELECT teacher.id AS teacher_id, slot_id.value AS time_slot_id
        FROM teachers AS teacher
        CROSS JOIN LATERAL jsonb_array_elements_text(teacher.unavailable_slot_ids) AS slot_id(value)
      ), mismatches AS (
        (SELECT * FROM expected EXCEPT SELECT teacher_id, time_slot_id FROM teacher_unavailable_slots)
        UNION ALL
        (SELECT teacher_id, time_slot_id FROM teacher_unavailable_slots EXCEPT SELECT * FROM expected)
      )
      SELECT COUNT(*)::integer AS count FROM mismatches
    `,
  },
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

  for (const check of associationBackfillChecks) {
    if (missingTables.includes(check.id)) {
      backfillMismatches.push(check.id);
      continue;
    }
    const result = await client.pool.query<{ count: number }>(check.sql);
    if ((result.rows[0]?.count ?? 0) > 0) {
      backfillMismatches.push(check.id);
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
