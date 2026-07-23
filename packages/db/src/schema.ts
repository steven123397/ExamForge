import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  primaryKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  ConstraintProfile,
  ConstraintProfileSnapshot,
  ScheduleJobRequestSnapshot,
  ScoreBreakdown,
} from "@examforge/shared";

export interface LegacyConstraintProfileSnapshot {
  schemaVersion: 0;
  legacy: true;
  provenance: "migrated_from_batch_constraint_profile";
  config: ConstraintProfile;
}

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
export const draftStatus = pgEnum("draft_status", [
  "editing",
  "validated",
  "blocked",
  "published",
  "discarded",
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  active: boolean("active").notNull().default(true),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  scryptN: integer("scrypt_n").notNull(),
  scryptR: integer("scrypt_r").notNull(),
  scryptP: integer("scrypt_p").notNull(),
  scryptKeyLength: integer("scrypt_key_length").notNull(),
  credentialVersion: integer("credential_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  usernameUnique: uniqueIndex("users_username_unique").on(table.username),
}));

export const roles = pgTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const userRoles = pgTable("user_roles", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.roleId] }),
}));

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenDigest: text("token_digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  credentialVersion: integer("credential_version").notNull().default(1),
}, (table) => ({
  tokenDigestUnique: uniqueIndex("sessions_token_digest_unique").on(table.tokenDigest),
  userExpiresAtIndex: index("sessions_user_expires_at_idx").on(table.userId, table.expiresAt),
}));

export const authLoginAttempts = pgTable("auth_login_attempts", {
  keyDigest: text("key_digest").primaryKey(),
  failureCount: integer("failure_count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  updatedAtIndex: index("auth_login_attempts_updated_at_idx").on(table.updatedAt),
}));

export const constraintProfiles = pgTable("constraint_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").$type<"active" | "disabled">().notNull().default("active"),
  ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  currentVersionId: text("current_version_id").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  oneDefault: uniqueIndex("constraint_profiles_one_default_idx")
    .on(table.isDefault)
    .where(sql`${table.isDefault}`),
}));

export const constraintProfileVersions = pgTable("constraint_profile_versions", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => constraintProfiles.id, {
    onDelete: "restrict",
  }),
  versionNumber: integer("version_number").notNull(),
  schemaVersion: integer("schema_version").$type<1>().notNull(),
  digest: text("digest").notNull(),
  config: jsonb("config").$type<ConstraintProfile>().notNull(),
  createdByUserId: text("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  profileVersionUnique: uniqueIndex("constraint_profile_versions_profile_version_unique").on(
    table.profileId,
    table.versionNumber,
  ),
}));
export const scheduleJobStatus = pgEnum("schedule_job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

export const examBatches = pgTable("exam_batches", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: batchStatus("status").notNull().default("draft"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  constraintProfile: jsonb("constraint_profile").notNull(),
  publishedRunId: text("published_run_id"),
  publicationVersion: integer("publication_version").notNull().default(0),
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
  departmentId: text("department_id").notNull().references(() => departments.id),
});

export const teachers = pgTable("teachers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  departmentId: text("department_id").notNull().references(() => departments.id),
});

export const userTeacherScopes = pgTable("user_teacher_scopes", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  teacherId: text("teacher_id").notNull().references(() => teachers.id, { onDelete: "restrict" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId] }),
  teacherUnique: uniqueIndex("user_teacher_scopes_teacher_id_unique").on(table.teacherId),
}));

export const userStudentGroupScopes = pgTable("user_student_group_scopes", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  studentGroupId: text("student_group_id").notNull().references(() => studentGroups.id, {
    onDelete: "restrict",
  }),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.studentGroupId] }),
}));

export const courses = pgTable("courses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  departmentId: text("department_id").notNull().references(() => departments.id),
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
  batchId: text("batch_id").notNull().references(() => examBatches.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  periodIndex: integer("period_index").notNull(),
}, (table) => ({
  batchPeriodUnique: uniqueIndex("time_slots_batch_period_unique").on(table.batchId, table.periodIndex),
}));

export const examTasks = pgTable("exam_tasks", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => examBatches.id, { onDelete: "cascade" }),
  courseId: text("course_id").notNull().references(() => courses.id),
  expectedCount: integer("expected_count").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  requiredRoomType: roomType("required_room_type").notNull(),
  requiredEquipmentTags: jsonb("required_equipment_tags").$type<string[]>().notNull(),
  allowedSlotIds: jsonb("allowed_slot_ids").$type<string[]>().notNull(),
  invigilatorCount: integer("invigilator_count").notNull(),
});

