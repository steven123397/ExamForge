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

export const participantModeSchema = z.enum(["groups_only", "enrollments"]);
export const participantDataStatusSchema = z.enum(["not_required", "draft", "complete"]);
export const studentStatusSchema = z.enum(["active", "disabled"]);
export const enrollmentSourceSchema = z.enum(["regular", "elective", "retake", "other"]);
export const enrollmentStatusSchema = z.enum(["active", "withdrawn"]);

/**
 * 脱敏学生只保存排考需要的标识与组织关系。
 * `.strict()` 是刻意的：姓名、证件号、手机号、邮箱等真实个人信息一律被拒绝。
 */
export const studentSchema = z.object({
  id: z.string().min(1).max(64),
  display_code: z.string().min(1).max(64).nullable().default(null),
  primary_student_group_id: z.string().min(1).nullable().default(null),
  status: studentStatusSchema.default("active"),
}).strict();

export const examEnrollmentSchema = z.object({
  exam_task_id: z.string().min(1),
  student_id: z.string().min(1),
  source: enrollmentSourceSchema.default("regular"),
  status: enrollmentStatusSchema.default("active"),
}).strict();

export const overlapSampleParticipantSchema = z.object({
  student_id: z.string().min(1),
  exam_a_source: enrollmentSourceSchema,
  exam_b_source: enrollmentSourceSchema,
}).strict();

export const maxOverlapSampleParticipants = 5;

/**
 * Cross-language canonical ordering for identifiers.
 *
 * JavaScript locale collation is environment-dependent and differs from the
 * code-point ordering used by the Python scheduler. Compare Unicode code
 * points explicitly so API, worker and scheduler accept the same edge order.
 */
export function compareCanonicalIdentifier(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCodePoint = left.codePointAt(leftIndex)!;
    const rightCodePoint = right.codePointAt(rightIndex)!;
    if (leftCodePoint !== rightCodePoint) {
      return leftCodePoint < rightCodePoint ? -1 : 1;
    }
    leftIndex += leftCodePoint > 0xffff ? 2 : 1;
    rightIndex += rightCodePoint > 0xffff ? 2 : 1;
  }

  if (leftIndex < left.length) {
    return 1;
  }
  if (rightIndex < right.length) {
    return -1;
  }
  return 0;
}

export const studentOverlapEdgeSchema = z.object({
  exam_task_id_a: z.string().min(1),
  exam_task_id_b: z.string().min(1),
  overlap_count: z.number().int().positive(),
  sample_participants: z
    .array(overlapSampleParticipantSchema)
    .max(maxOverlapSampleParticipants)
    .default([]),
}).strict().superRefine((edge, context) => {
  if (compareCanonicalIdentifier(edge.exam_task_id_a, edge.exam_task_id_b) >= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["exam_task_id_b"],
      message: "overlap edge requires exam_task_id_a < exam_task_id_b",
    });
  }

  const seenStudentIds = new Set<string>();
  let previousStudentId: string | null = null;
  for (const [index, participant] of edge.sample_participants.entries()) {
    if (seenStudentIds.has(participant.student_id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sample_participants", index, "student_id"],
        message: `duplicate sample participant ${participant.student_id}`,
      });
    }
    seenStudentIds.add(participant.student_id);

    if (
      previousStudentId !== null
      && compareCanonicalIdentifier(previousStudentId, participant.student_id) >= 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sample_participants", index, "student_id"],
        message: "sample participants must be sorted by student_id",
      });
    }
    previousStudentId = participant.student_id;
  }

  if (edge.sample_participants.length > edge.overlap_count) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sample_participants"],
      message: "sample participants cannot exceed overlap_count",
    });
  }
});

const sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const constraintProfileVersionSchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  schemaVersion: z.literal(1),
  digest: sha256DigestSchema,
  config: constraintProfileSchema,
  createdByUserId: z.string().min(1).nullable(),
  createdAt: z.string().datetime(),
}).strict();

export const constraintProfileStatusSchema = z.enum(["active", "disabled"]);

export const constraintProfileRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: constraintProfileStatusSchema,
  ownerUserId: z.string().min(1).nullable(),
  currentVersionId: z.string().min(1),
  isDefault: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  versions: z.array(constraintProfileVersionSchema).min(1),
}).strict();

export const constraintProfileSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  profileId: z.string().min(1),
  profileVersionId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  digest: sha256DigestSchema,
  config: constraintProfileSchema,
}).strict();

