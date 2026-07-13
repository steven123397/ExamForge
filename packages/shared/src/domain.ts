import { z } from "zod";

export const roomTypeSchema = z.enum(["standard", "computer_lab", "language_lab"]);
export const examTypeSchema = z.enum(["written", "computer", "oral"]);
export const conflictSeveritySchema = z.enum(["error", "warning"]);
export const solveStatusSchema = z.enum([
  "feasible",
  "partial",
  "infeasible",
  "error",
]);

export type RoomType = z.infer<typeof roomTypeSchema>;
export type ExamType = z.infer<typeof examTypeSchema>;
export type ConflictSeverity = z.infer<typeof conflictSeveritySchema>;
export type SolveStatus = z.infer<typeof solveStatusSchema>;

export const studentGroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().int().positive(),
  department_id: z.string(),
});

export const teacherSchema = z.object({
  id: z.string(),
  name: z.string(),
  department_id: z.string(),
  unavailable_slot_ids: z.array(z.string()).default([]),
});

export const courseSchema = z.object({
  id: z.string(),
  name: z.string(),
  department_id: z.string(),
  exam_type: examTypeSchema,
});

export const roomSchema = z.object({
  id: z.string(),
  name: z.string(),
  building_id: z.string(),
  capacity: z.number().int().positive(),
  room_type: roomTypeSchema,
  equipment_tags: z.array(z.string()).default([]),
});

export const timeSlotSchema = z.object({
  id: z.string(),
  date: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  period_index: z.number().int().nonnegative(),
});

export const examTaskSchema = z.object({
  id: z.string(),
  course_id: z.string(),
  student_group_ids: z.array(z.string()).min(1),
  expected_count: z.number().int().positive(),
  duration_minutes: z.number().int().positive(),
  required_room_type: roomTypeSchema,
  required_equipment_tags: z.array(z.string()).default([]),
  allowed_slot_ids: z.array(z.string()).default([]),
  invigilator_count: z.number().int().positive(),
});

export const constraintProfileSchema = z.object({
  hard_rules: z.array(z.string()),
  soft_weights: z.record(z.number().int().nonnegative()),
  time_limit_seconds: z.number().int().positive(),
});

export const fixedAssignmentSchema = z.object({
  exam_task_id: z.string(),
  room_id: z.string(),
  time_slot_id: z.string(),
  teacher_ids: z.array(z.string()).default([]),
});

export const scheduledExamSchema = z.object({
  exam_task_id: z.string(),
  room_id: z.string(),
  time_slot_id: z.string(),
  teacher_ids: z.array(z.string()).default([]),
});

export const rescheduleContextSchema = z
  .object({
    baseline_assignments: z.array(scheduledExamSchema).min(1),
    movable_exam_task_ids: z.array(z.string()).default([]),
  })
  .superRefine((context, refinementContext) => {
    const baselineExamTaskIds = new Set<string>();
    for (const [index, assignment] of context.baseline_assignments.entries()) {
      if (baselineExamTaskIds.has(assignment.exam_task_id)) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["baseline_assignments", index, "exam_task_id"],
          message: `duplicate baseline exam_task_id ${assignment.exam_task_id}`,
        });
      }
      baselineExamTaskIds.add(assignment.exam_task_id);
    }

    const movableExamTaskIds = new Set<string>();
    for (const [index, examTaskId] of context.movable_exam_task_ids.entries()) {
      if (movableExamTaskIds.has(examTaskId)) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["movable_exam_task_ids", index],
          message: `duplicate movable exam_task_id ${examTaskId}`,
        });
      }
      movableExamTaskIds.add(examTaskId);

      if (!baselineExamTaskIds.has(examTaskId)) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["movable_exam_task_ids", index],
          message: `movable exam_task_id ${examTaskId} is not in baseline_assignments`,
        });
      }
    }
  });

export const scheduleInputSchema = z.object({
  student_groups: z.array(studentGroupSchema),
  teachers: z.array(teacherSchema),
  courses: z.array(courseSchema),
  rooms: z.array(roomSchema),
  time_slots: z.array(timeSlotSchema),
  exam_tasks: z.array(examTaskSchema),
  constraint_profile: constraintProfileSchema,
  fixed_assignments: z.array(fixedAssignmentSchema).default([]),
  reschedule_context: rescheduleContextSchema.nullable().default(null),
});