export const examTaskStudentGroups = pgTable("exam_task_student_groups", {
  examTaskId: text("exam_task_id").notNull().references(() => examTasks.id, { onDelete: "cascade" }),
  studentGroupId: text("student_group_id").notNull().references(() => studentGroups.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.examTaskId, table.studentGroupId] }),
}));

export const scheduleRuns = pgTable("schedule_runs", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => examBatches.id, { onDelete: "cascade" }),
  status: runStatus("status").notNull(),
  score: integer("score").notNull(),
  scoreBreakdown: jsonb("score_breakdown").$type<ScoreBreakdown>().notNull(),
  conflictCount: integer("conflict_count").notNull(),
  assignmentCount: integer("assignment_count").notNull(),
  elapsedMs: integer("elapsed_ms").notNull(),
  statistics: jsonb("statistics").notNull(),
  report: jsonb("report").notNull(),
  constraintProfileVersionId: text("constraint_profile_version_id").references(
    () => constraintProfileVersions.id,
    { onDelete: "restrict" },
  ),
  constraintProfileSnapshot: jsonb("constraint_profile_snapshot")
    .$type<ConstraintProfileSnapshot | LegacyConstraintProfileSnapshot>()
    .notNull(),
  schedulerVersion: text("scheduler_version").notNull(),
  scoringContractVersion: integer("scoring_contract_version").notNull(),
  normalizedScore: numeric("normalized_score", {
    precision: 5,
    scale: 2,
    mode: "number",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdSequence: bigint("created_sequence", { mode: "number" }).generatedAlwaysAsIdentity({
    name: "schedule_runs_created_sequence_seq",
  }),
}, (table) => ({
  createdSequenceUnique: uniqueIndex("schedule_runs_created_sequence_unique").on(
    table.createdSequence,
  ),
}));

export const scheduledExams = pgTable("scheduled_exams", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => scheduleRuns.id, { onDelete: "cascade" }),
  examTaskId: text("exam_task_id").notNull().references(() => examTasks.id),
  roomId: text("room_id").notNull().references(() => rooms.id),
  timeSlotId: text("time_slot_id").notNull().references(() => timeSlots.id),
}, (table) => ({
  runExamTaskUnique: uniqueIndex("scheduled_exams_run_exam_task_unique").on(table.runId, table.examTaskId),
  runRoomSlotUnique: uniqueIndex("scheduled_exams_run_room_slot_unique").on(table.runId, table.roomId, table.timeSlotId),
}));

export const scheduledExamInvigilators = pgTable("scheduled_exam_invigilators", {
  scheduledExamId: text("scheduled_exam_id").notNull().references(() => scheduledExams.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  teacherId: text("teacher_id").notNull().references(() => teachers.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.scheduledExamId, table.position] }),
}));

export const conflictRecords = pgTable("conflict_records", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => scheduleRuns.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  severity: conflictSeverity("severity").notNull(),
  affectedIds: jsonb("affected_ids").$type<string[]>().notNull(),
  message: text("message").notNull(),
  suggestion: text("suggestion").notNull(),
});

export const scheduleDrafts = pgTable("schedule_drafts", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => examBatches.id, { onDelete: "cascade" }),
  sourceRunId: text("source_run_id").notNull().references(() => scheduleRuns.id),
  basePublishedRunId: text("base_published_run_id").references(() => scheduleRuns.id),
  status: draftStatus("status").notNull(),
  score: integer("score").notNull(),
  conflictCount: integer("conflict_count").notNull(),
  assignmentCount: integer("assignment_count").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const draftScheduledExams = pgTable("draft_scheduled_exams", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull().references(() => scheduleDrafts.id, { onDelete: "cascade" }),
  examTaskId: text("exam_task_id").notNull().references(() => examTasks.id),
  roomId: text("room_id").notNull().references(() => rooms.id),
  timeSlotId: text("time_slot_id").notNull().references(() => timeSlots.id),
  locked: boolean("locked").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  draftExamTaskUnique: uniqueIndex("draft_scheduled_exams_draft_exam_task_unique").on(table.draftId, table.examTaskId),
}));

export const draftExamInvigilators = pgTable("draft_exam_invigilators", {
  draftScheduledExamId: text("draft_scheduled_exam_id").notNull().references(() => draftScheduledExams.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  teacherId: text("teacher_id").notNull().references(() => teachers.id),
}, (table) => ({
  pk: primaryKey({ columns: [table.draftScheduledExamId, table.position] }),
}));

export const draftConflictRecords = pgTable("draft_conflict_records", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull().references(() => scheduleDrafts.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  severity: conflictSeverity("severity").notNull(),
  affectedIds: jsonb("affected_ids").$type<string[]>().notNull(),
  message: text("message").notNull(),
  suggestion: text("suggestion").notNull(),
});

export const draftChangeEvents = pgTable("draft_change_events", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").notNull().references(() => scheduleDrafts.id, { onDelete: "cascade" }),
  examTaskId: text("exam_task_id").notNull().references(() => examTasks.id),
  before: jsonb("before").notNull(),
  after: jsonb("after").notNull(),
  actor: text("actor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorRoles: jsonb("actor_roles").$type<string[]>().notNull().default([]),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdSequence: bigint("created_sequence", { mode: "number" }).generatedAlwaysAsIdentity({
    name: "audit_events_created_sequence_seq",
  }),
}, (table) => ({
  createdSequenceUnique: uniqueIndex("audit_events_created_sequence_unique").on(
    table.createdSequence,
  ),
}));

