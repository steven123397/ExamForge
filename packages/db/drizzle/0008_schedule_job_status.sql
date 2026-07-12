ALTER TYPE schedule_job_status RENAME TO schedule_job_status_v4;

CREATE TYPE schedule_job_status AS ENUM (
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out'
);

ALTER TABLE schedule_jobs
  ALTER COLUMN status TYPE schedule_job_status
  USING (
    CASE status::text
      WHEN 'completed' THEN 'succeeded'
      ELSE status::text
    END
  )::schedule_job_status;

DROP TYPE schedule_job_status_v4;
