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

export const scheduleInputSchema = z.object({
  student_groups: z.array(studentGroupSchema),
  teachers: z.array(teacherSchema),
  courses: z.array(courseSchema),
  rooms: z.array(roomSchema),
  time_slots: z.array(timeSlotSchema),
  exam_tasks: z.array(examTaskSchema),
  constraint_profile: constraintProfileSchema,
});

export const scheduledExamSchema = z.object({
  exam_task_id: z.string(),
  room_id: z.string(),
  time_slot_id: z.string(),
  teacher_ids: z.array(z.string()).default([]),
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
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
export type ScheduledExam = z.infer<typeof scheduledExamSchema>;
export type ConflictRecord = z.infer<typeof conflictRecordSchema>;
export type SoftPenaltyItem = z.infer<typeof softPenaltyItemSchema>;
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;
export type SolverStatistics = z.infer<typeof solverStatisticsSchema>;
export type ScheduleResult = z.infer<typeof scheduleResultSchema>;
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

export interface ScheduleRunListResponse {
  runs: ScheduleRunSummary[];
}

export interface AuditEventSummary {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AuditEventListResponse {
  events: AuditEventSummary[];
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
}

export interface ScheduleDraftListResponse {
  drafts: ScheduleDraftSummary[];
}

export interface ScheduleDraftComparisonResponse {
  draft: ScheduleDraftSummary;
  sourceRun: ScheduleRunSummary;
  assignmentChanges: {
    unchanged: number;
    changed: Array<{
      before: ScheduledExam;
      after: ScheduledExam;
    }>;
  };
}

export interface ScheduleDraftPublishResponse extends PublishedScheduleResponse {
  draft: ScheduleDraftSummary;
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