export const conflictRecordSchema = z.object({
  type: z.string(),
  severity: conflictSeveritySchema,
  affected_ids: z.array(z.string()),
  message: z.string(),
  suggestion: z.string(),
});

export const softPenaltyItemSchema = z.object({
  rule: z.string(),
  penalty: z.number().int().nonnegative(),
  message: z.string(),
});

export const scoreBreakdownSchema = z.object({
  total_score: z.number().int().nonnegative(),
  hard_violation_count: z.number().int().nonnegative(),
  soft_penalty_items: z.array(softPenaltyItemSchema),
});

export const solverStatisticsSchema = z.object({
  status: solveStatusSchema,
  elapsed_ms: z.number().int().nonnegative(),
  exam_count: z.number().int().nonnegative(),
  room_count: z.number().int().nonnegative(),
  slot_count: z.number().int().nonnegative(),
  attempted_assignments: z.number().int().nonnegative(),
});

export const scheduleReportSchema = z.record(z.unknown());

export const rescheduleReportSchema = z.object({
  baseline_exam_count: z.number().int().nonnegative(),
  frozen_exam_task_ids: z.array(z.string()),
  retained_exam_task_ids: z.array(z.string()),
  changed_exam_task_ids: z.array(z.string()),
});

export const scheduleResultSchema = z.object({
  assignments: z.array(scheduledExamSchema),
  conflicts: z.array(conflictRecordSchema),
  score: scoreBreakdownSchema,
  statistics: solverStatisticsSchema,
  report: scheduleReportSchema.optional(),
});

export const referenceResourceSchema = z.enum([
  "student-groups",
  "teachers",
  "courses",
  "rooms",
  "time-slots",
  "exam-tasks",
]);

export const referenceRecordCreateSchemas = {
  "student-groups": studentGroupSchema,
  teachers: teacherSchema,
  courses: courseSchema,
  rooms: roomSchema,
  "time-slots": timeSlotSchema,
  "exam-tasks": examTaskSchema,
} as const;

export const referenceRecordUpdateSchemas = {
  "student-groups": studentGroupSchema.omit({ id: true }).partial().strict(),
  teachers: teacherSchema.omit({ id: true }).partial().strict(),
  courses: courseSchema.omit({ id: true }).partial().strict(),
  rooms: roomSchema.omit({ id: true }).partial().strict(),
  "time-slots": timeSlotSchema.omit({ id: true }).partial().strict(),
  "exam-tasks": examTaskSchema.omit({ id: true }).partial().strict(),
} as const;

export type StudentGroup = z.infer<typeof studentGroupSchema>;
export type Teacher = z.infer<typeof teacherSchema>;
export type Course = z.infer<typeof courseSchema>;
export type Room = z.infer<typeof roomSchema>;
export type TimeSlot = z.infer<typeof timeSlotSchema>;
export type ExamTask = z.infer<typeof examTaskSchema>;
export type ConstraintProfile = z.infer<typeof constraintProfileSchema>;
export type FixedAssignment = z.infer<typeof fixedAssignmentSchema>;
export type RescheduleContext = z.infer<typeof rescheduleContextSchema>;
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
export type ScheduledExam = z.infer<typeof scheduledExamSchema>;
export type ConflictRecord = z.infer<typeof conflictRecordSchema>;
export type SoftPenaltyItem = z.infer<typeof softPenaltyItemSchema>;
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;
export type SolverStatistics = z.infer<typeof solverStatisticsSchema>;
export type ScheduleResult = z.infer<typeof scheduleResultSchema>;
export type RescheduleReport = z.infer<typeof rescheduleReportSchema>;
export type ReferenceResource = z.infer<typeof referenceResourceSchema>;
export type ReferenceRecord =
  | StudentGroup
  | Teacher
  | Course
  | Room
  | TimeSlot
  | ExamTask;

export interface ExamBatchSummary {
  id: string;
  name: string;
  status: "draft" | "ready" | "scheduled" | "published";
  startDate: string;
  endDate: string;
}

export interface DashboardResponse {
  batch: ExamBatchSummary;
  metrics: {
    examTaskCount: number;
    teacherCount: number;
    roomCount: number;
    timeSlotCount: number;
    conflictCount: number;
    score: number | null;
  };
  latestRun: ScheduleRunSummary | null;
}

