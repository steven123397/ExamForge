CREATE TABLE constraint_profiles (
  id text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  owner_user_id text,
  current_version_id text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT constraint_profiles_status_check
    CHECK (status IN ('active', 'disabled')),
  CONSTRAINT constraint_profiles_owner_user_id_fk
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE constraint_profile_versions (
  id text PRIMARY KEY,
  profile_id text NOT NULL,
  version_number integer NOT NULL,
  schema_version integer NOT NULL,
  digest text NOT NULL,
  config jsonb NOT NULL,
  created_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT constraint_profile_versions_profile_id_fk
    FOREIGN KEY (profile_id) REFERENCES constraint_profiles(id) ON DELETE RESTRICT,
  CONSTRAINT constraint_profile_versions_created_by_user_id_fk
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT constraint_profile_versions_profile_version_unique
    UNIQUE (profile_id, version_number),
  CONSTRAINT constraint_profile_versions_id_profile_unique
    UNIQUE (id, profile_id),
  CONSTRAINT constraint_profile_versions_version_number_positive
    CHECK (version_number > 0),
  CONSTRAINT constraint_profile_versions_schema_version_check
    CHECK (schema_version = 1),
  CONSTRAINT constraint_profile_versions_digest_check
    CHECK (digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT constraint_profile_versions_config_check
    CHECK (
      jsonb_typeof(config) = 'object'
      AND jsonb_typeof(config -> 'hard_rules') = 'array'
      AND jsonb_typeof(config -> 'soft_weights') = 'object'
      AND jsonb_typeof(config -> 'time_limit_seconds') = 'number'
      AND (config ->> 'time_limit_seconds')::integer > 0
    )
);

ALTER TABLE constraint_profiles
  ADD CONSTRAINT constraint_profiles_current_version_fk
  FOREIGN KEY (current_version_id, id)
  REFERENCES constraint_profile_versions(id, profile_id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX constraint_profiles_one_default_idx
  ON constraint_profiles (is_default)
  WHERE is_default;

CREATE OR REPLACE FUNCTION reject_constraint_profile_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'constraint profile versions are immutable';
END;
$$;

CREATE TRIGGER constraint_profile_versions_immutable
BEFORE UPDATE OR DELETE ON constraint_profile_versions
FOR EACH ROW
EXECUTE FUNCTION reject_constraint_profile_version_mutation();

INSERT INTO constraint_profiles (
  id,
  name,
  status,
  current_version_id,
  is_default
) VALUES (
  'constraint-profile-default',
  'Default scheduling strategy',
  'active',
  'constraint-profile-default-v1',
  true
);

INSERT INTO constraint_profile_versions (
  id,
  profile_id,
  version_number,
  schema_version,
  digest,
  config
) VALUES (
  'constraint-profile-default-v1',
  'constraint-profile-default',
  1,
  1,
  '39a0920fd0dfa8c22cac71e0b8bef5d1ae74dc5549cc93a569bc267d902723d9',
  '{
    "hard_rules": [
      "exam_single_room_slot",
      "room_time_unique",
      "student_group_no_overlap",
      "room_capacity",
      "room_requirement",
      "allowed_slot",
      "teacher_unavailable",
      "teacher_time_unique"
    ],
    "soft_weights": {
      "student_consecutive_exam": 8,
      "teacher_workload_balance": 7,
      "room_utilization": 3,
      "exam_distribution_balance": 5
    },
    "time_limit_seconds": 10
  }'::jsonb
);

ALTER TABLE schedule_jobs
  DROP CONSTRAINT schedule_jobs_request_snapshot_check,
  ADD CONSTRAINT schedule_jobs_request_snapshot_check CHECK (
    (
      request_version = 0
      AND request_payload = '{"legacy":true}'::jsonb
    )
    OR
    (
      request_version = 1
      AND request_payload ->> 'version' = '1'
      AND jsonb_typeof(request_payload -> 'input') = 'object'
    )
    OR
    (
      request_version = 2
      AND request_payload ->> 'version' = '2'
      AND jsonb_typeof(request_payload -> 'input') = 'object'
      AND jsonb_typeof(request_payload -> 'constraintProfile') = 'object'
    )
  );

ALTER TABLE schedule_jobs
  ADD COLUMN constraint_profile_version_id text,
  ADD COLUMN constraint_profile_snapshot jsonb,
  ADD COLUMN submitted_by text NOT NULL DEFAULT 'system',
  ADD COLUMN submitted_by_user_id text,
  ADD CONSTRAINT schedule_jobs_submitted_by_user_id_fk
    FOREIGN KEY (submitted_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

UPDATE schedule_jobs AS job
SET constraint_profile_snapshot = jsonb_build_object(
  'schemaVersion', 0,
  'legacy', true,
  'provenance', 'migrated_from_batch_constraint_profile',
  'config', batch.constraint_profile
)
FROM exam_batches AS batch
WHERE batch.id = job.batch_id;

ALTER TABLE schedule_jobs
  ALTER COLUMN constraint_profile_snapshot SET NOT NULL,
  ADD CONSTRAINT schedule_jobs_constraint_profile_version_id_fk
    FOREIGN KEY (constraint_profile_version_id)
    REFERENCES constraint_profile_versions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT schedule_jobs_constraint_profile_snapshot_check CHECK (
    (
      constraint_profile_version_id IS NULL
      AND constraint_profile_snapshot ->> 'schemaVersion' = '0'
      AND constraint_profile_snapshot ->> 'legacy' = 'true'
      AND constraint_profile_snapshot ->> 'provenance'
        = 'migrated_from_batch_constraint_profile'
      AND jsonb_typeof(constraint_profile_snapshot -> 'config') = 'object'
    )
    OR
    (
      constraint_profile_version_id IS NOT NULL
      AND constraint_profile_snapshot ->> 'schemaVersion' = '1'
      AND constraint_profile_snapshot ->> 'profileVersionId'
        = constraint_profile_version_id
      AND constraint_profile_snapshot ->> 'profileId' <> ''
      AND (constraint_profile_snapshot ->> 'versionNumber')::integer > 0
      AND constraint_profile_snapshot ->> 'digest' ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof(constraint_profile_snapshot -> 'config') = 'object'
    )
  );

ALTER TABLE schedule_runs
  ADD COLUMN constraint_profile_version_id text,
  ADD COLUMN constraint_profile_snapshot jsonb,
  ADD COLUMN scheduler_version text,
  ADD COLUMN scoring_contract_version integer,
  ADD COLUMN normalized_score numeric(5, 2);

UPDATE schedule_runs AS run
SET constraint_profile_snapshot = jsonb_build_object(
    'schemaVersion', 0,
    'legacy', true,
    'provenance', 'migrated_from_batch_constraint_profile',
    'config', batch.constraint_profile
  ),
  scheduler_version = 'legacy',
  scoring_contract_version = 0
FROM exam_batches AS batch
WHERE batch.id = run.batch_id;

ALTER TABLE schedule_runs
  ALTER COLUMN constraint_profile_snapshot SET NOT NULL,
  ALTER COLUMN scheduler_version SET NOT NULL,
  ALTER COLUMN scoring_contract_version SET NOT NULL,
  ADD CONSTRAINT schedule_runs_constraint_profile_version_id_fk
    FOREIGN KEY (constraint_profile_version_id)
    REFERENCES constraint_profile_versions(id) ON DELETE RESTRICT,
  ADD CONSTRAINT schedule_runs_scoring_contract_version_nonnegative
    CHECK (scoring_contract_version >= 0),
  ADD CONSTRAINT schedule_runs_normalized_score_range
    CHECK (normalized_score IS NULL OR normalized_score BETWEEN 0 AND 100),
  ADD CONSTRAINT schedule_runs_constraint_profile_snapshot_check CHECK (
    (
      constraint_profile_version_id IS NULL
      AND constraint_profile_snapshot ->> 'schemaVersion' = '0'
      AND constraint_profile_snapshot ->> 'legacy' = 'true'
      AND constraint_profile_snapshot ->> 'provenance'
        = 'migrated_from_batch_constraint_profile'
      AND jsonb_typeof(constraint_profile_snapshot -> 'config') = 'object'
      AND scheduler_version = 'legacy'
      AND scoring_contract_version = 0
      AND normalized_score IS NULL
    )
    OR
    (
      constraint_profile_version_id IS NOT NULL
      AND constraint_profile_snapshot ->> 'schemaVersion' = '1'
      AND constraint_profile_snapshot ->> 'profileVersionId'
        = constraint_profile_version_id
      AND constraint_profile_snapshot ->> 'profileId' <> ''
      AND (constraint_profile_snapshot ->> 'versionNumber')::integer > 0
      AND constraint_profile_snapshot ->> 'digest' ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof(constraint_profile_snapshot -> 'config') = 'object'
      AND scheduler_version <> ''
      AND scoring_contract_version > 0
      AND normalized_score IS NOT NULL
    )
  );
