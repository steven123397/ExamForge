ALTER TABLE schedule_runs
ADD COLUMN IF NOT EXISTS score_breakdown jsonb NOT NULL
DEFAULT '{"total_score":0,"hard_violation_count":0,"soft_penalty_items":[]}'::jsonb;
