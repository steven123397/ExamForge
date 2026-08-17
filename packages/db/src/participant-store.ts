import type {
  ParticipantBatchContext,
  ParticipantStateRecord,
} from "@examforge/scheduling-application";
import { compareCanonicalIdentifier } from "@examforge/shared";
import { desc, eq, inArray } from "drizzle-orm";
import type { ExamForgeDatabase } from "./client.js";
import {
  examBatches,
  examEnrollments,
  examTaskStudentGroups,
  examTasks,
  studentGroups,
  students,
} from "./schema.js";

export type ExamBatchRow = typeof examBatches.$inferSelect;

export function toParticipantState(batch: ExamBatchRow): ParticipantStateRecord {
  return {
    batchId: batch.id,
    mode: batch.participantMode,
    status: batch.participantDataStatus,
    dataVersion: batch.participantDataVersion,
    digest: batch.participantDataDigest,
    sealedAt: batch.participantDataSealedAt?.toISOString() ?? null,
  };
}

export async function resolveActiveBatch(
  db: ExamForgeDatabase,
  options: { forUpdate?: boolean } = {},
): Promise<ExamBatchRow> {
  const query = db.select().from(examBatches).orderBy(desc(examBatches.createdAt)).limit(1);
  const [batch] = options.forUpdate ? await query.for("update") : await query;
  if (!batch) {
    throw new Error("No exam batch found. Run the database seed script first.");
  }
  return batch;
}

export async function lockBatchById(
  db: ExamForgeDatabase,
  batchId: string,
): Promise<ExamBatchRow> {
  const [batch] = await db
    .select()
    .from(examBatches)
    .where(eq(examBatches.id, batchId))
    .limit(1)
    .for("update");
  if (!batch) {
    throw new Error(`Exam batch ${batchId} does not exist.`);
  }
  return batch;
}

/**
 * 参与者事实的结构化读取。仓储只负责读，
 * 重叠边生成、人数核对和 digest 计算全部在 application 层完成。
 */
export async function readParticipantBatchContext(
  db: ExamForgeDatabase,
  batch: ExamBatchRow,
): Promise<ParticipantBatchContext> {
  const [examTaskRows, examTaskGroupRows, studentGroupRows] = await Promise.all([
    db.select().from(examTasks).where(eq(examTasks.batchId, batch.id)),
    db.select().from(examTaskStudentGroups),
    db.select().from(studentGroups),
  ]);
  const batchExamTaskIds = examTaskRows.map((task) => task.id);
  const [studentRows, enrollmentRows] = await Promise.all([
    db.select().from(students),
    batchExamTaskIds.length > 0
      ? db.select().from(examEnrollments)
        .where(inArray(examEnrollments.examTaskId, batchExamTaskIds))
      : Promise.resolve([] as Array<typeof examEnrollments.$inferSelect>),
  ]);

  const groupsByExamTask = new Map<string, string[]>();
  for (const row of examTaskGroupRows) {
    const bucket = groupsByExamTask.get(row.examTaskId) ?? [];
    bucket.push(row.studentGroupId);
    groupsByExamTask.set(row.examTaskId, bucket);
  }

  return {
    state: toParticipantState(batch),
    examTasks: examTaskRows
      .map((task) => ({
        id: task.id,
        expectedCount: task.expectedCount,
        studentGroupIds: (groupsByExamTask.get(task.id) ?? []).sort(compareCanonicalIdentifier),
      }))
      .sort((left, right) => compareCanonicalIdentifier(left.id, right.id)),
    studentGroupSizes: new Map(studentGroupRows.map((group) => [group.id, group.size])),
    data: {
      students: studentRows.map((student) => ({
        id: student.id,
        displayCode: student.displayCode,
        primaryStudentGroupId: student.primaryStudentGroupId,
        status: student.status,
      })),
      enrollments: enrollmentRows.map((enrollment) => ({
        examTaskId: enrollment.examTaskId,
        studentId: enrollment.studentId,
        source: enrollment.source,
        status: enrollment.status,
      })),
    },
  };
}
