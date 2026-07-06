CREATE TYPE schedule_job_status AS ENUM ('queued', 'running', 'completed', 'failed');

CREATE TABLE IF NOT EXISTS schedule_jobs (
  id text PRIMARY KEY,
  status schedule_job_status NOT NULL,
  progress integer NOT NULL,
  run_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_jobs_progress_range CHECK (progress >= 0 AND progress <= 100)
);

ALTER TABLE student_groups
  ADD CONSTRAINT student_groups_department_id_fk
  FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE teachers
  ADD CONSTRAINT teachers_department_id_fk
  FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE courses
  ADD CONSTRAINT courses_department_id_fk
  FOREIGN KEY (department_id) REFERENCES departments(id);

ALTER TABLE time_slots
  ADD CONSTRAINT time_slots_batch_id_fk
  FOREIGN KEY (batch_id) REFERENCES exam_batches(id) ON DELETE CASCADE;

ALTER TABLE time_slots
  ADD CONSTRAINT time_slots_batch_period_unique
  UNIQUE (batch_id, period_index);

ALTER TABLE exam_tasks
  ADD CONSTRAINT exam_tasks_batch_id_fk
  FOREIGN KEY (batch_id) REFERENCES exam_batches(id) ON DELETE CASCADE;

ALTER TABLE exam_tasks
  ADD CONSTRAINT exam_tasks_course_id_fk
  FOREIGN KEY (course_id) REFERENCES courses(id);

ALTER TABLE schedule_runs
  ADD CONSTRAINT schedule_runs_batch_id_fk
  FOREIGN KEY (batch_id) REFERENCES exam_batches(id) ON DELETE CASCADE;

ALTER TABLE scheduled_exams
  ADD CONSTRAINT scheduled_exams_run_id_fk
  FOREIGN KEY (run_id) REFERENCES schedule_runs(id) ON DELETE CASCADE;

ALTER TABLE scheduled_exams
  ADD CONSTRAINT scheduled_exams_exam_task_id_fk
  FOREIGN KEY (exam_task_id) REFERENCES exam_tasks(id);

ALTER TABLE scheduled_exams
  ADD CONSTRAINT scheduled_exams_room_id_fk
  FOREIGN KEY (room_id) REFERENCES rooms(id);

ALTER TABLE scheduled_exams
  ADD CONSTRAINT scheduled_exams_time_slot_id_fk
  FOREIGN KEY (time_slot_id) REFERENCES time_slots(id);

ALTER TABLE scheduled_exams
  ADD CONSTRAINT scheduled_exams_run_exam_task_unique
  UNIQUE (run_id, exam_task_id);

ALTER TABLE scheduled_exams
  ADD CONSTRAINT scheduled_exams_run_room_slot_unique
  UNIQUE (run_id, room_id, time_slot_id);

ALTER TABLE conflict_records
  ADD CONSTRAINT conflict_records_run_id_fk
  FOREIGN KEY (run_id) REFERENCES schedule_runs(id) ON DELETE CASCADE;

ALTER TABLE schedule_drafts
  ADD CONSTRAINT schedule_drafts_batch_id_fk
  FOREIGN KEY (batch_id) REFERENCES exam_batches(id) ON DELETE CASCADE;

ALTER TABLE schedule_drafts
  ADD CONSTRAINT schedule_drafts_source_run_id_fk
  FOREIGN KEY (source_run_id) REFERENCES schedule_runs(id);

ALTER TABLE schedule_drafts
  ADD CONSTRAINT schedule_drafts_base_published_run_id_fk
  FOREIGN KEY (base_published_run_id) REFERENCES schedule_runs(id);

ALTER TABLE draft_scheduled_exams
  ADD CONSTRAINT draft_scheduled_exams_draft_id_fk
  FOREIGN KEY (draft_id) REFERENCES schedule_drafts(id) ON DELETE CASCADE;

ALTER TABLE draft_scheduled_exams
  ADD CONSTRAINT draft_scheduled_exams_exam_task_id_fk
  FOREIGN KEY (exam_task_id) REFERENCES exam_tasks(id);

ALTER TABLE draft_scheduled_exams
  ADD CONSTRAINT draft_scheduled_exams_room_id_fk
  FOREIGN KEY (room_id) REFERENCES rooms(id);

ALTER TABLE draft_scheduled_exams
  ADD CONSTRAINT draft_scheduled_exams_time_slot_id_fk
  FOREIGN KEY (time_slot_id) REFERENCES time_slots(id);

ALTER TABLE draft_scheduled_exams
  ADD CONSTRAINT draft_scheduled_exams_draft_exam_task_unique
  UNIQUE (draft_id, exam_task_id);

ALTER TABLE draft_scheduled_exams
  ADD CONSTRAINT draft_scheduled_exams_draft_room_slot_unique
  UNIQUE (draft_id, room_id, time_slot_id);

ALTER TABLE draft_conflict_records
  ADD CONSTRAINT draft_conflict_records_draft_id_fk
  FOREIGN KEY (draft_id) REFERENCES schedule_drafts(id) ON DELETE CASCADE;

ALTER TABLE draft_change_events
  ADD CONSTRAINT draft_change_events_draft_id_fk
  FOREIGN KEY (draft_id) REFERENCES schedule_drafts(id) ON DELETE CASCADE;

ALTER TABLE draft_change_events
  ADD CONSTRAINT draft_change_events_exam_task_id_fk
  FOREIGN KEY (exam_task_id) REFERENCES exam_tasks(id);

ALTER TABLE schedule_jobs
  ADD CONSTRAINT schedule_jobs_run_id_fk
  FOREIGN KEY (run_id) REFERENCES schedule_runs(id) ON DELETE SET NULL;