/**
 * 参与者快照元数据。作业、运行和草稿据此追溯当时冻结的报名事实，
 * 不回读当前报名表。`groups_only` 没有报名 digest。
 */
export const participantSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  batchId: z.string().min(1),
  mode: participantModeSchema,
  dataVersion: z.number().int().nonnegative(),
  digest: sha256DigestSchema.nullable(),
  studentCount: z.number().int().nonnegative(),
  enrollmentCount: z.number().int().nonnegative(),
  overlapEdgeCount: z.number().int().nonnegative(),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.mode === "groups_only") {
    if (snapshot.digest !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["digest"],
        message: "groups_only snapshots carry no participant digest",
      });
    }
    if (snapshot.enrollmentCount !== 0 || snapshot.overlapEdgeCount !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["enrollmentCount"],
        message: "groups_only snapshots carry no enrollments or overlap edges",
      });
    }
    return;
  }

  if (snapshot.digest === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["digest"],
      message: "enrollments snapshots require a sealed participant digest",
    });
  }
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
  participant_mode: participantModeSchema.default("groups_only"),
  student_overlap_edges: z.array(studentOverlapEdgeSchema).default([]),
}).superRefine((input, context) => {
  if (input.participant_mode === "groups_only" && input.student_overlap_edges.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["student_overlap_edges"],
      message: "groups_only inputs must not carry student overlap edges",
    });
    return;
  }

  const examTaskIds = new Set(input.exam_tasks.map((task) => task.id));
  let previousKey: [string, string] | null = null;
  for (const [index, edge] of input.student_overlap_edges.entries()) {
    for (const [field, examTaskId] of [
      ["exam_task_id_a", edge.exam_task_id_a],
      ["exam_task_id_b", edge.exam_task_id_b],
    ] as const) {
      if (!examTaskIds.has(examTaskId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["student_overlap_edges", index, field],
          message: `unknown exam_task_id ${examTaskId}`,
        });
      }
    }

    const key: [string, string] = [edge.exam_task_id_a, edge.exam_task_id_b];
    if (
      previousKey !== null
      && previousKey[0] === key[0]
      && previousKey[1] === key[1]
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["student_overlap_edges", index],
        message: `duplicate overlap edge ${edge.exam_task_id_a}/${edge.exam_task_id_b}`,
      });
    } else if (
      previousKey !== null
      && (
        compareCanonicalIdentifier(previousKey[0], key[0]) > 0
        || (
          compareCanonicalIdentifier(previousKey[0], key[0]) === 0
          && compareCanonicalIdentifier(previousKey[1], key[1]) > 0
        )
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["student_overlap_edges", index],
        message: "overlap edges must be sorted by (exam_task_id_a, exam_task_id_b)",
      });
    }
    previousKey = key;
  }
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

export const normalizedPenaltyItemSchema = z.object({
  rule: z.string().min(1),
  violation_count: z.number().int().nonnegative(),
  weight: z.number().int().positive(),
  raw_penalty: z.number().int().nonnegative(),
  weighted_penalty: z.number().int().nonnegative(),
  opportunity_count: z.number().int().nonnegative(),
  normalized_penalty: z.number().min(0).max(1),
}).strict();

export const scoreBreakdownSchema = z.object({
  total_score: z.number().int().nonnegative(),
  hard_violation_count: z.number().int().nonnegative(),
  soft_penalty_items: z.array(softPenaltyItemSchema),
  scoring_contract_version: z.literal(1).default(1),
  normalized_score: z.number().min(0).max(100).default(100),
  total_raw_penalty: z.number().int().nonnegative().default(0),
  total_weighted_penalty: z.number().int().nonnegative().default(0),
  normalized_penalty_items: z.array(normalizedPenaltyItemSchema).default([]),
});

export const scheduleDiagnosticCodeSchema = z.enum([
  "room_capacity_shortage",
  "time_slot_shortage",
  "teacher_shortage",
  "fixed_assignment_conflict",
  "student_group_slot_conflict",
  "invalid_reference",
  "solver_infeasible",
  "unclassified_conflict",
  "participant_mode_invalid",
  "participant_data_incomplete",
  "participant_snapshot_stale",
  "expected_count_exceeds_group_size",
  "expected_count_lower_than_group_size",
  "expected_count_mismatch",
  "student_enrollment_reference_invalid",
  "student_overlap_edge_invalid",
  "student_exam_clash",
]);

