CREATE TYPE batch_status AS ENUM ('draft', 'ready', 'scheduled', 'published');
CREATE TYPE exam_type AS ENUM ('written', 'computer', 'oral');
CREATE TYPE room_type AS ENUM ('standard', 'computer_lab', 'language_lab');
CREATE TYPE run_status AS ENUM ('feasible', 'partial', 'infeasible', 'error');
CREATE TYPE conflict_severity AS ENUM ('error', 'warning');

CREATE TABLE exam_batches (
  id text PRIMARY KEY,
  name text NOT NULL,
  status batch_status NOT NULL DEFAULT 'draft',
  start_date text NOT NULL,
  end_date text NOT NULL,
  constraint_profile jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE departments (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE student_groups (
  id text PRIMARY KEY,
  name text NOT NULL,
  size integer NOT NULL,
  department_id text NOT NULL
);

CREATE TABLE teachers (
  id text PRIMARY KEY,
  name text NOT NULL,
  department_id text NOT NULL,
  unavailable_slot_ids jsonb NOT NULL
);

CREATE TABLE courses (
  id text PRIMARY KEY,
  name text NOT NULL,
  department_id text NOT NULL,
  exam_type exam_type NOT NULL
);

CREATE TABLE rooms (
  id text PRIMARY KEY,
  name text NOT NULL,
  building_id text NOT NULL,
  capacity integer NOT NULL,
  room_type room_type NOT NULL,
  equipment_tags jsonb NOT NULL
);

CREATE TABLE time_slots (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  date text NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  period_index integer NOT NULL
);

CREATE TABLE exam_tasks (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  course_id text NOT NULL,
  student_group_ids jsonb NOT NULL,
  expected_count integer NOT NULL,
  duration_minutes integer NOT NULL,
  required_room_type room_type NOT NULL,
  required_equipment_tags jsonb NOT NULL,
  allowed_slot_ids jsonb NOT NULL,
  invigilator_count integer NOT NULL
);

CREATE TABLE schedule_runs (
  id text PRIMARY KEY,
  batch_id text NOT NULL,
  status run_status NOT NULL,
  score integer NOT NULL,
  conflict_count integer NOT NULL,
  assignment_count integer NOT NULL,
  elapsed_ms integer NOT NULL,
  statistics jsonb NOT NULL,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scheduled_exams (
  id text PRIMARY KEY,
  run_id text NOT NULL,
  exam_task_id text NOT NULL,
  room_id text NOT NULL,
  time_slot_id text NOT NULL,
  teacher_ids jsonb NOT NULL
);

CREATE TABLE conflict_records (
  id text PRIMARY KEY,
  run_id text NOT NULL,
  type text NOT NULL,
  severity conflict_severity NOT NULL,
  affected_ids jsonb NOT NULL,
  message text NOT NULL,
  suggestion text NOT NULL
);

CREATE TABLE audit_events (
  id text PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
