import {
  compareCanonicalIdentifier,
  maxOverlapSampleParticipants,
  type EnrollmentSource,
  type EnrollmentStatus,
  type ExamEnrollment,
  type ParticipantDataStatus,
  type ParticipantImportIssue,
  type ParticipantImportRequest,
  type ParticipantMode,
  type ParticipantSnapshot,
  type ScheduleDiagnostic,
  type Student,
  type StudentOverlapEdge,
  type StudentStatus,
} from "@examforge/shared";
import { createHash } from "node:crypto";

export interface ParticipantStateRecord {
  batchId: string;
  mode: ParticipantMode;
  status: ParticipantDataStatus;
  dataVersion: number;
  digest: string | null;
  sealedAt: string | null;
}

export interface StudentRecord {
  id: string;
  displayCode: string | null;
  primaryStudentGroupId: string | null;
  status: StudentStatus;
}

export interface ExamEnrollmentRecord {
  examTaskId: string;
  studentId: string;
  source: EnrollmentSource;
  status: EnrollmentStatus;
}

/**
 * 参与者事实的结构化读取结果。仓储只负责提供它，
 * 边生成、人数核对和 digest 计算全部在本模块完成。
 */
export interface ParticipantDataSet {
  students: StudentRecord[];
  enrollments: ExamEnrollmentRecord[];
}

export interface ParticipantValidationContext {
  examTaskIds: Set<string>;
  studentGroupIds: Set<string>;
  existingStudentIds: Set<string>;
  /** Maps an existing non-null display_code to its owning student_id. */
  existingStudentDisplayCodeOwners: ReadonlyMap<string, string>;
}

export interface NormalizedParticipantImport {
  students: StudentRecord[];
  enrollments: ExamEnrollmentRecord[];
}

export interface ParticipantImportValidation {
  issues: ParticipantImportIssue[];
  normalized: NormalizedParticipantImport;
}

/**
 * 整批原子导入的全量校验。任何一条非法行都会阻止整批写入，
 * 调用方必须在写事务内使用同一个上下文快照。
 */
export function validateParticipantImport(
  request: ParticipantImportRequest,
  context: ParticipantValidationContext,
): ParticipantImportValidation {
  const issues: ParticipantImportIssue[] = [];
  const students: StudentRecord[] = [];
  const seenStudentIds = new Set<string>();
  const seenDisplayCodeOwners = new Map<string, string>();

  for (const [index, student] of request.students.entries()) {
    if (seenStudentIds.has(student.id)) {
      issues.push({
        index,
        path: `students.${index}.id`,
        code: "student_duplicate",
        message: `student_id ${student.id} appears more than once in the payload`,
      });
      continue;
    }
    seenStudentIds.add(student.id);

    if (student.display_code !== null) {
      const payloadOwner = seenDisplayCodeOwners.get(student.display_code);
      if (payloadOwner !== undefined) {
        issues.push({
          index,
          path: `students.${index}.display_code`,
          code: "student_duplicate",
          message: `display_code ${student.display_code} appears more than once in the payload`,
        });
        continue;
      }
      const existingOwner = context.existingStudentDisplayCodeOwners.get(student.display_code);
      if (existingOwner !== undefined && existingOwner !== student.id) {
        issues.push({
          index,
          path: `students.${index}.display_code`,
          code: "student_duplicate",
          message:
            `display_code ${student.display_code} is already assigned to student_id ${existingOwner}`,
        });
        continue;
      }
      seenDisplayCodeOwners.set(student.display_code, student.id);
    }

    if (
      student.primary_student_group_id !== null
      && !context.studentGroupIds.has(student.primary_student_group_id)
    ) {
      issues.push({
        index,
        path: `students.${index}.primary_student_group_id`,
        code: "student_group_reference_invalid",
        message:
          `student_group_id ${student.primary_student_group_id} does not exist`,
      });
      continue;
    }

    students.push(toStudentRecord(student));
  }

  const knownStudentIds = new Set([...context.existingStudentIds, ...seenStudentIds]);
  const enrollments: ExamEnrollmentRecord[] = [];
  const seenEnrollmentKeys = new Set<string>();

  for (const [index, enrollment] of request.enrollments.entries()) {
    const key = `${enrollment.exam_task_id}.${enrollment.student_id}`;
    if (seenEnrollmentKeys.has(key)) {
      issues.push({
        index,
        path: `enrollments.${index}`,
        code: "enrollment_duplicate",
        message:
          `enrollment (${enrollment.exam_task_id}, ${enrollment.student_id}) `
          + "appears more than once in the payload",
      });
      continue;
    }
    seenEnrollmentKeys.add(key);

    if (!context.examTaskIds.has(enrollment.exam_task_id)) {
      issues.push({
        index,
        path: `enrollments.${index}.exam_task_id`,
        code: "exam_task_reference_invalid",
        message:
          `exam_task_id ${enrollment.exam_task_id} does not exist in the current batch`,
      });
      continue;
    }

    if (!knownStudentIds.has(enrollment.student_id)) {
      issues.push({
        index,
        path: `enrollments.${index}.student_id`,
        code: "student_reference_invalid",
        message: `student_id ${enrollment.student_id} does not exist`,
      });
      continue;
    }

    enrollments.push(toEnrollmentRecord(enrollment));
  }

  return { issues, normalized: { students, enrollments } };
}

