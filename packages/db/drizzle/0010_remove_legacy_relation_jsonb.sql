DO $$
BEGIN
  IF EXISTS (
    WITH expected AS (
      SELECT task.id AS exam_task_id, group_id.value AS student_group_id
      FROM exam_tasks AS task
      CROSS JOIN LATERAL jsonb_array_elements_text(task.student_group_ids) AS group_id(value)
    ), mismatches AS (
      (SELECT * FROM expected EXCEPT SELECT exam_task_id, student_group_id FROM exam_task_student_groups)
      UNION ALL
      (SELECT exam_task_id, student_group_id FROM exam_task_student_groups EXCEPT SELECT * FROM expected)
    )
    SELECT 1 FROM mismatches
  ) THEN
    RAISE EXCEPTION 'association drift: exam_task_student_groups';
  END IF;

  IF EXISTS (
    WITH expected AS (
      SELECT exam.id AS scheduled_exam_id,
        teacher_id.position::integer AS position,
        teacher_id.value AS teacher_id
      FROM scheduled_exams AS exam
      CROSS JOIN LATERAL jsonb_array_elements_text(exam.teacher_ids)
        WITH ORDINALITY AS teacher_id(value, position)
    ), mismatches AS (
      (SELECT * FROM expected EXCEPT SELECT scheduled_exam_id, position, teacher_id FROM scheduled_exam_invigilators)
      UNION ALL
      (SELECT scheduled_exam_id, position, teacher_id FROM scheduled_exam_invigilators EXCEPT SELECT * FROM expected)
    )
    SELECT 1 FROM mismatches
  ) THEN
    RAISE EXCEPTION 'association drift: scheduled_exam_invigilators';
  END IF;

  IF EXISTS (
    WITH expected AS (
      SELECT exam.id AS draft_scheduled_exam_id,
        teacher_id.position::integer AS position,
        teacher_id.value AS teacher_id
      FROM draft_scheduled_exams AS exam
      CROSS JOIN LATERAL jsonb_array_elements_text(exam.teacher_ids)
        WITH ORDINALITY AS teacher_id(value, position)
    ), mismatches AS (
      (SELECT * FROM expected EXCEPT SELECT draft_scheduled_exam_id, position, teacher_id FROM draft_exam_invigilators)
      UNION ALL
      (SELECT draft_scheduled_exam_id, position, teacher_id FROM draft_exam_invigilators EXCEPT SELECT * FROM expected)
    )
    SELECT 1 FROM mismatches
  ) THEN
    RAISE EXCEPTION 'association drift: draft_exam_invigilators';
  END IF;

  IF EXISTS (
    WITH expected AS (
      SELECT teacher.id AS teacher_id, slot_id.value AS time_slot_id
      FROM teachers AS teacher
      CROSS JOIN LATERAL jsonb_array_elements_text(teacher.unavailable_slot_ids) AS slot_id(value)
    ), mismatches AS (
      (SELECT * FROM expected EXCEPT SELECT teacher_id, time_slot_id FROM teacher_unavailable_slots)
      UNION ALL
      (SELECT teacher_id, time_slot_id FROM teacher_unavailable_slots EXCEPT SELECT * FROM expected)
    )
    SELECT 1 FROM mismatches
  ) THEN
    RAISE EXCEPTION 'association drift: teacher_unavailable_slots';
  END IF;
END
$$;

ALTER TABLE exam_tasks DROP COLUMN student_group_ids;
ALTER TABLE scheduled_exams DROP COLUMN teacher_ids;
ALTER TABLE draft_scheduled_exams DROP COLUMN teacher_ids;
ALTER TABLE teachers DROP COLUMN unavailable_slot_ids;
