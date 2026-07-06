CREATE TYPE draft_status AS ENUM ('editing', 'validated', 'blocked', 'published', 'discarded');

CREATE TABLE IF NOT EXISTS schedule_drafts (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  source_run_id text NOT NULL,
  base_published_run_id text,
  status draft_status NOT NULL,
  score integer NOT NULL,
  conflict_count integer NOT NULL,
  assignment_count integer NOT NULL,
  created_by text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS draft_scheduled_exams (
  id text PRIMARY KEY,
  draft_id text NOT NULL,
  exam_task_id text NOT NULL,
  room_id text NOT NULL,
  time_slot_id text NOT NULL,
  teacher_ids jsonb NOT NULL,
  locked boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS draft_conflict_records (
  id text PRIMARY KEY,
  draft_id text NOT NULL,
  type text NOT NULL,
  severity conflict_severity NOT NULL,
  affected_ids jsonb NOT NULL,
  message text NOT NULL,
  suggestion text NOT NULL
);

CREATE TABLE IF NOT EXISTS draft_change_events (
  id text PRIMARY KEY,
  draft_id text NOT NULL,
  exam_task_id text NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  actor text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
