ALTER TABLE draft_scheduled_exams
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
