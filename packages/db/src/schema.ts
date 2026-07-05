import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const batchStatus = pgEnum("batch_status", [
  "draft",
  "ready",
  "scheduled",
  "published",
]);

export const examType = pgEnum("exam_type", ["written", "computer", "oral"]);
export const roomType = pgEnum("room_type", [
  "standard",
  "computer_lab",
  "language_lab",
]);
export const runStatus = pgEnum("run_status", [
  "feasible",
  "partial",
  "infeasible",
  "error",
]);
export const conflictSeverity = pgEnum("conflict_severity", ["error", "warning"]);

export const examBatches = pgTable("exam_batches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: batchStatus("status").notNull().default("draft"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  constraintProfile: jsonb("constraint_profile").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const departments = pgTable("departments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const studentGroups = pgTable("student_groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  departmentId: text("department_id").notNull(),
});

export const teachers = pgTable("teachers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  departmentId: text("department_id").notNull(),
  unavailableSlotIds: jsonb("unavailable_slot_ids").$type<string[]>().notNull(),
});

export const courses = pgTable("courses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  departmentId: text("department_id").notNull(),
  type: examType("exam_type").notNull(),
});

export const rooms = pgTable("rooms", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  buildingId: text("building_id").notNull(),
  capacity: integer("capacity").notNull(),
  type: roomType("room_type").notNull(),
  equipmentTags: jsonb("equipment_tags").$type<string[]>().notNull(),
});

export const timeSlots = pgTable("time_slots", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  periodIndex: integer("period_index").notNull(),
});

export const examTasks = pgTable("exam_tasks", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  courseId: text("course_id").notNull(),
  studentGroupIds: jsonb("student_group_ids").$type<string[]>().notNull(),
  expectedCount: integer("expected_count").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  requiredRoomType: roomType("required_room_type").notNull(),
  requiredEquipmentTags: jsonb("required_equipment_tags").$type<string[]>().notNull(),
  allowedSlotIds: jsonb("allowed_slot_ids").$type<string[]>().notNull(),
  invigilatorCount: integer("invigilator_count").notNull(),
});

export const scheduleRuns = pgTable("schedule_runs", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  status: runStatus("status").notNull(),
  score: integer("score").notNull(),
  conflictCount: integer("conflict_count").notNull(),
  assignmentCount: integer("assignment_count").notNull(),
  elapsedMs: integer("elapsed_ms").notNull(),
  statistics: jsonb("statistics").notNull(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scheduledExams = pgTable("scheduled_exams", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  examTaskId: text("exam_task_id").notNull(),
  roomId: text("room_id").notNull(),
  timeSlotId: text("time_slot_id").notNull(),
  teacherIds: jsonb("teacher_ids").$type<string[]>().notNull(),
});

export const conflictRecords = pgTable("conflict_records", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  type: text("type").notNull(),
  severity: conflictSeverity("severity").notNull(),
  affectedIds: jsonb("affected_ids").$type<string[]>().notNull(),
  message: text("message").notNull(),
  suggestion: text("suggestion").notNull(),
});

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