export const scheduleDiagnosticResourceSchema = z.enum([
  "room",
  "time_slot",
  "teacher",
  "fixed_assignment",
  "student_group",
  "input",
  "solver",
  "participant_data",
  "student",
  "exam_task",
]);

export const scheduleDiagnosticSchema = z.object({
  code: scheduleDiagnosticCodeSchema,
  severity: conflictSeveritySchema,
  resource_dimension: scheduleDiagnosticResourceSchema,
  affected_ids: z.array(z.string()),
  shortfall: z.number().int().nonnegative(),
  message: z.string(),
  suggestion: z.string(),
}).strict().superRefine((diagnostic, context) => {
  if (diagnostic.code === "student_exam_clash") {
    if (diagnostic.severity !== "error") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["severity"],
        message: "student_exam_clash must be an error",
      });
    }
    if (diagnostic.resource_dimension !== "student") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resource_dimension"],
        message: "student_exam_clash uses the student resource dimension",
      });
    }
    if (
      diagnostic.affected_ids.length !== 3
      || compareCanonicalIdentifier(diagnostic.affected_ids[0] ?? "", diagnostic.affected_ids[1] ?? "") >= 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["affected_ids"],
        message: "student_exam_clash affected_ids are (exam_task_id_a, exam_task_id_b, time_slot_id)",
      });
    }
  }

  if (
    diagnostic.code === "student_overlap_edge_invalid"
    && (diagnostic.severity !== "error" || diagnostic.resource_dimension !== "input")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["resource_dimension"],
      message: "student_overlap_edge_invalid is an input error",
    });
  }

  if (
    diagnostic.code === "participant_snapshot_stale"
    && (diagnostic.severity !== "error" || diagnostic.resource_dimension !== "participant_data")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["resource_dimension"],
      message: "participant_snapshot_stale is a participant-data error",
    });
  }
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
  diagnostics: z.array(scheduleDiagnosticSchema).default([]),
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
export type ParticipantMode = z.infer<typeof participantModeSchema>;
export type ParticipantDataStatus = z.infer<typeof participantDataStatusSchema>;
export type StudentStatus = z.infer<typeof studentStatusSchema>;
export type EnrollmentSource = z.infer<typeof enrollmentSourceSchema>;
export type EnrollmentStatus = z.infer<typeof enrollmentStatusSchema>;
export type Student = z.infer<typeof studentSchema>;
export type ExamEnrollment = z.infer<typeof examEnrollmentSchema>;
export type OverlapSampleParticipant = z.infer<typeof overlapSampleParticipantSchema>;
export type StudentOverlapEdge = z.infer<typeof studentOverlapEdgeSchema>;
export type ParticipantSnapshot = z.infer<typeof participantSnapshotSchema>;
export type ConstraintProfileVersion = z.infer<typeof constraintProfileVersionSchema>;
export type ConstraintProfileSnapshot = z.infer<typeof constraintProfileSnapshotSchema>;
export type ConstraintProfileStatus = z.infer<typeof constraintProfileStatusSchema>;
export type ConstraintProfileRecord = z.infer<typeof constraintProfileRecordSchema>;
export type FixedAssignment = z.infer<typeof fixedAssignmentSchema>;
export type RescheduleContext = z.infer<typeof rescheduleContextSchema>;
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
export type ScheduledExam = z.infer<typeof scheduledExamSchema>;
export type ConflictRecord = z.infer<typeof conflictRecordSchema>;
export type SoftPenaltyItem = z.infer<typeof softPenaltyItemSchema>;
export type NormalizedPenaltyItem = z.infer<typeof normalizedPenaltyItemSchema>;
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;
export type ScheduleDiagnostic = z.infer<typeof scheduleDiagnosticSchema>;
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

export const examBatchSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["draft", "ready", "scheduled", "published"]),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
}).strict();

export type ExamBatchSummary = z.infer<typeof examBatchSummarySchema>;

export const participantImportRequestSchema = z.object({
  mode: z.enum(["replace", "merge"]).default("replace"),
  students: z.array(studentSchema).max(50_000).default([]),
  enrollments: z.array(examEnrollmentSchema).max(200_000).default([]),
}).strict();

export const participantImportIssueCodeSchema = z.enum([
  "student_duplicate",
  "student_reference_invalid",
  "student_group_reference_invalid",
  "enrollment_duplicate",
  "exam_task_reference_invalid",
]);

