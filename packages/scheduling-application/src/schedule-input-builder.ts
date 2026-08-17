import {
  scheduleJobRequestSnapshotSchema,
  type ConstraintProfileSnapshot,
  type ParticipantSnapshot,
  type ScheduleDiagnostic,
  type ScheduleInput,
  type ScheduleJobRequestSnapshot,
} from "@examforge/shared";
import { createHash } from "node:crypto";
import type { ParticipantBatchContext } from "./contracts.js";
import {
  buildParticipantSnapshot,
  evaluateParticipantConsistency,
} from "./participant-data.js";

export type ScheduleInputParticipantErrorCode =
  | "participant_data_incomplete"
  | "participant_snapshot_stale"
  | "expected_count_exceeds_group_size"
  | "enrollment_mode_not_solvable";

/**
 * 参与者数据不满足求解前提时的稳定拒绝。
 * 属于输入/治理错误，不进入自动重试（设计 §10.2）。
 */
export class ScheduleInputParticipantError extends Error {
  constructor(
    readonly code: ScheduleInputParticipantErrorCode,
    message: string,
    readonly diagnostics: ScheduleDiagnostic[] = [],
  ) {
    super(message);
    this.name = "ScheduleInputParticipantError";
  }
}

export interface BuildScheduleInputCommand {
  referenceInput: ScheduleInput;
  constraintProfile: ConstraintProfileSnapshot;
  participant: ParticipantBatchContext;
}

export interface BuiltScheduleInput {
  input: ScheduleInput;
  participantSnapshot: ParticipantSnapshot;
}

/**
 * 第六版唯一的排考输入装配入口。同步排考、异步作业和增量重排共用它，
 * 保证参与者模式、重叠边、策略快照和参与者摘要来自同一次读取。
 */
export function buildScheduleInput(command: BuildScheduleInputCommand): BuiltScheduleInput {
  const { participant } = command;
  const report = evaluateParticipantConsistency(participant);
  const blocking = report.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );

  if (participant.state.mode === "groups_only" && blocking.length > 0) {
    throw new ScheduleInputParticipantError(
      "expected_count_exceeds_group_size",
      "An exam task expected count exceeds the capacity of its associated student groups.",
      report.diagnostics,
    );
  }

  if (participant.state.mode === "enrollments") {
    if (participant.state.status !== "complete" || participant.state.digest === null) {
      throw new ScheduleInputParticipantError(
        "participant_data_incomplete",
        "Enrollment participant data must be sealed before scheduling.",
        report.diagnostics,
      );
    }
    if (blocking.length > 0) {
      throw new ScheduleInputParticipantError(
        "participant_snapshot_stale",
        "Sealed participant data no longer matches the current batch facts.",
        report.diagnostics,
      );
    }

    // 第一阶段只冻结合同：个体互斥约束在第二阶段实现。
    // 在此之前，报名模式绝不允许退化为旧群体求解。
    throw new ScheduleInputParticipantError(
      "enrollment_mode_not_solvable",
      "Enrollment participant mode requires individual clash constraints that arrive in the"
      + " second phase; the request is rejected instead of falling back to group-only solving.",
      report.diagnostics,
    );
  }

  const input: ScheduleInput = {
    ...structuredClone(command.referenceInput),
    constraint_profile: structuredClone(command.constraintProfile.config),
    participant_mode: "groups_only",
    student_overlap_edges: [],
  };

  return {
    input,
    participantSnapshot: buildParticipantSnapshot({
      state: participant.state,
      studentCount: participant.data.students.length,
      enrollmentCount: report.activeEnrollments.length,
      overlapEdgeCount: report.overlapEdges.length,
    }),
  };
}

export interface BuiltScheduleJobRequest extends BuiltScheduleInput {
  requestSnapshot: ScheduleJobRequestSnapshot;
  requestDigest: string;
}

/**
 * 作业请求快照 v3：request digest 覆盖完整输入、策略快照和参与者快照，
 * 任何一处变化都会产生新的 digest。
 */
export function buildScheduleJobRequest(
  command: BuildScheduleInputCommand,
): BuiltScheduleJobRequest {
  const built = buildScheduleInput(command);
  const requestSnapshot = scheduleJobRequestSnapshotSchema.parse({
    version: 3,
    input: built.input,
    constraintProfile: command.constraintProfile,
    participantSnapshot: built.participantSnapshot,
  });
  return {
    ...built,
    requestSnapshot,
    requestDigest: digestScheduleJobRequest(requestSnapshot),
  };
}

export function digestScheduleJobRequest(snapshot: ScheduleJobRequestSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

/**
 * 历史快照兼容：v1 / v2 一律解释为 `groups_only` 且无重叠边。
 * 只在内存中规范化，不改写数据库中的原快照与原 request digest。
 */
export function normalizeScheduleInputFromSnapshot(
  snapshot: ScheduleJobRequestSnapshot,
): ScheduleInput {
  const input = structuredClone(snapshot.input);
  if (snapshot.version === 3) {
    return input;
  }
  return {
    ...input,
    participant_mode: "groups_only",
    student_overlap_edges: [],
  };
}

export function readParticipantSnapshot(
  snapshot: ScheduleJobRequestSnapshot,
): ParticipantSnapshot | null {
  return snapshot.version === 3 ? snapshot.participantSnapshot : null;
}