function toStudentRecord(student: Student): StudentRecord {
  return {
    id: student.id,
    displayCode: student.display_code,
    primaryStudentGroupId: student.primary_student_group_id,
    status: student.status,
  };
}

function toEnrollmentRecord(enrollment: ExamEnrollment): ExamEnrollmentRecord {
  return {
    examTaskId: enrollment.exam_task_id,
    studentId: enrollment.student_id,
    source: enrollment.source,
    status: enrollment.status,
  };
}

export function selectActiveEnrollments(
  data: ParticipantDataSet,
): ExamEnrollmentRecord[] {
  const disabledStudentIds = new Set(
    data.students.filter((student) => student.status === "disabled").map((student) => student.id),
  );
  return data.enrollments
    .filter((enrollment) => enrollment.status === "active")
    .filter((enrollment) => !disabledStudentIds.has(enrollment.studentId))
    .sort((left, right) => (
      compareCanonicalIdentifier(left.examTaskId, right.examTaskId)
      || compareCanonicalIdentifier(left.studentId, right.studentId)
    ));
}

/**
 * 从有效报名确定性派生 exam-exam 重叠边。
 * 这是第六版唯一的边生成实现，不允许在仓储或 Web 层复制。
 */
export function buildStudentOverlapEdges(
  enrollments: readonly ExamEnrollmentRecord[],
): StudentOverlapEdge[] {
  const examTasksByStudent = new Map<string, Array<{ examTaskId: string; source: EnrollmentSource }>>();
  for (const enrollment of enrollments) {
    const bucket = examTasksByStudent.get(enrollment.studentId) ?? [];
    bucket.push({ examTaskId: enrollment.examTaskId, source: enrollment.source });
    examTasksByStudent.set(enrollment.studentId, bucket);
  }

  const edges = new Map<string, {
    examTaskIdA: string;
    examTaskIdB: string;
    overlapCount: number;
    samples: Array<{ studentId: string; sourceA: EnrollmentSource; sourceB: EnrollmentSource }>;
  }>();

  for (const [studentId, entries] of [...examTasksByStudent.entries()].sort(
    ([left], [right]) => compareCanonicalIdentifier(left, right),
  )) {
    const sorted = [...entries].sort((left, right) => (
      compareCanonicalIdentifier(left.examTaskId, right.examTaskId)
    ));
    for (let first = 0; first < sorted.length; first += 1) {
      for (let second = first + 1; second < sorted.length; second += 1) {
        const a = sorted[first];
        const b = sorted[second];
        if (a.examTaskId === b.examTaskId) {
          continue;
        }
        const key = `${a.examTaskId}.${b.examTaskId}`;
        const edge = edges.get(key) ?? {
          examTaskIdA: a.examTaskId,
          examTaskIdB: b.examTaskId,
          overlapCount: 0,
          samples: [],
        };
        edge.overlapCount += 1;
        if (edge.samples.length < maxOverlapSampleParticipants) {
          edge.samples.push({ studentId, sourceA: a.source, sourceB: b.source });
        }
        edges.set(key, edge);
      }
    }
  }

  return [...edges.values()]
    .sort((left, right) => (
      compareCanonicalIdentifier(left.examTaskIdA, right.examTaskIdA)
      || compareCanonicalIdentifier(left.examTaskIdB, right.examTaskIdB)
    ))
    .map((edge) => ({
      exam_task_id_a: edge.examTaskIdA,
      exam_task_id_b: edge.examTaskIdB,
      overlap_count: edge.overlapCount,
      sample_participants: [...edge.samples]
        .sort((left, right) => compareCanonicalIdentifier(left.studentId, right.studentId))
        .map((sample) => ({
          student_id: sample.studentId,
          exam_a_source: sample.sourceA,
          exam_b_source: sample.sourceB,
        })),
    }));
}

export function countEnrollmentsByExamTask(
  enrollments: readonly ExamEnrollmentRecord[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const enrollment of enrollments) {
    counts.set(enrollment.examTaskId, (counts.get(enrollment.examTaskId) ?? 0) + 1);
  }
  return counts;
}

