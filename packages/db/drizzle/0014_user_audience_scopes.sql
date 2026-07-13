CREATE TABLE user_teacher_scopes (
  user_id text NOT NULL,
  teacher_id text NOT NULL,
  CONSTRAINT user_teacher_scopes_pk PRIMARY KEY (user_id),
  CONSTRAINT user_teacher_scopes_teacher_id_unique UNIQUE (teacher_id),
  CONSTRAINT user_teacher_scopes_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_teacher_scopes_teacher_id_fk
    FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE RESTRICT
);

CREATE TABLE user_student_group_scopes (
  user_id text NOT NULL,
  student_group_id text NOT NULL,
  CONSTRAINT user_student_group_scopes_pk PRIMARY KEY (user_id, student_group_id),
  CONSTRAINT user_student_group_scopes_user_id_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_student_group_scopes_student_group_id_fk
    FOREIGN KEY (student_group_id) REFERENCES student_groups(id) ON DELETE RESTRICT
);

INSERT INTO user_teacher_scopes (user_id, teacher_id)
SELECT app_user.id, teacher.id
FROM users AS app_user
JOIN teachers AS teacher ON teacher.id = 't-zhang'
WHERE app_user.username = 'teacher'
ON CONFLICT DO NOTHING;

INSERT INTO user_student_group_scopes (user_id, student_group_id)
SELECT app_user.id, student_group.id
FROM users AS app_user
JOIN student_groups AS student_group ON student_group.id = 'g-cs-2301'
WHERE app_user.username = 'student'
ON CONFLICT DO NOTHING;