export const participantImportIssueSchema = z.object({
  index: z.number().int().nonnegative(),
  path: z.string().min(1),
  code: participantImportIssueCodeSchema,
  message: z.string().min(1),
}).strict();

export const participantHealthSummarySchema = z.object({
  batchId: z.string().min(1),
  mode: participantModeSchema,
  status: participantDataStatusSchema,
  dataVersion: z.number().int().nonnegative(),
  digest: sha256DigestSchema.nullable(),
  sealedAt: z.string().datetime().nullable(),
  studentCount: z.number().int().nonnegative(),
  activeStudentCount: z.number().int().nonnegative(),
  enrollmentCount: z.number().int().nonnegative(),
  activeEnrollmentCount: z.number().int().nonnegative(),
  examTaskCount: z.number().int().nonnegative(),
  coveredExamTaskCount: z.number().int().nonnegative(),
  overlapEdgeCount: z.number().int().nonnegative(),
  enrollmentSourceCounts: z.record(enrollmentSourceSchema, z.number().int().nonnegative()),
  diagnostics: z.array(scheduleDiagnosticSchema),
}).strict();

export type ParticipantImportRequest = z.infer<typeof participantImportRequestSchema>;
export type ParticipantImportIssueCode = z.infer<typeof participantImportIssueCodeSchema>;
export type ParticipantImportIssue = z.infer<typeof participantImportIssueSchema>;
export type ParticipantHealthSummary = z.infer<typeof participantHealthSummarySchema>;

export interface ParticipantHealthResponse {
  participants: ParticipantHealthSummary;
}