export const scheduleJobs = pgTable("schedule_jobs", {
  id: text("id").primaryKey(),
  batchId: text("batch_id").notNull().references(() => examBatches.id, { onDelete: "restrict" }),
  status: scheduleJobStatus("status").notNull(),
  progress: integer("progress").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestDigest: text("request_digest").notNull(),
  requestVersion: integer("request_version").notNull(),
  requestPayload: jsonb("request_payload")
    .$type<ScheduleJobRequestSnapshot | { legacy: true }>()
    .notNull(),
  constraintProfileVersionId: text("constraint_profile_version_id").references(
    () => constraintProfileVersions.id,
    { onDelete: "restrict" },
  ),
  constraintProfileSnapshot: jsonb("constraint_profile_snapshot")
    .$type<ConstraintProfileSnapshot | LegacyConstraintProfileSnapshot>()
    .notNull(),
  submittedBy: text("submitted_by").notNull().default("system"),
  submittedByUserId: text("submitted_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  traceId: text("trace_id").notNull(),
  runId: text("run_id").references(() => scheduleRuns.id, { onDelete: "set null" }),
  error: text("error"),
  errorCategory: text("error_category"),
  errorCode: text("error_code"),
  errorRetryable: boolean("error_retryable"),
  cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true }),
  queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdSequence: bigint("created_sequence", { mode: "number" }).generatedAlwaysAsIdentity({
    name: "schedule_jobs_created_sequence_seq",
  }),
}, (table) => ({
  idempotencyKeyUnique: uniqueIndex("schedule_jobs_idempotency_key_unique").on(table.idempotencyKey),
  batchCreatedAtIndex: index("schedule_jobs_batch_created_at_idx").on(table.batchId, table.createdAt),
  statusUpdatedAtIndex: index("schedule_jobs_status_updated_at_idx").on(table.status, table.updatedAt),
  createdSequenceUnique: uniqueIndex("schedule_jobs_created_sequence_unique").on(
    table.createdSequence,
  ),
}));

export const scheduleJobAttempts = pgTable("schedule_job_attempts", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => scheduleJobs.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  status: text("status").notNull(),
  schedulerRequestId: text("scheduler_request_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  error: jsonb("error").$type<Record<string, unknown> | null>(),
}, (table) => ({
  jobAttemptUnique: uniqueIndex("schedule_job_attempts_job_attempt_unique").on(
    table.jobId,
    table.attemptNumber,
  ),
}));

export const scheduleJobEvents = pgTable("schedule_job_events", {
  id: text("id").primaryKey(),
  sequence: bigserial("sequence", { mode: "number" }),
  jobId: text("job_id").notNull().references(() => scheduleJobs.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  eventVersion: integer("event_version").notNull().default(1),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  traceId: text("trace_id").notNull(),
}, (table) => ({
  jobOccurredAtIndex: index("schedule_job_events_job_occurred_at_idx").on(
    table.jobId,
    table.occurredAt,
  ),
  jobSequenceIndex: index("schedule_job_events_job_sequence_idx").on(
    table.jobId,
    table.sequence,
  ),
  sequenceUnique: uniqueIndex("schedule_job_events_sequence_unique").on(table.sequence),
}));

export const outboxEvents = pgTable("outbox_events", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => scheduleJobEvents.id, { onDelete: "cascade" }),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  eventType: text("event_type").notNull(),
  eventVersion: integer("event_version").notNull().default(1),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  eventUnique: uniqueIndex("outbox_events_event_id_unique").on(table.eventId),
  pendingIndex: index("outbox_events_pending_idx").on(table.publishedAt, table.availableAt),
}));

export const teacherUnavailableSlots = pgTable("teacher_unavailable_slots", {
  teacherId: text("teacher_id").notNull().references(() => teachers.id, { onDelete: "cascade" }),
  timeSlotId: text("time_slot_id").notNull().references(() => timeSlots.id, { onDelete: "cascade" }),
}, (table) => ({
  pk: primaryKey({ columns: [table.teacherId, table.timeSlotId] }),
}));
