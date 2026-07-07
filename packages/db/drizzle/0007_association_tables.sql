CREATE TABLE IF NOT EXISTS exam_task_student_groups (
  exam_task_id text NOT NULL REFERENCES exam_tasks(id) ON DELETE CASCADE,
  student_group_id text NOT NULL REFERENCES student_groups(id),
  PRIMARY KEY (exam_task_id, student_group_id)
);

INSERT INTO exam_task_student_groups (exam_task_id, student_group_id)
SELECT exam_tasks.id, student_group_id.value
FROM exam_tasks
CROSS JOIN LATERAL jsonb_array_elements_text(exam_tasks.student_group_ids) AS student_group_id(value)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS scheduled_exam_invigilators (
  scheduled_exam_id text NOT NULL REFERENCES scheduled_exams(id) ON DELETE CASCADE,
  position integer NOT NULL,
  teacher_id text NOT NULL REFERENCES teachers(id),
  PRIMARY KEY (scheduled_exam_id, position)
);

INSERT INTO scheduled_exam_invigilators (scheduled_exam_id, position, teacher_id)
SELECT scheduled_exams.id, teacher_id.position::integer, teacher_id.value
FROM scheduled_exams
CROSS JOIN LATERAL jsonb_array_elements_text(scheduled_exams.teacher_ids) WITH ORDINALITY AS teacher_id(value, position)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS draft_exam_invigilators (
  draft_scheduled_exam_id text NOT NULL REFERENCES draft_scheduled_exams(id) ON DELETE CASCADE,
  position integer NOT NULL,
  teacher_id text NOT NULL REFERENCES teachers(id),
  PRIMARY KEY (draft_scheduled_exam_id, position)
);

INSERT INTO draft_exam_invigilators (draft_scheduled_exam_id, position, teacher_id)
SELECT draft_scheduled_exams.id, teacher_id.position::integer, teacher_id.value
FROM draft_scheduled_exams
CROSS JOIN LATERAL jsonb_array_elements_text(draft_scheduled_exams.teacher_ids) WITH ORDINALITY AS teacher_id(value, position)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS teacher_unavailable_slots (
  teacher_id text NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  time_slot_id text NOT NULL REFERENCES time_slots(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_id, time_slot_id)
);

INSERT INTO teacher_unavailable_slots (teacher_id, time_slot_id)
SELECT teachers.id, time_slot_id.value
FROM teachers
CROSS JOIN LATERAL jsonb_array_elements_text(teachers.unavailable_slot_ids) AS time_slot_id(value)
ON CONFLICT DO NOTHING;
