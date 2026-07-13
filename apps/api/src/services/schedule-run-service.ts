import {
  rescheduleReportSchema,
  type ScheduleDraftRescheduleResponse,
  type ScheduleInput,
  type ScheduleJobListQuery,
} from "@examforge/shared";
import { JobSubmissionService } from "@examforge/scheduling-application";
import type { PlatformRepository } from "../repository.js";
import type { SchedulerClient } from "../scheduler-client.js";
import { randomUUID } from "node:crypto";
export type ScheduleRunOverrides = Pick<
  ScheduleInput,
  "fixed_assignments" | "reschedule_context"
> & {
  constraintProfileVersionId?: string;
};

export interface ScheduleJobRequestContext {
  idempotencyKey?: string;
  traceId?: string;
  constraintProfileVersionId?: string;
  submittedBy?: string;
  submittedByUserId?: string;
}

export class ScheduleRunService {
  private readonly jobSubmissionService: JobSubmissionService;

  constructor(
    private readonly repository: PlatformRepository,
    private readonly scheduler: SchedulerClient,
  ) {
    this.jobSubmissionService = new JobSubmissionService(repository);
  }

  async createScheduleRun(overrides: ScheduleRunOverrides) {
    const referenceData = await this.repository.getReferenceData();
    const strategy = await this.repository.resolveConstraintProfile(
      overrides.constraintProfileVersionId,
    );
    let schedulerVersion = "unknown";
    const result = await this.scheduler.solve(
      withScheduleOverrides(referenceData.scheduleInput, overrides, strategy.snapshot.config),
      {
        requestId: `trace-${randomUUID()}`,
        onMetadata: (metadata) => {
          schedulerVersion = metadata.schedulerVersion;
        },
      },
    );
    return this.repository.createScheduleRun(result, {
      constraintProfileVersionId: strategy.versionId,
      constraintProfileSnapshot: strategy.snapshot,
      schedulerVersion,
    });
  }

  async createScheduleRunFromDraft(
    draftId: string,
  ): Promise<ScheduleDraftRescheduleResponse | "not_editable" | null> {
    const draft = await this.repository.getScheduleDraft(draftId);
    if (!draft) {
      return null;
    }
    if (draft.draft.status === "published" || draft.draft.status === "discarded") {
      return "not_editable";
    }

    const baselineAssignments = structuredClone(draft.assignments)
      .sort((left, right) => left.exam_task_id.localeCompare(right.exam_task_id));
    const lockedExamTaskIds = new Set(draft.lockedExamTaskIds ?? []);
    const referenceData = await this.repository.getReferenceData();
    const strategy = await this.repository.resolveConstraintProfile();
    let schedulerVersion = "unknown";
    const result = await this.scheduler.solve({
      ...referenceData.scheduleInput,
      constraint_profile: structuredClone(strategy.snapshot.config),
      fixed_assignments: [],
      reschedule_context: {
        baseline_assignments: baselineAssignments,
        movable_exam_task_ids: baselineAssignments
          .map((assignment) => assignment.exam_task_id)
          .filter((examTaskId) => !lockedExamTaskIds.has(examTaskId)),
      },
    }, {
      requestId: `trace-${randomUUID()}`,
      onMetadata: (metadata) => {
        schedulerVersion = metadata.schedulerVersion;
      },
    });
    const reschedule = rescheduleReportSchema.parse(result.report?.reschedule);
    const response = await this.repository.createScheduleRun(result, {
      constraintProfileVersionId: strategy.versionId,
      constraintProfileSnapshot: strategy.snapshot,
      schedulerVersion,
    });
    return {
      sourceDraftId: draftId,
      ...response,
      reschedule,
    };
  }

  async createScheduleJob(
    overrides: ScheduleRunOverrides,
    context: ScheduleJobRequestContext = {},
  ) {
    const referenceData = await this.repository.getReferenceData();
    const scheduleInput = withScheduleOverrides(referenceData.scheduleInput, overrides);
    const result = await this.jobSubmissionService.submit({
      batchId: referenceData.batch.id,
      input: scheduleInput,
      idempotencyKey: context.idempotencyKey ?? `job-request-${randomUUID()}`,
      traceId: context.traceId ?? `trace-${randomUUID()}`,
      constraintProfileVersionId: context.constraintProfileVersionId,
      submittedBy: context.submittedBy,
      submittedByUserId: context.submittedByUserId,
    });
    return result.job;
  }

  listScheduleJobs(query?: ScheduleJobListQuery) {
    return this.repository.listScheduleJobs(query);
  }

  getScheduleJobDetail(id: string) {
    return this.repository.getScheduleJobDetail(id);
  }

  cancelScheduleJob(id: string) {
    return this.repository.requestScheduleJobCancellation(id);
  }

}

function withScheduleOverrides(
  scheduleInput: ScheduleInput,
  overrides: ScheduleRunOverrides,
  constraintProfile = scheduleInput.constraint_profile,
): ScheduleInput {
  return {
    ...scheduleInput,
    constraint_profile: structuredClone(constraintProfile),
    fixed_assignments: overrides.fixed_assignments,
    reschedule_context: overrides.reschedule_context,
  };
}
