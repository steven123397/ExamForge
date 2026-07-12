ALTER TABLE schedule_jobs
  ADD COLUMN batch_id text,
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_digest text,
  ADD COLUMN trace_id text,
  ADD COLUMN error_category text,
  ADD COLUMN error_code text,
  ADD COLUMN error_retryable boolean,
  ADD COLUMN cancellation_requested_at timestamptz,
  ADD COLUMN queued_at timestamptz,
  ADD COLUMN started_at timestamptz,
  ADD COLUMN finished_at timestamptz;

UPDATE schedule_jobs
SET batch_id = (SELECT id FROM exam_batches ORDER BY created_at, id LIMIT 1),
  idempotency_key = 'legacy:' || id,
  request_digest = md5(id) || md5(id),
  trace_id = 'legacy:' || id,
  error_category = CASE WHEN error IS NULL THEN NULL ELSE 'unknown' END,
  error_code = CASE WHEN error IS NULL THEN NULL ELSE 'legacy_error' END,
  error_retryable = CASE WHEN error IS NULL THEN NULL ELSE false END,
  queued_at = created_at,
  started_at = CASE WHEN status IN ('running', 'succeeded', 'failed') THEN updated_at ELSE NULL END,
  finished_at = CASE WHEN status IN ('succeeded', 'failed', 'cancelled', 'timed_out') THEN updated_at ELSE NULL END;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM schedule_jobs WHERE batch_id IS NULL) THEN
    RAISE EXCEPTION 'cannot assign legacy schedule jobs to an exam batch';
  END IF;
END
$$;

ALTER TABLE schedule_jobs
  ALTER COLUMN batch_id SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN request_digest SET NOT NULL,
  ALTER COLUMN trace_id SET NOT NULL,
  ALTER COLUMN queued_at SET NOT NULL,
  ADD CONSTRAINT schedule_jobs_batch_id_fk
    FOREIGN KEY (batch_id) REFERENCES exam_batches(id) ON DELETE RESTRICT,
  ADD CONSTRAINT schedule_jobs_idempotency_key_unique UNIQUE (idempotency_key),
  ADD CONSTRAINT schedule_jobs_error_shape CHECK (
    (error IS NULL AND error_category IS NULL AND error_code IS NULL AND error_retryable IS NULL)
    OR
    (error IS NOT NULL AND error_category IS NOT NULL AND error_code IS NOT NULL AND error_retryable IS NOT NULL)
  );

CREATE INDEX schedule_jobs_batch_created_at_idx ON schedule_jobs (batch_id, created_at);
CREATE INDEX schedule_jobs_status_updated_at_idx ON schedule_jobs (status, updated_at);

CREATE TABLE schedule_job_attempts (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  attempt_number integer NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error jsonb,
  CONSTRAINT schedule_job_attempts_job_id_fk
    FOREIGN KEY (job_id) REFERENCES schedule_jobs(id) ON DELETE CASCADE,
  CONSTRAINT schedule_job_attempts_job_attempt_unique UNIQUE (job_id, attempt_number),
  CONSTRAINT schedule_job_attempts_number_positive CHECK (attempt_number > 0)
);

CREATE TABLE schedule_job_events (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  trace_id text NOT NULL,
  CONSTRAINT schedule_job_events_job_id_fk
    FOREIGN KEY (job_id) REFERENCES schedule_jobs(id) ON DELETE CASCADE,
  CONSTRAINT schedule_job_events_version_positive CHECK (event_version > 0)
);

CREATE INDEX schedule_job_events_job_occurred_at_idx
  ON schedule_job_events (job_id, occurred_at);

CREATE TABLE outbox_events (
  id text PRIMARY KEY,
  event_id text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_events_event_id_fk
    FOREIGN KEY (event_id) REFERENCES schedule_job_events(id) ON DELETE CASCADE,
  CONSTRAINT outbox_events_event_id_unique UNIQUE (event_id),
  CONSTRAINT outbox_events_attempt_count_nonnegative CHECK (attempt_count >= 0)
);

CREATE INDEX outbox_events_pending_idx ON outbox_events (published_at, available_at);
