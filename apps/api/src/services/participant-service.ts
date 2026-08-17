import {
  countEnrollmentsBySource,
  evaluateParticipantConsistency,
  type ParticipantBatchContext,
  type ParticipantStateRecord,
} from "@examforge/scheduling-application";
import type {
  ParticipantHealthSummary,
  ParticipantImportIssue,
  ParticipantImportRequest,
  ParticipantMode,
  ScheduleDiagnostic,
} from "@examforge/shared";
import type { PlatformRepository } from "../repository.js";

export type ParticipantCommandResult =
  | { resolution: "ok"; summary: ParticipantHealthSummary }
  | {
      resolution: "ok_imported";
      summary: ParticipantHealthSummary;
      imported: { students: number; enrollments: number };
    }
  | { resolution: "invalid_import"; issues: ParticipantImportIssue[] }
  | { resolution: "mode_invalid"; summary: ParticipantHealthSummary }
  | { resolution: "version_conflict"; summary: ParticipantHealthSummary }
  | {
      resolution: "incomplete";
      summary: ParticipantHealthSummary;
      diagnostics: ScheduleDiagnostic[];
    };

export interface ParticipantMutationContext {
  actorUsername: string;
  traceId: string;
}

/**
 * 参与者数据治理服务。模式切换、原子导入、seal 和重新打开都是高影响操作，
 * 审计只记录摘要，不保存任何名单。
 */
export class ParticipantService {
  constructor(private readonly repository: PlatformRepository) {}

  async getHealthSummary(): Promise<ParticipantHealthSummary> {
    const context = await this.repository.getParticipantContext();
    return summarizeParticipants(context);
  }

  async setMode(
    mode: ParticipantMode,
    context: ParticipantMutationContext,
  ): Promise<ParticipantCommandResult> {
    const before = (await this.repository.getParticipantContext()).state;
    const state = await this.repository.setParticipantMode({ mode });
    const summary = await this.getHealthSummary();
    if (state.dataVersion !== before.dataVersion || state.mode !== before.mode) {
      this.recordAudit("participant.mode.change", state, context, {
        previousMode: before.mode,
        previousStatus: before.status,
        previousVersion: before.dataVersion,
      });
    }
    return { resolution: "ok", summary };
  }

  async importData(
    request: ParticipantImportRequest,
    context: ParticipantMutationContext,
  ): Promise<ParticipantCommandResult> {
    const before = (await this.repository.getParticipantContext()).state;
    const result = await this.repository.importParticipantData({ request });

    if (result.resolution === "invalid") {
      this.recordAudit("participant.import.rejected", before, context, {
        previousStatus: before.status,
        previousVersion: before.dataVersion,
        issueCount: result.issues.length,
        result: "rejected",
      });
      return { resolution: "invalid_import", issues: result.issues };
    }
    if (result.resolution === "mode_invalid") {
      return { resolution: "mode_invalid", summary: await this.getHealthSummary() };
    }
    if (result.resolution === "version_conflict") {
      return { resolution: "version_conflict", summary: await this.getHealthSummary() };
    }

    this.recordAudit("participant.import", result.state, context, {
      previousStatus: before.status,
      previousVersion: before.dataVersion,
      studentCount: result.imported.students,
      enrollmentCount: result.imported.enrollments,
    });
    return {
      resolution: "ok_imported",
      summary: await this.getHealthSummary(),
      imported: result.imported,
    };
  }

  async seal(context: ParticipantMutationContext): Promise<ParticipantCommandResult> {
    const before = (await this.repository.getParticipantContext()).state;
    const result = await this.repository.sealParticipantData({
      sealedAt: new Date().toISOString(),
    });

    if (result.resolution === "mode_invalid") {
      return { resolution: "mode_invalid", summary: await this.getHealthSummary() };
    }
    if (result.resolution === "version_conflict") {
      return { resolution: "version_conflict", summary: await this.getHealthSummary() };
    }
    if (result.resolution === "incomplete") {
      this.recordAudit("participant.seal.rejected", result.state, context, {
        previousStatus: before.status,
        previousVersion: before.dataVersion,
        blockingDiagnosticCount: result.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error").length,
        result: "rejected",
      });
      return {
        resolution: "incomplete",
        summary: await this.getHealthSummary(),
        diagnostics: result.diagnostics,
      };
    }

    const summary = await this.getHealthSummary();
    this.recordAudit("participant.seal", result.state, context, {
      previousStatus: before.status,
      previousVersion: before.dataVersion,
      studentCount: summary.activeStudentCount,
      enrollmentCount: summary.activeEnrollmentCount,
      overlapEdgeCount: summary.overlapEdgeCount,
      digest: result.state.digest,
    });
    return { resolution: "ok", summary };
  }

  async reopen(context: ParticipantMutationContext): Promise<ParticipantCommandResult> {
    const before = (await this.repository.getParticipantContext()).state;
    const state = await this.repository.reopenParticipantData();
    if (state.dataVersion !== before.dataVersion) {
      this.recordAudit("participant.reopen", state, context, {
        previousStatus: before.status,
        previousVersion: before.dataVersion,
      });
    }
    return { resolution: "ok", summary: await this.getHealthSummary() };
  }

  private recordAudit(
    action: string,
    state: ParticipantStateRecord,
    context: ParticipantMutationContext,
    payload: Record<string, unknown>,
  ) {
    void this.repository.recordAuditEvent?.(
      action,
      "participant_data",
      state.batchId,
      {
        traceId: context.traceId,
        mode: state.mode,
        status: state.status,
        version: state.dataVersion,
        ...payload,
      },
      context.actorUsername,
    );
  }
}

export function summarizeParticipants(
  context: ParticipantBatchContext,
): ParticipantHealthSummary {
  const report = evaluateParticipantConsistency(context);
  return {
    batchId: context.state.batchId,
    mode: context.state.mode,
    status: context.state.status,
    dataVersion: context.state.dataVersion,
    digest: context.state.digest,
    sealedAt: context.state.sealedAt,
    studentCount: context.data.students.length,
    activeStudentCount: context.data.students
      .filter((student) => student.status === "active").length,
    enrollmentCount: context.data.enrollments.length,
    activeEnrollmentCount: report.activeEnrollments.length,
    examTaskCount: context.examTasks.length,
    coveredExamTaskCount: report.enrollmentCountsByExamTask.size,
    overlapEdgeCount: report.overlapEdges.length,
    enrollmentSourceCounts: countEnrollmentsBySource(report.activeEnrollments),
    diagnostics: report.diagnostics,
  };
}
