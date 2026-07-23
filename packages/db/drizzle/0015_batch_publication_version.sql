ALTER TABLE exam_batches
ADD COLUMN IF NOT EXISTS publication_version integer NOT NULL DEFAULT 0;
