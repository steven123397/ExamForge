import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { demoScheduleInput } from "@examforge/shared";
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
    assert.ok(result.checkedTables.includes("constraint_profiles"));
    assert.ok(result.checkedTables.includes("constraint_profile_versions"));
    assert.ok(result.checkedTables.includes("users"));
    assert.ok(result.checkedTables.includes("roles"));
    assert.ok(result.checkedTables.includes("user_roles"));
    assert.ok(result.checkedTables.includes("sessions"));
    assert.ok(result.checkedTables.includes("user_teacher_scopes"));
    assert.ok(result.checkedTables.includes("user_student_group_scopes"));
    assert.deepEqual(result.missingConstraints, []);
    assert.deepEqual(result.backfillMismatches, []);
    assert.deepEqual(result.legacyRelationColumns, []);
    assert.equal(result.defaultConstraintProfileCount, 1);
    assert.deepEqual(result.constraintProfileMismatches, []);
    assert.ok(result.checkedConstraints.includes("exam_task_student_groups.primary_key"));
    assert.ok(result.checkedConstraints.includes("scheduled_exam_invigilators.teacher_foreign_key"));
    assert.ok(result.checkedConstraints.includes("draft_exam_invigilators.teacher_foreign_key"));
    assert.ok(result.checkedConstraints.includes("teacher_unavailable_slots.primary_key"));
    assert.ok(result.checkedConstraints.includes("schedule_jobs.idempotency_key_unique"));
    assert.ok(result.checkedConstraints.includes("schedule_job_attempts.job_foreign_key"));
    assert.ok(result.checkedConstraints.includes("schedule_job_events.job_foreign_key"));
    assert.ok(result.checkedConstraints.includes("schedule_jobs.request_snapshot_check"));
    assert.ok(result.checkedConstraints.includes("schedule_job_attempts.status_check"));
    assert.ok(result.checkedConstraints.includes("schedule_job_events.sequence_unique"));
    assert.ok(result.checkedConstraints.includes("outbox_events.event_foreign_key"));
    assert.ok(result.checkedConstraints.includes("constraint_profiles.current_version_foreign_key"));
    assert.ok(result.checkedConstraints.includes("constraint_profile_versions.profile_version_unique"));
    assert.ok(result.checkedConstraints.includes("schedule_jobs.constraint_profile_version_foreign_key"));
    assert.ok(result.checkedConstraints.includes("schedule_jobs.constraint_profile_snapshot_check"));
    assert.ok(result.checkedConstraints.includes("schedule_runs.constraint_profile_version_foreign_key"));
    assert.ok(result.checkedConstraints.includes("schedule_runs.constraint_profile_snapshot_check"));
    assert.ok(result.checkedConstraints.includes("users.username_unique"));
    assert.ok(result.checkedConstraints.includes("user_roles.primary_key"));
    assert.ok(result.checkedConstraints.includes("sessions.token_digest_unique"));
    assert.ok(result.checkedConstraints.includes("user_teacher_scopes.user_primary_key"));
    assert.ok(result.checkedConstraints.includes("user_teacher_scopes.teacher_unique"));
    assert.ok(result.checkedConstraints.includes("user_student_group_scopes.primary_key"));
    assert.deepEqual(result.scheduleJobStatuses, [
      "queued",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "timed_out",
    ]);
  });

  it("upgrades fourth-phase users with valid audience scopes exactly once", async () => {
    assert.ok(client);
    await applyMigrationsThrough(client, "0013_constraint_profiles");
    await seedDemoData(client);
    await client.pool.query(`
      INSERT INTO users (
        id, username, display_name, active, password_hash, password_salt,
        scrypt_n, scrypt_r, scrypt_p, scrypt_key_length
      ) VALUES
        ('user-teacher', 'teacher', 'Teacher', true, 'hash', 'salt', 2, 1, 1, 1),
        ('user-teacher-2', 'teacher-2', 'Teacher 2', true, 'hash', 'salt', 2, 1, 1, 1),
        ('user-student', 'student', 'Student', true, 'hash', 'salt', 2, 1, 1, 1)
    `);

    const firstRun = await runMigrations(client);
    const secondRun = await runMigrations(client);
    const teacherScopes = await client.pool.query<{
      username: string;
      teacherId: string;
    }>(`
      SELECT app_user.username, scope.teacher_id AS "teacherId"
      FROM user_teacher_scopes AS scope
      JOIN users AS app_user ON app_user.id = scope.user_id
      ORDER BY app_user.username
    `);
    const studentScopes = await client.pool.query<{
      username: string;
      studentGroupId: string;
    }>(`
      SELECT app_user.username, scope.student_group_id AS "studentGroupId"
      FROM user_student_group_scopes AS scope
      JOIN users AS app_user ON app_user.id = scope.user_id
      ORDER BY app_user.username, scope.student_group_id
    `);

    assert.deepEqual(firstRun.map((migration) => migration.id), [
      "0014_user_audience_scopes",
    ]);
    assert.deepEqual(secondRun, []);
    assert.deepEqual(teacherScopes.rows, [{ username: "teacher", teacherId: "t-zhang" }]);
    assert.deepEqual(studentScopes.rows, [{
      username: "student",
      studentGroupId: "g-cs-2301",
    }]);

    await assert.rejects(client.pool.query(`
      INSERT INTO user_teacher_scopes (user_id, teacher_id)
      VALUES ('user-teacher-2', 'teacher-missing')
    `), /foreign key/i);
    await assert.rejects(client.pool.query(`
      INSERT INTO user_student_group_scopes (user_id, student_group_id)
      VALUES ('user-student', 'group-missing')
    `), /foreign key/i);
    await assert.rejects(client.pool.query(`
      INSERT INTO user_teacher_scopes (user_id, teacher_id)
      VALUES ('user-teacher-2', 't-zhang')
    `), /unique/i);
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
      "0012_reliable_schedule_jobs",
      "0013_constraint_profiles",
      "0014_user_audience_scopes",
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

  it("marks legacy active jobs unrecoverable and adds durable request snapshots", async () => {
    assert.ok(client);
    await applyMigrationsThrough(client, "0011_identity_sessions");
    await client.pool.query(`
      INSERT INTO exam_batches (
        id, name, status, start_date, end_date, constraint_profile
      ) VALUES (
        'batch-v5p2', 'Fifth-version phase two', 'ready',
        '2026-07-13', '2026-07-17', '{}'::jsonb
      );
      INSERT INTO schedule_jobs (
        id, batch_id, status, progress, idempotency_key, request_digest,
        trace_id, queued_at, started_at, created_at, updated_at
      ) VALUES
        (
          'job-legacy-queued', 'batch-v5p2', 'queued', 0, 'legacy-queued',
          repeat('a', 64), 'trace-queued', now(), NULL, now(), now()
        ),
        (
          'job-legacy-running', 'batch-v5p2', 'running', 35, 'legacy-running',
          repeat('b', 64), 'trace-running', now(), now(), now(), now()
        )
    `);

    const firstRun = await runMigrations(client);
    const secondRun = await runMigrations(client);
    const jobs = await client.pool.query<{
      id: string;
      status: string;
      requestVersion: number;
      requestPayload: { legacy: boolean };
      errorCode: string;
      errorRetryable: boolean;
    }>(`
      SELECT id, status::text AS status,
        request_version AS "requestVersion",
        request_payload AS "requestPayload",
        error_code AS "errorCode",
        error_retryable AS "errorRetryable"
      FROM schedule_jobs
      ORDER BY id
    `);

    assert.deepEqual(firstRun.map((migration) => migration.id), [
      "0012_reliable_schedule_jobs",
      "0013_constraint_profiles",
      "0014_user_audience_scopes",
    ]);
    assert.deepEqual(secondRun, []);
    assert.deepEqual(jobs.rows.map((job) => ({
      id: job.id,
      status: job.status,
      requestVersion: job.requestVersion,
      requestPayload: job.requestPayload,
      errorCode: job.errorCode,
      errorRetryable: job.errorRetryable,
    })), [
      {
        id: "job-legacy-queued",
        status: "failed",
        requestVersion: 0,
        requestPayload: { legacy: true },
        errorCode: "legacy_active_job_not_recoverable",
        errorRetryable: false,
      },
      {
        id: "job-legacy-running",
        status: "failed",
        requestVersion: 0,
        requestPayload: { legacy: true },
        errorCode: "legacy_active_job_not_recoverable",
        errorRetryable: false,
      },
    ]);
  });

  it("creates one immutable default strategy and preserves explicit legacy snapshots", async () => {
    assert.ok(client);
    await applyMigrationsThrough(client, "0012_reliable_schedule_jobs");
    await seedDemoData(client);
    await client.pool.query(`
      INSERT INTO schedule_jobs (
        id, batch_id, status, progress, idempotency_key, request_digest,
        request_version, request_payload, trace_id, queued_at, created_at, updated_at
      ) VALUES (
        'job-before-profiles', 'batch-2026-spring-final', 'succeeded', 100,
        'before-profiles', repeat('d', 64), 1,
        '{"version":1,"input":{}}'::jsonb,
        'trace-before-profiles', now(), now(), now()
      );
      INSERT INTO schedule_runs (
        id, batch_id, status, score, score_breakdown, conflict_count,
        assignment_count, elapsed_ms, statistics, report
      ) VALUES (
        'run-before-profiles', 'batch-2026-spring-final', 'feasible', 100,
        '{"total_score":100,"soft_penalty_items":[]}'::jsonb,
        0, 0, 1, '{"status":"feasible"}'::jsonb, '{}'::jsonb
      )
    `);

    const firstRun = await runMigrations(client);
    const secondRun = await runMigrations(client);
    const defaultProfile = await client.pool.query<{
      profileId: string;
      status: string;
      currentVersionId: string;
      versionId: string;
      versionNumber: number;
      schemaVersion: number;
      digest: string;
      config: typeof demoScheduleInput.constraint_profile;
    }>(`
      SELECT
        profile.id AS "profileId",
        profile.status,
        profile.current_version_id AS "currentVersionId",
        version.id AS "versionId",
        version.version_number AS "versionNumber",
        version.schema_version AS "schemaVersion",
        version.digest,
        version.config
      FROM constraint_profiles AS profile
      JOIN constraint_profile_versions AS version
        ON version.id = profile.current_version_id
        AND version.profile_id = profile.id
      WHERE profile.is_default
    `);
    const legacyJob = await client.pool.query<{
      constraintProfileVersionId: string | null;
      constraintProfileSnapshot: Record<string, unknown>;
    }>(`
      SELECT
        constraint_profile_version_id AS "constraintProfileVersionId",
        constraint_profile_snapshot AS "constraintProfileSnapshot"
      FROM schedule_jobs
      WHERE id = 'job-before-profiles'
    `);
    const legacyRun = await client.pool.query<{
      constraintProfileVersionId: string | null;
      constraintProfileSnapshot: Record<string, unknown>;
      schedulerVersion: string;
      scoringContractVersion: number;
      normalizedScore: string | null;
    }>(`
      SELECT
        constraint_profile_version_id AS "constraintProfileVersionId",
        constraint_profile_snapshot AS "constraintProfileSnapshot",
        scheduler_version AS "schedulerVersion",
        scoring_contract_version AS "scoringContractVersion",
        normalized_score::text AS "normalizedScore"
      FROM schedule_runs
      WHERE id = 'run-before-profiles'
    `);

    assert.deepEqual(firstRun.map((migration) => migration.id), [
      "0013_constraint_profiles",
      "0014_user_audience_scopes",
    ]);
    assert.deepEqual(secondRun, []);
    assert.equal(defaultProfile.rows.length, 1);
    assert.deepEqual(defaultProfile.rows[0], {
      profileId: "constraint-profile-default",
      status: "active",
      currentVersionId: "constraint-profile-default-v1",
      versionId: "constraint-profile-default-v1",
      versionNumber: 1,
      schemaVersion: 1,
      digest: defaultProfile.rows[0]?.digest,
      config: demoScheduleInput.constraint_profile,
    });
    assert.match(defaultProfile.rows[0]?.digest ?? "", /^[a-f0-9]{64}$/);
    assert.deepEqual(legacyJob.rows[0], {
      constraintProfileVersionId: null,
      constraintProfileSnapshot: {
        schemaVersion: 0,
        legacy: true,
        provenance: "migrated_from_batch_constraint_profile",
        config: demoScheduleInput.constraint_profile,
      },
    });
    assert.deepEqual(legacyRun.rows[0], {
      constraintProfileVersionId: null,
      constraintProfileSnapshot: {
        schemaVersion: 0,
        legacy: true,
        provenance: "migrated_from_batch_constraint_profile",
        config: demoScheduleInput.constraint_profile,
      },
      schedulerVersion: "legacy",
      scoringContractVersion: 0,
      normalizedScore: null,
    });

    await assert.rejects(
      client.pool.query(`
        UPDATE constraint_profile_versions
        SET config = jsonb_set(config, '{time_limit_seconds}', '20'::jsonb)
        WHERE id = 'constraint-profile-default-v1'
      `),
      /constraint profile versions are immutable/,
    );

    await client.pool.query("BEGIN");
    try {
      await client.pool.query(`
        INSERT INTO constraint_profiles (
          id, name, status, current_version_id, is_default
        ) VALUES (
          'constraint-profile-secondary', 'Secondary profile', 'active',
          'constraint-profile-secondary-v1', false
        )
      `);
      await client.pool.query(`
        INSERT INTO constraint_profile_versions (
          id, profile_id, version_number, schema_version, digest, config
        ) VALUES (
          'constraint-profile-secondary-v1', 'constraint-profile-secondary', 1, 1,
          repeat('e', 64), $1::jsonb
        )
      `, [JSON.stringify(demoScheduleInput.constraint_profile)]);
      await client.pool.query("COMMIT");
    } catch (error) {
      await client.pool.query("ROLLBACK");
      throw error;
    }
    await assert.rejects(
      client.pool.query(`
        UPDATE constraint_profiles
        SET is_default = true
        WHERE id = 'constraint-profile-secondary'
      `),
      /constraint_profiles_one_default_idx/,
    );
    await assert.rejects(
      client.pool.query(`
        INSERT INTO constraint_profile_versions (
          id, profile_id, version_number, schema_version, digest, config
        ) VALUES (
          'constraint-profile-secondary-duplicate-v1',
          'constraint-profile-secondary', 1, 1, repeat('f', 64), $1::jsonb
        )
      `, [JSON.stringify(demoScheduleInput.constraint_profile)]),
      /constraint_profile_versions_profile_version_unique/,
    );
    await assert.rejects(
      client.pool.query(`
        UPDATE constraint_profiles
        SET current_version_id = 'constraint-profile-default-v1'
        WHERE id = 'constraint-profile-secondary'
      `),
      /constraint_profiles_current_version_fk/,
    );
  });

  it("assigns a strict event sequence even when timestamps are equal", async () => {
    assert.ok(client);
    await runMigrations(client);
    await seedDemoData(client);
    await client.pool.query(`
      INSERT INTO schedule_jobs (
        id, batch_id, status, progress, idempotency_key, request_digest,
        request_version, request_payload, constraint_profile_version_id,
        constraint_profile_snapshot, trace_id, queued_at, created_at, updated_at
      ) SELECT
        'job-event-sequence', 'batch-2026-spring-final', 'queued', 0,
        'event-sequence', repeat('c', 64), 1,
        '{"version":1,"input":{}}'::jsonb,
        'constraint-profile-default-v1',
        jsonb_build_object(
          'schemaVersion', version.schema_version,
          'profileId', version.profile_id,
          'profileVersionId', version.id,
          'versionNumber', version.version_number,
          'digest', version.digest,
          'config', version.config
        ),
        'trace-event-sequence', now(), now(), now()
      FROM constraint_profile_versions AS version
      WHERE version.id = 'constraint-profile-default-v1';
      INSERT INTO schedule_job_events (
        id, job_id, event_type, event_version, occurred_at, payload, trace_id
      ) VALUES
        (
          'event-sequence-1', 'job-event-sequence', 'schedule_job.queued', 1,
          '2026-07-13T08:00:00Z', '{}'::jsonb, 'trace-event-sequence'
        ),
        (
          'event-sequence-2', 'job-event-sequence', 'schedule_job.attempt_started', 1,
          '2026-07-13T08:00:00Z', '{}'::jsonb, 'trace-event-sequence'
        )
    `);
    const events = await client.pool.query<{ id: string; sequence: string }>(`
      SELECT id, sequence::text AS sequence
      FROM schedule_job_events
      WHERE job_id = 'job-event-sequence'
      ORDER BY sequence
    `);

    assert.deepEqual(events.rows.map((event) => event.id), [
      "event-sequence-1",
      "event-sequence-2",
    ]);
    assert.ok(BigInt(events.rows[1].sequence) > BigInt(events.rows[0].sequence));
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