export interface ParticipantImportResponse extends ParticipantHealthResponse {
  imported: { students: number; enrollments: number };
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

export const scheduleRunSummarySchema = z.object({
  id: z.string().min(1),
  status: solveStatusSchema,
  createdAt: z.string().datetime(),
  elapsedMs: z.number().int().nonnegative(),
  score: z.number(),
  normalizedScore: z.number().min(0).max(100).nullable().optional(),
  conflictCount: z.number().int().nonnegative(),
  assignmentCount: z.number().int().nonnegative(),
  constraintProfileVersionId: z.string().min(1).nullable().optional(),
  constraintProfileSnapshot: constraintProfileSnapshotSchema.nullable().optional(),
  participantSnapshot: participantSnapshotSchema.nullable().optional(),
  schedulerVersion: z.string().min(1).optional(),
  scoringContractVersion: z.number().int().nonnegative().optional(),
}).strict();

export type ScheduleRunSummary = z.infer<typeof scheduleRunSummarySchema>;

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

export const scheduleRunListQuerySchema = z.object({
  status: solveStatusSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export type ScheduleRunListQuery = z.infer<typeof scheduleRunListQuerySchema>;

export interface ScheduleRunListResponse {
  runs: ScheduleRunSummary[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
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
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

export const auditEventListQuerySchema = z.object({
  actor: z.string().trim().min(1).max(100).optional(),
  action: z.string().trim().min(1).max(200).optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().trim().min(1).max(200).optional(),
  traceId: z.string().trim().min(1).max(200).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().superRefine((query, context) => {
  if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "to must be greater than or equal to from",
    });
  }
});

export type AuditEventListQuery = z.infer<typeof auditEventListQuerySchema>;

export interface AuditEventFilter extends Partial<AuditEventListQuery> {
  entityType?: string;
  entityId?: string;
  actor?: string;
  action?: string;
  traceId?: string;
  from?: string;
  to?: string;
  // Compatibility aliases for internal callers while public routes use from/to pagination.
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

export const publicPublishedScheduleBatchSchema = examBatchSummarySchema.pick({
  name: true,
  startDate: true,
  endDate: true,
}).strict();

export const publicPublishedScheduleEntrySchema = z.object({
  courseName: z.string().min(1).nullable(),
  studentGroupNames: z.array(z.string().min(1)),
  roomName: z.string().min(1).nullable(),
  date: z.string().min(1).nullable(),
  startTime: z.string().min(1).nullable(),
  endTime: z.string().min(1).nullable(),
}).strict();

export const publicPublishedScheduleSchema = z.object({
  contractVersion: z.literal(1),
  batch: publicPublishedScheduleBatchSchema,
  entries: z.array(publicPublishedScheduleEntrySchema),
}).strict();

export type PublicPublishedScheduleBatch = z.infer<typeof publicPublishedScheduleBatchSchema>;
export type PublicPublishedScheduleEntry = z.infer<typeof publicPublishedScheduleEntrySchema>;
export type PublicPublishedScheduleResponse = z.infer<typeof publicPublishedScheduleSchema>;

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

export const scheduleJobListQuerySchema = z.object({
  status: scheduleJobStatusSchema.optional(),
  submittedBy: z.string().trim().min(1).max(100).optional(),
  constraintProfileVersionId: z.string().trim().min(1).max(200).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
}).strict().superRefine((query, context) => {
  if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["to"],
      message: "to must be greater than or equal to from",
    });
  }
});

export type ScheduleJobListQuery = z.infer<typeof scheduleJobListQuerySchema>;
export type ScheduleJobTransitionResolution = "apply" | "idempotent" | "reject";

const scheduleJobTransitions: Readonly<Record<ScheduleJobStatus, readonly ScheduleJobStatus[]>> = {
  queued: ["running", "failed", "cancelled", "timed_out"],
  running: ["queued", "succeeded", "failed", "cancelled", "timed_out"],
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

export const legacyScheduleJobRequestSnapshotSchema = z.object({
  version: z.literal(1),
  input: scheduleInputSchema,
}).strict();

export const scheduleJobRequestSnapshotSchema = z.discriminatedUnion("version", [
  legacyScheduleJobRequestSnapshotSchema,
  z.object({
    version: z.literal(2),
    input: scheduleInputSchema,
    constraintProfile: constraintProfileSnapshotSchema,
  }).strict(),
  z.object({
    version: z.literal(3),
    input: scheduleInputSchema,
    constraintProfile: constraintProfileSnapshotSchema,
    participantSnapshot: participantSnapshotSchema,
  }).strict(),
]);

export const scheduleJobAttemptStatusSchema = z.enum([
  "started",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
]);

export const scheduleJobAttemptSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  attemptNumber: z.number().int().positive(),
  status: scheduleJobAttemptStatusSchema,
  schedulerRequestId: z.string().min(1),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  error: scheduleJobErrorSchema.nullable(),
}).strict().superRefine((attempt, context) => {
  const terminal = attempt.status !== "started";
  if (terminal && (attempt.finishedAt === null || attempt.durationMs === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "terminal attempts require finishedAt and durationMs",
    });
  }
  if (!terminal && (attempt.finishedAt !== null || attempt.durationMs !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "started attempts cannot have terminal timing",
    });
  }
});

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
  "schedule_job.attempt_started",
  "schedule_job.running",
  "schedule_job.stage_changed",
  "schedule_job.retry_scheduled",
  "schedule_job.cancellation_requested",
  "schedule_job.run_created",
  "schedule_job.succeeded",
  "schedule_job.failed",
  "schedule_job.cancelled",
  "schedule_job.timed_out",
]);

export const scheduleJobEventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  sequence: z.number().int().positive(),
  jobId: z.string().min(1),
  type: scheduleJobEventTypeSchema,
  version: z.literal(1),
  occurredAt: z.string().datetime(),
  payload: z.record(z.unknown()),
  traceId: z.string().min(1),
}).strict();

export type ScheduleJobError = z.infer<typeof scheduleJobErrorSchema>;
export type ScheduleJobRequestSnapshot = z.infer<typeof scheduleJobRequestSnapshotSchema>;
export type ScheduleJobAttemptStatus = z.infer<typeof scheduleJobAttemptStatusSchema>;
export type ScheduleJobAttempt = z.infer<typeof scheduleJobAttemptSchema>;
export type ScheduleJobRequestIdentity = z.infer<typeof scheduleJobRequestIdentitySchema>;
export type ScheduleJobTimestamps = z.infer<typeof scheduleJobTimestampsSchema>;
export type ScheduleJobEventEnvelope = z.infer<typeof scheduleJobEventEnvelopeSchema>;

export function scheduleJobSseEventName(event: ScheduleJobEventEnvelope) {
  return `${event.type}.v${event.version}` as const;
}

