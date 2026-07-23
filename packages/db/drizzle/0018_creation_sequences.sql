ALTER TABLE schedule_runs
  ADD COLUMN created_sequence bigint GENERATED ALWAYS AS IDENTITY;

ALTER TABLE schedule_runs
  ADD CONSTRAINT schedule_runs_created_sequence_unique UNIQUE (created_sequence);

ALTER TABLE audit_events
  ADD COLUMN created_sequence bigint GENERATED ALWAYS AS IDENTITY;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_created_sequence_unique UNIQUE (created_sequence);

ALTER TABLE schedule_jobs
  ADD COLUMN created_sequence bigint GENERATED ALWAYS AS IDENTITY;

ALTER TABLE schedule_jobs
  ADD CONSTRAINT schedule_jobs_created_sequence_unique UNIQUE (created_sequence);
