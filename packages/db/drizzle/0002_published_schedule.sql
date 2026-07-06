ALTER TABLE exam_batches
ADD COLUMN IF NOT EXISTS published_run_id text;
