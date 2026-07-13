ALTER TABLE schedule_jobs
  ADD COLUMN request_version integer,
  ADD COLUMN request_payload jsonb;

UPDATE schedule_jobs
SET request_version = 0,
  request_payload = '{"legacy":true}'::jsonb;

UPDATE schedule_jobs
SET status = 'failed',
  progress = 100,
  error = 'Legacy active job cannot be recovered without a request snapshot.',
  error_category = 'infrastructure',
  error_code = 'legacy_active_job_not_recoverable',
  error_retryable = false,
  finished_at = COALESCE(finished_at, now()),
  updated_at = now()
WHERE status IN ('queued', 'running');

ALTER TABLE schedule_jobs
  ALTER COLUMN request_version SET NOT NULL,
  ALTER COLUMN request_payload SET NOT NULL,
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
  );

ALTER TABLE schedule_job_attempts
  ADD COLUMN scheduler_request_id text,
  ADD COLUMN duration_ms integer;

UPDATE schedule_job_attempts
SET status = CASE status
    WHEN 'running' THEN 'started'
    ELSE status
  END,
  scheduler_request_id = 'legacy:' || id,
  duration_ms = CASE
    WHEN finished_at IS NULL THEN NULL
    ELSE GREATEST(
      0,
      floor(EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000)::integer
    )
  END;

ALTER TABLE schedule_job_attempts
  ALTER COLUMN scheduler_request_id SET NOT NULL,
  ADD CONSTRAINT schedule_job_attempts_status_check CHECK (
    status IN ('started', 'succeeded', 'failed', 'timed_out', 'cancelled')
  ),
  ADD CONSTRAINT schedule_job_attempts_duration_nonnegative CHECK (
    duration_ms IS NULL OR duration_ms >= 0
  ),
  ADD CONSTRAINT schedule_job_attempts_timing_check CHECK (
    (status = 'started' AND finished_at IS NULL AND duration_ms IS NULL)
    OR
    (status <> 'started' AND finished_at IS NOT NULL AND duration_ms IS NOT NULL)
  );

ALTER TABLE schedule_job_events
  ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY;

ALTER TABLE schedule_job_events
  ADD CONSTRAINT schedule_job_events_sequence_unique UNIQUE (sequence);

CREATE INDEX schedule_job_events_job_sequence_idx
  ON schedule_job_events (job_id, sequence);