export interface ScheduleJobSummary {
  id: string;
  batchId: string;
  status: ScheduleJobStatus;
  progress: number;
  idempotencyKey: string;
  requestDigest: string;
  constraintProfileVersionId?: string | null;
  constraintProfileSnapshot?: ConstraintProfileSnapshot | null;
  submittedBy?: string;
  submittedByUserId?: string | null;
  traceId: string;
  runId: string | null;
  error: ScheduleJobError | null;
  attemptCount?: number;
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

export interface ScheduleJobDetailResponse extends ScheduleJobResponse {
  attempts: ScheduleJobAttempt[];
  events: ScheduleJobEventEnvelope[];
}

export interface ScheduleJobListResponse {
  jobs: ScheduleJobSummary[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
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

export const teacherAudienceScopeSchema = z.object({
  kind: z.literal("teacher"),
  teacher: teacherSchema,
}).strict();

const studentAudienceScopeObjectSchema = z.object({
  kind: z.literal("student"),
  studentGroups: z.array(studentGroupSchema).min(1),
}).strict();

function rejectDuplicateStudentGroups(
  scope: { studentGroups: Array<{ id: string }> },
  context: z.RefinementCtx,
) {
  const ids = new Set<string>();
  for (const [index, group] of scope.studentGroups.entries()) {
    if (ids.has(group.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["studentGroups", index, "id"],
        message: `duplicate student group ${group.id}`,
      });
    }
    ids.add(group.id);
  }
}

export const studentAudienceScopeSchema = studentAudienceScopeObjectSchema.superRefine(
  rejectDuplicateStudentGroups,
);

export const audienceScopeSchema = z.discriminatedUnion("kind", [
  teacherAudienceScopeSchema,
  studentAudienceScopeObjectSchema,
]).superRefine((scope, context) => {
  if (scope.kind === "student") {
    rejectDuplicateStudentGroups(scope, context);
  }
});

export const audienceScopeErrorCodeSchema = z.enum([
  "audience_scope_missing",
  "audience_scope_invalid",
]);

export type TeacherAudienceScope = z.infer<typeof teacherAudienceScopeSchema>;
export type StudentAudienceScope = z.infer<typeof studentAudienceScopeSchema>;
export type AudienceScope = z.infer<typeof audienceScopeSchema>;
export type AudienceScopeErrorCode = z.infer<typeof audienceScopeErrorCodeSchema>;

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

export const publicPublishedScheduleNotificationSchema = z.object({
  studentGroupName: z.string().min(1),
  assignmentCount: z.number().int().nonnegative(),
  message: z.string().min(1),
}).strict();

export const publicPublishedScheduleNotificationsSchema = z.object({
  contractVersion: z.literal(1),
  batch: publicPublishedScheduleBatchSchema,
  notifications: z.array(publicPublishedScheduleNotificationSchema),
}).strict();

export type PublicPublishedScheduleNotification = z.infer<
  typeof publicPublishedScheduleNotificationSchema
>;
export type PublicPublishedScheduleNotificationsResponse = z.infer<
  typeof publicPublishedScheduleNotificationsSchema
>;

export interface TeacherUnavailableSlotsResponse {
  teacher: Teacher;
}

export interface CurrentTeacherAvailabilityResponse {
  teacher: Teacher;
  timeSlots: TimeSlot[];
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

export const publishedScheduleAssignmentViewSchema = z.object({
  assignment: scheduledExamSchema,
  examTask: examTaskSchema.nullable(),
  course: courseSchema.nullable(),
  studentGroups: z.array(studentGroupSchema),
  room: roomSchema.nullable(),
  timeSlot: timeSlotSchema.nullable(),
  teachers: z.array(teacherSchema),
}).strict();

const currentTeacherPublishedScheduleSchema = z.object({
  kind: z.literal("teacher"),
  audience: teacherAudienceScopeSchema,
  batch: examBatchSummarySchema,
  run: scheduleRunSummarySchema,
  assignments: z.array(publishedScheduleAssignmentViewSchema),
}).strict();

const currentStudentPublishedScheduleSchema = z.object({
  kind: z.literal("student"),
  audience: studentAudienceScopeSchema,
  batch: examBatchSummarySchema,
  run: scheduleRunSummarySchema,
  assignments: z.array(publishedScheduleAssignmentViewSchema),
}).strict();

export const currentPublishedScheduleSchema = z.discriminatedUnion("kind", [
  currentTeacherPublishedScheduleSchema,
  currentStudentPublishedScheduleSchema,
]);

export type CurrentPublishedScheduleResponse = z.infer<typeof currentPublishedScheduleSchema>;

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
