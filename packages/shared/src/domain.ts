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

export interface ScheduleRunResponse {
  run: ScheduleRunSummary;
  result: ScheduleResult;
}
