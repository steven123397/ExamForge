-- 第六版第一阶段：批次级参与者模式、脱敏学生与考试报名。
-- 兼容口径：所有既有批次迁移为 groups_only / not_required / 0 / NULL，第五版语义不变。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'participant_mode') THEN
    CREATE TYPE participant_mode AS ENUM ('groups_only', 'enrollments');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'participant_data_status') THEN
    CREATE TYPE participant_data_status AS ENUM ('not_required', 'draft', 'complete');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'student_status') THEN
    CREATE TYPE student_status AS ENUM ('active', 'disabled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enrollment_source') THEN
    CREATE TYPE enrollment_source AS ENUM ('regular', 'elective', 'retake', 'other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enrollment_status') THEN
    CREATE TYPE enrollment_status AS ENUM ('active', 'withdrawn');
  END IF;
END
$$;

ALTER TABLE exam_batches
  ADD COLUMN IF NOT EXISTS participant_mode participant_mode NOT NULL DEFAULT 'groups_only',
  ADD COLUMN IF NOT EXISTS participant_data_status participant_data_status NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS participant_data_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS participant_data_digest text,
  ADD COLUMN IF NOT EXISTS participant_data_sealed_at timestamptz;

UPDATE exam_batches
SET
  participant_mode = 'groups_only',
  participant_data_status = 'not_required',
  participant_data_version = 0,
  participant_data_digest = NULL
WHERE participant_data_version IS NULL
   OR participant_data_status IS NULL
   OR participant_mode IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exam_batches_participant_data_version_check'
  ) THEN
    ALTER TABLE exam_batches
      ADD CONSTRAINT exam_batches_participant_data_version_check
      CHECK (participant_data_version >= 0);
  END IF;

  -- digest 只在 enrollment 数据被显式 seal 后存在，且必须是规范 SHA-256 十六进制串。
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exam_batches_participant_data_digest_check'
  ) THEN
    ALTER TABLE exam_batches
      ADD CONSTRAINT exam_batches_participant_data_digest_check
      CHECK (
        participant_data_digest IS NULL
        OR participant_data_digest ~ '^[a-f0-9]{64}$'
      );
  END IF;

  -- 状态与模式的组合边界：groups_only 永远是 not_required 且没有 digest；
  -- enrollment 只有 complete 才允许携带 digest。
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exam_batches_participant_state_check'
  ) THEN
    ALTER TABLE exam_batches
      ADD CONSTRAINT exam_batches_participant_state_check
      CHECK (
        (
          participant_mode = 'groups_only'
          AND participant_data_status = 'not_required'
          AND participant_data_digest IS NULL
        )
        OR (
          participant_mode = 'enrollments'
          AND participant_data_status IN ('draft', 'complete')
          AND (participant_data_status = 'complete') = (participant_data_digest IS NOT NULL)
        )
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS students (
  id text PRIMARY KEY,
  display_code text,
  primary_student_group_id text,
  status student_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_primary_student_group_id_fk'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_primary_student_group_id_fk
      FOREIGN KEY (primary_student_group_id)
      REFERENCES student_groups(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_display_code_unique'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_display_code_unique UNIQUE (display_code);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS students_primary_student_group_id_idx
  ON students (primary_student_group_id);

CREATE TABLE IF NOT EXISTS exam_enrollments (
  exam_task_id text NOT NULL,
  student_id text NOT NULL,
  source enrollment_source NOT NULL DEFAULT 'regular',
  status enrollment_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_enrollments_pkey PRIMARY KEY (exam_task_id, student_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exam_enrollments_exam_task_id_fk'
  ) THEN
    ALTER TABLE exam_enrollments
      ADD CONSTRAINT exam_enrollments_exam_task_id_fk
      FOREIGN KEY (exam_task_id) REFERENCES exam_tasks(id) ON DELETE CASCADE;
  END IF;

  -- 学生删除受限：历史报名是排考事实，不允许被静默清除。
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exam_enrollments_student_id_fk'
  ) THEN
    ALTER TABLE exam_enrollments
      ADD CONSTRAINT exam_enrollments_student_id_fk
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS exam_enrollments_student_id_idx
  ON exam_enrollments (student_id);

-- 运行追溯：同步排考与异步作业都必须持久化当时的参与者摘要（设计 §7.2、§8.3）。
ALTER TABLE schedule_runs
  ADD COLUMN IF NOT EXISTS participant_snapshot jsonb;

-- 作业请求快照 v3：历史 v0 / v1 / v2 保持原样可读，新作业必须携带参与者快照。
ALTER TABLE schedule_jobs
  DROP CONSTRAINT IF EXISTS schedule_jobs_request_snapshot_check;

ALTER TABLE schedule_jobs
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
    OR
    (
      request_version = 3
      AND request_payload ->> 'version' = '3'
      AND jsonb_typeof(request_payload -> 'input') = 'object'
      AND jsonb_typeof(request_payload -> 'constraintProfile') = 'object'
      AND jsonb_typeof(request_payload -> 'participantSnapshot') = 'object'
      AND request_payload -> 'participantSnapshot' ->> 'mode'
        IN ('groups_only', 'enrollments')
    )
  );

-- 有效报名是人数核对与 overlap edge 派生的唯一读路径。
CREATE INDEX IF NOT EXISTS exam_enrollments_active_exam_task_idx
  ON exam_enrollments (exam_task_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS exam_enrollments_active_student_idx
  ON exam_enrollments (student_id)
  WHERE status = 'active';