export interface ScheduleRunSummary {
  id: string;
  status: SolveStatus;
  createdAt: string;
  elapsedMs: number;
  score: number;
  conflictCount: number;
  assignmentCount: number;
}

export interface ReferenceDataResponse {
  batch: ExamBatchSummary;
  scheduleInput: ScheduleInput;
}

export interface ReferenceImportResponse {
  resource: ReferenceResource;
  records: ReferenceRecord[];
}

export interface ReferenceDeleteResponse {
  resource: ReferenceResource;
  deleted: ReferenceRecord;
}

export interface ScheduleRunResponse {
  run: ScheduleRunSummary;
  result: ScheduleResult;
}

export interface ScheduleDraftRescheduleResponse extends ScheduleRunResponse {
  sourceDraftId: string;
  reschedule: RescheduleReport;
}

export interface ScheduleRunListResponse {
  runs: ScheduleRunSummary[];
}

export interface AuditEventSummary {
  id: string;
  actor: string;
  actorUserId: string | null;
  actorRoles: UserRole[];
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AuditEventListResponse {
  events: AuditEventSummary[];
}

export interface AuditEventFilter {
  entityType?: string;
  entityId?: string;
  actor?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export interface ScheduleRunComparisonResponse {
  baseRun: ScheduleRunSummary;
  targetRun: ScheduleRunSummary;
  deltas: {
    score: number;
    assignments: number;
    conflicts: number;
    elapsedMs: number;
  };
  assignmentChanges: {
    unchanged: number;
    added: ScheduledExam[];
    removed: ScheduledExam[];
  };
}

export interface PublishedScheduleResponse {
  batch: ExamBatchSummary;
  run: ScheduleRunSummary;
  result: ScheduleResult;
}

export interface ScheduleRollbackResponse {
  batch: ExamBatchSummary;
  previousRun: ScheduleRunSummary | null;
}

export type ScheduleDraftStatus =
  | "editing"
  | "validated"
  | "blocked"
  | "published"
  | "discarded";

export interface ScheduleDraftSummary {
  id: string;
  batchId: string;
  sourceRunId: string;
  basePublishedRunId: string | null;
  status: ScheduleDraftStatus;
  score: number;
  conflictCount: number;
  assignmentCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleDraftChangeEvent {
  id: string;
  draftId: string;
  examTaskId: string;
  before: ScheduledExam;
  after: ScheduledExam;
  actor: string;
  createdAt: string;
}

export interface ScheduleDraftDetailResponse {
  draft: ScheduleDraftSummary;
  assignments: ScheduledExam[];
  conflicts: ConflictRecord[];
  changeEvents: ScheduleDraftChangeEvent[];
  lockedExamTaskIds?: string[];
}

export interface ScheduleDraftListResponse {
  drafts: ScheduleDraftSummary[];
}

export interface ScheduleDraftAssignmentChanges {
  unchanged: number;
  changed: Array<{
    before: ScheduledExam;
    after: ScheduledExam;
  }>;
}

export interface ScheduleDraftComparisonResponse {
  draft: ScheduleDraftSummary;
  source: {
    run: ScheduleRunSummary;
    assignmentChanges: ScheduleDraftAssignmentChanges;
  };
  published: {
    run: ScheduleRunSummary;
    assignmentChanges: ScheduleDraftAssignmentChanges;
  } | null;
  summary: {
    changedFromSource: number;
    changedFromPublished: number | null;
    hardConflictCount: number;
    score: number;
  };
}

export interface ScheduleDraftPublishResponse extends PublishedScheduleResponse {
  draft: ScheduleDraftSummary;
}

export interface ScheduleDraftDiscardResponse {
  draft: ScheduleDraftSummary;
}

export interface ScheduleDraftAdjustmentSuggestion {
  assignment: ScheduledExam;
  hardConflictCount: number;
  score: number;
  reasons: string[];
}

export interface ScheduleDraftAdjustmentSuggestionsResponse {
  draft: ScheduleDraftSummary;
  examTaskId: string;
  suggestions: ScheduleDraftAdjustmentSuggestion[];
}

export const scheduleJobStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export const scheduleJobStatusSchema = z.enum(scheduleJobStatuses);
export type ScheduleJobStatus = z.infer<typeof scheduleJobStatusSchema>;
export type ScheduleJobTransitionResolution = "apply" | "idempotent" | "reject";

const scheduleJobTransitions: Readonly<Record<ScheduleJobStatus, readonly ScheduleJobStatus[]>> = {
  queued: ["running", "failed", "cancelled", "timed_out"],
  running: ["succeeded", "failed", "cancelled", "timed_out"],
  succeeded: [],
  failed: [],
  cancelled: [],
  timed_out: [],
};

export function resolveScheduleJobTransition(
  current: ScheduleJobStatus,
  next: ScheduleJobStatus,
): ScheduleJobTransitionResolution {
  if (current === next) {
    return "idempotent";
  }
  return scheduleJobTransitions[current].includes(next) ? "apply" : "reject";
}

export function scheduleJobStatusForSolveResult(status: SolveStatus): "succeeded" | "failed" {
  return status === "error" ? "failed" : "succeeded";
}

export const scheduleJobErrorCategorySchema = z.enum([
  "validation",
  "scheduler",
  "infrastructure",
  "timeout",
  "cancelled",
  "unavailable",
  "protocol",
  "internal",
  "unknown",
]);

export const scheduleJobErrorSchema = z.object({
  category: scheduleJobErrorCategorySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
}).strict();

export const scheduleJobRequestIdentitySchema = z.object({
  idempotencyKey: z.string().min(1).max(200),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const scheduleJobTimestampsSchema = z.object({
  queuedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
}).strict();

export const scheduleJobEventTypeSchema = z.enum([
  "schedule_job.queued",
  "schedule_job.running",
  "schedule_job.succeeded",
  "schedule_job.failed",
  "schedule_job.cancelled",
  "schedule_job.timed_out",
]);

export const scheduleJobEventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  jobId: z.string().min(1),
  type: scheduleJobEventTypeSchema,
  version: z.literal(1),
  occurredAt: z.string().datetime(),
  payload: z.record(z.unknown()),
  traceId: z.string().min(1),
}).strict();

export type ScheduleJobError = z.infer<typeof scheduleJobErrorSchema>;
export type ScheduleJobRequestIdentity = z.infer<typeof scheduleJobRequestIdentitySchema>;
export type ScheduleJobTimestamps = z.infer<typeof scheduleJobTimestampsSchema>;
export type ScheduleJobEventEnvelope = z.infer<typeof scheduleJobEventEnvelopeSchema>;

export interface ScheduleJobSummary {
  id: string;
  batchId: string;
  status: ScheduleJobStatus;
  progress: number;
  idempotencyKey: string;
  requestDigest: string;
  traceId: string;
  runId: string | null;
  error: ScheduleJobError | null;
  cancellationRequestedAt: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleJobResponse {
  job: ScheduleJobSummary;
}

export interface ScheduleJobListResponse {
  jobs: ScheduleJobSummary[];
}

export const userRoleSchema = z.enum(["admin", "operator", "teacher", "student"]);

export const userSummarySchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  displayName: z.string().min(1),
  active: z.boolean(),
  roles: z.array(userRoleSchema),
}).strict();

export const sessionSummarySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export const authContextSchema = z.object({
  user: userSummarySchema,
  session: sessionSummarySchema,
}).strict();

export const loginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
}).strict();

export type UserRole = z.infer<typeof userRoleSchema>;
export type UserSummary = z.infer<typeof userSummarySchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type AuthContext = z.infer<typeof authContextSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export interface PublishedScheduleNotification {
  id: string;
  studentGroupId: string;
  studentGroupName: string;
  assignmentCount: number;
  message: string;
}

export interface PublishedScheduleNotificationsResponse {
  batch: ExamBatchSummary;
  run: ScheduleRunSummary;
  notifications: PublishedScheduleNotification[];
}

export interface TeacherUnavailableSlotsResponse {
  teacher: Teacher;
}

export interface PublishedScheduleAssignmentView {
  assignment: ScheduledExam;
  examTask: ExamTask | null;
  course: Course | null;
  studentGroups: StudentGroup[];
  room: Room | null;
  timeSlot: TimeSlot | null;
  teachers: Teacher[];
}

export interface PublishedScheduleAudienceResponse {
  batch: ExamBatchSummary;
  run: ScheduleRunSummary;
  viewer: {
    type: "teacher" | "student_group";
    id: string;
    name: string;
  };
  assignments: PublishedScheduleAssignmentView[];
}