export function countEnrollmentsBySource(
  enrollments: readonly ExamEnrollmentRecord[],
): Record<EnrollmentSource, number> {
  const counts: Record<EnrollmentSource, number> = {
    regular: 0,
    elective: 0,
    retake: 0,
    other: 0,
  };
  for (const enrollment of enrollments) {
    counts[enrollment.source] += 1;
  }
  return counts;
}

/**
 * 规范化参与者数据摘要。digest 覆盖有效报名、来源解释和学生状态，
 * 任何报名变化都会让旧 digest 失效。
 */
export function digestParticipantData(input: {
  batchId: string;
  mode: ParticipantMode;
  dataVersion: number;
  students: readonly StudentRecord[];
  enrollments: readonly ExamEnrollmentRecord[];
  overlapEdges: readonly StudentOverlapEdge[];
}): string {
  const canonical = {
    schemaVersion: 1,
    batchId: input.batchId,
    mode: input.mode,
    dataVersion: input.dataVersion,
    students: [...input.students]
      .filter((student) => student.status === "active")
      .sort((left, right) => compareCanonicalIdentifier(left.id, right.id))
      .map((student) => [student.id, student.primaryStudentGroupId ?? ""]),
    enrollments: [...input.enrollments]
      .sort((left, right) => (
        compareCanonicalIdentifier(left.examTaskId, right.examTaskId)
        || compareCanonicalIdentifier(left.studentId, right.studentId)
      ))
      .map((enrollment) => [enrollment.examTaskId, enrollment.studentId, enrollment.source]),
    overlapEdges: [...input.overlapEdges]
      .sort((left, right) => (
        compareCanonicalIdentifier(left.exam_task_id_a, right.exam_task_id_a)
        || compareCanonicalIdentifier(left.exam_task_id_b, right.exam_task_id_b)
      ))
      .map((edge) => [
        edge.exam_task_id_a,
        edge.exam_task_id_b,
        edge.overlap_count,
      ]),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface ParticipantConsistencyInput {
  state: ParticipantStateRecord;
  examTasks: ReadonlyArray<{
    id: string;
    expectedCount: number;
    studentGroupIds: readonly string[];
  }>;
  studentGroupSizes: ReadonlyMap<string, number>;
  data: ParticipantDataSet;
  /**
   * seal 会在同一事务内按有效报名数回写 `expected_count`，
   * 因此只对将被回写的考试抑制 `expected_count_mismatch`；
   * 其余不一致（无报名、停用学生、跨批次引用）仍然阻止完成状态。
   */
  applyExpectedCountWriteBack?: boolean;
}

export interface ParticipantConsistencyReport {
  diagnostics: ScheduleDiagnostic[];
  activeEnrollments: ExamEnrollmentRecord[];
  overlapEdges: StudentOverlapEdge[];
  enrollmentCountsByExamTask: Map<string, number>;
}

/**
 * 人数一致性与引用一致性检查，覆盖设计 §5.4 与 §6.2 的检查项。
 * 返回的诊断使用稳定代码，UI 与 API 都依据代码决定行为。
 */
export function evaluateParticipantConsistency(
  input: ParticipantConsistencyInput,
): ParticipantConsistencyReport {
  const diagnostics: ScheduleDiagnostic[] = [];
  const activeEnrollments = selectActiveEnrollments(input.data);
  const enrollmentCountsByExamTask = countEnrollmentsByExamTask(activeEnrollments);
  const overlapEdges = input.state.mode === "enrollments"
    ? buildStudentOverlapEdges(activeEnrollments)
    : [];

  if (input.state.mode === "groups_only") {
    for (const task of input.examTasks) {
      const groupSize = [...new Set(task.studentGroupIds)]
        .reduce((total, groupId) => total + (input.studentGroupSizes.get(groupId) ?? 0), 0);
      if (task.expectedCount > groupSize) {
        diagnostics.push({
          code: "expected_count_exceeds_group_size",
          severity: "error",
          resource_dimension: "exam_task",
          affected_ids: [task.id],
          shortfall: task.expectedCount - groupSize,
          message: `考试 ${task.id} 的预计人数 ${task.expectedCount} 超过关联群体总人数 ${groupSize}。`,
          suggestion: "调整预计人数或修正关联的学生群体。",
        });
      } else if (task.expectedCount < groupSize) {
        diagnostics.push({
          code: "expected_count_lower_than_group_size",
          severity: "warning",
          resource_dimension: "exam_task",
          affected_ids: [task.id],
          shortfall: groupSize - task.expectedCount,
          message: `考试 ${task.id} 的预计人数 ${task.expectedCount} 小于关联群体总人数 ${groupSize}。`,
          suggestion: "群体模式只保证群体级互斥，请确认该考试确实只覆盖部分学生。",
        });
      }
    }
    return { diagnostics, activeEnrollments, overlapEdges, enrollmentCountsByExamTask };
  }

  if (input.examTasks.length === 0) {
    diagnostics.push({
      code: "participant_data_incomplete",
      severity: "error",
      resource_dimension: "participant_data",
      affected_ids: [input.state.batchId],
      shortfall: 1,
      message: "当前批次没有考试任务，无法声明报名数据完整。",
      suggestion: "先创建考试任务，再导入报名数据。",
    });
  }

  const disabledStudentIds = new Set(
    input.data.students
      .filter((student) => student.status === "disabled")
      .map((student) => student.id),
  );
  const disabledWithEnrollments = [...new Set(
    input.data.enrollments
      .filter((enrollment) => enrollment.status === "active")
      .filter((enrollment) => disabledStudentIds.has(enrollment.studentId))
      .map((enrollment) => enrollment.studentId),
  )].sort();
  if (disabledWithEnrollments.length > 0) {
    diagnostics.push({
      code: "student_enrollment_reference_invalid",
      severity: "error",
      resource_dimension: "student",
      affected_ids: disabledWithEnrollments,
      shortfall: disabledWithEnrollments.length,
      message: `${disabledWithEnrollments.length} 名已停用学生仍持有有效报名。`,
      suggestion: "撤回这些报名或重新启用对应学生。",
    });
  }

  for (const task of input.examTasks) {
    const actual = enrollmentCountsByExamTask.get(task.id) ?? 0;
    if (actual === 0) {
      diagnostics.push({
        code: "participant_data_incomplete",
        severity: "error",
        resource_dimension: "exam_task",
        affected_ids: [task.id],
        shortfall: 1,
        message: `考试 ${task.id} 没有任何有效报名。`,
        suggestion: "导入该考试的报名名单后再执行 seal。",
      });
      continue;
    }
    if (actual !== task.expectedCount && !input.applyExpectedCountWriteBack) {
      diagnostics.push({
        code: "expected_count_mismatch",
        severity: "error",
        resource_dimension: "exam_task",
        affected_ids: [task.id],
        shortfall: Math.abs(actual - task.expectedCount),
        message: `考试 ${task.id} 的预计人数 ${task.expectedCount} 与有效报名数 ${actual} 不一致。`,
        suggestion: "seal 会按有效报名数回写预计人数；请确认报名名单已完整。",
      });
    }
  }

  const knownExamTaskIds = new Set(input.examTasks.map((task) => task.id));
  const foreignExamTaskIds = [...new Set(
    activeEnrollments
      .map((enrollment) => enrollment.examTaskId)
      .filter((examTaskId) => !knownExamTaskIds.has(examTaskId)),
  )].sort();
  if (foreignExamTaskIds.length > 0) {
    diagnostics.push({
      code: "student_enrollment_reference_invalid",
      severity: "error",
      resource_dimension: "exam_task",
      affected_ids: foreignExamTaskIds,
      shortfall: foreignExamTaskIds.length,
      message: `${foreignExamTaskIds.length} 个报名引用了不属于当前批次的考试任务。`,
      suggestion: "移除跨批次报名后重新导入。",
    });
  }

  for (const edge of overlapEdges) {
    if (
      !knownExamTaskIds.has(edge.exam_task_id_a)
      || !knownExamTaskIds.has(edge.exam_task_id_b)
    ) {
      diagnostics.push({
        code: "student_overlap_edge_invalid",
        severity: "error",
        resource_dimension: "exam_task",
        affected_ids: [edge.exam_task_id_a, edge.exam_task_id_b],
        shortfall: edge.overlap_count,
        message: "重叠边引用了当前批次之外的考试任务。",
        suggestion: "修正报名数据后重新生成重叠边。",
      });
    }
  }

  return { diagnostics, activeEnrollments, overlapEdges, enrollmentCountsByExamTask };
}

export function buildParticipantSnapshot(input: {
  state: ParticipantStateRecord;
  studentCount: number;
  enrollmentCount: number;
  overlapEdgeCount: number;
}): ParticipantSnapshot {
  if (input.state.mode === "groups_only") {
    return {
      schemaVersion: 1,
      batchId: input.state.batchId,
      mode: "groups_only",
      dataVersion: input.state.dataVersion,
      digest: null,
      studentCount: input.studentCount,
      enrollmentCount: 0,
      overlapEdgeCount: 0,
    };
  }
  return {
    schemaVersion: 1,
    batchId: input.state.batchId,
    mode: "enrollments",
    dataVersion: input.state.dataVersion,
    digest: input.state.digest,
    studentCount: input.studentCount,
    enrollmentCount: input.enrollmentCount,
    overlapEdgeCount: input.overlapEdgeCount,
  };
}
