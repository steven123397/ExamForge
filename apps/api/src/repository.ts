import {
  demoBatch,
  demoScheduleInput,
  type AuditEventListResponse,
  type AuditEventFilter,
  type AuditEventSummary,
  type DashboardResponse,
  type PublishedScheduleResponse,
  type ReferenceDeleteResponse,
  type ReferenceImportResponse,
  type ReferenceRecord,
  type ReferenceDataResponse,
  type ReferenceResource,
  type ConflictRecord,
  type ScheduleDraftChangeEvent,
  type ScheduleDraftAdjustmentSuggestionsResponse,
  type ScheduleDraftComparisonResponse,
  type ScheduleDraftDetailResponse,
  type ScheduleDraftDiscardResponse,
  type ScheduleDraftListResponse,
  type ScheduleDraftPublishResponse,
  type ScheduleDraftSummary,
  type ScheduleJobSummary,
  type ScheduleJobError,
  type ScheduleJobStatus,
  type ScheduleRunComparisonResponse,
  type ScheduleRunListResponse,
  type ScheduleRollbackResponse,
  type ScheduleResult,
  type ScheduleRunResponse,
  type ScheduleRunSummary,
  type UserRole,
  resolveScheduleJobTransition,
  scheduleJobStatusForSolveResult,
} from "@examforge/shared";
import { randomUUID } from "node:crypto";
import type { PasswordHash } from "./auth/security.js";
import { getCurrentAuthContext } from "./auth/request-context.js";

export interface PlatformRepository {
  readonly storageMode: "memory" | "postgres";
  checkReadiness(): Promise<void>;
  getDashboard(): Promise<DashboardResponse>;
  getReferenceData(): Promise<ReferenceDataResponse>;
  createReferenceRecord(resource: ReferenceResource, record: ReferenceRecord): Promise<ReferenceRecord>;
  updateReferenceRecord(
    resource: ReferenceResource,
    id: string,
    patch: Partial<ReferenceRecord>,
  ): Promise<ReferenceRecord | null>;
  importReferenceRecords(
    resource: ReferenceResource,
    records: ReferenceRecord[],
  ): Promise<ReferenceImportResponse>;
  deleteReferenceRecord(resource: ReferenceResource, id: string): Promise<ReferenceDeleteResponse | null>;
  createScheduleRun(result: ScheduleResult): Promise<ScheduleRunResponse>;
  listScheduleRuns(): Promise<ScheduleRunListResponse>;
  getScheduleRun(id: string): Promise<ScheduleRunResponse | null>;
  compareScheduleRuns(
    baseId: string,
    targetId: string,
  ): Promise<ScheduleRunComparisonResponse | null>;
  listAuditEvents(filter?: AuditEventFilter): Promise<AuditEventListResponse>;
  recordAuditEvent?(
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
    actor?: string,
  ): Promise<void> | void;
  publishScheduleRun(id: string): Promise<PublishScheduleRunResult>;
  getPublishedSchedule(): Promise<PublishedScheduleResponse | null>;
  rollbackPublishedSchedule(): Promise<ScheduleRollbackResponse>;
  createScheduleDraftFromRun(id: string): Promise<ScheduleDraftDetailResponse | null>;
  listScheduleDrafts(): Promise<ScheduleDraftListResponse>;
  getScheduleDraft(id: string): Promise<ScheduleDraftDetailResponse | null>;
  updateScheduleDraftAssignment(
    id: string,
    examTaskId: string,
    patch: Partial<ScheduleResult["assignments"][number]>,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | "assignment_locked" | null>;
  validateScheduleDraft(id: string): Promise<ScheduleDraftDetailResponse | "not_editable" | null>;
  compareScheduleDraft(id: string): Promise<ScheduleDraftComparisonResponse | null>;
  suggestScheduleDraftAssignment(
    id: string,
    examTaskId: string,
  ): Promise<ScheduleDraftAdjustmentSuggestionsResponse | null>;
  lockScheduleDraftAssignment(
    id: string,
    examTaskId: string,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | null>;
  unlockScheduleDraftAssignment(
    id: string,
    examTaskId: string,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | null>;
  rebalanceScheduleDraft(id: string): Promise<ScheduleDraftDetailResponse | "not_editable" | null>;
  publishScheduleDraft(id: string): Promise<ScheduleDraftPublishResponse | "conflict" | "not_publishable" | null>;
  discardScheduleDraft(id: string): Promise<ScheduleDraftDiscardResponse | "not_discardable" | null>;
  createScheduleJob(command: CreateScheduleJobCommand): Promise<CreateScheduleJobResult>;
  listScheduleJobs(): Promise<{ jobs: ScheduleJobSummary[] }>;
  getScheduleJob(id: string): Promise<ScheduleJobSummary | null>;
  transitionScheduleJob(
    id: string,
    command: TransitionScheduleJobCommand,
  ): Promise<ScheduleJobTransitionResult>;
  completeScheduleJob(id: string, result: ScheduleResult): Promise<ScheduleJobTransitionResult>;
  createAuthUser(command: CreateAuthUserCommand): Promise<AuthUserRecord>;
  findAuthUserByUsername(username: string): Promise<AuthUserRecord | null>;
  createAuthSession(command: CreateAuthSessionCommand): Promise<AuthSessionRecord>;
  findAuthSessionByTokenDigest(tokenDigest: string): Promise<AuthSessionWithUser | null>;
  revokeAuthSession(id: string, revokedAt: string): Promise<boolean>;
  recoverInterruptedScheduleJobs?(): Promise<ScheduleJobSummary[]>;
  close?(): Promise<void>;
}

export interface AuthUserRecord {
  id: string;
  username: string;
  displayName: string;
  active: boolean;
  roles: UserRole[];
  password: PasswordHash;
}

export interface CreateAuthUserCommand extends AuthUserRecord {}

export interface CreateAuthSessionCommand {
  id: string;
  userId: string;
  tokenDigest: string;
  createdAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface AuthSessionRecord extends CreateAuthSessionCommand {
  revokedAt: string | null;
  lastSeenAt: string;
}

export interface AuthSessionWithUser {
  session: AuthSessionRecord;
  user: AuthUserRecord;
}

export interface CreateScheduleJobCommand {
  batchId: string;
  idempotencyKey: string;
  requestDigest: string;
  traceId: string;
}

export interface CreateScheduleJobResult {
  job: ScheduleJobSummary;
  created: boolean;
}

export interface TransitionScheduleJobCommand {
  to: ScheduleJobStatus;
  progress: number;
  error?: ScheduleJobError | null;
}

export interface ScheduleJobTransitionResult {
  job: ScheduleJobSummary | null;
  resolution: "apply" | "idempotent" | "reject" | "not_found";
}

export class ScheduleJobIdempotencyConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Schedule job idempotency key ${idempotencyKey} was reused with a different request.`);
    this.name = "ScheduleJobIdempotencyConflictError";
  }
}

export type PublishScheduleRunResult = PublishedScheduleResponse | "not_publishable" | null;

export class ReferenceIntegrityError extends Error {
  constructor(readonly issues: string[]) {
    super("Reference data integrity violation.");
    this.name = "ReferenceIntegrityError";
  }
}

export class InMemoryPlatformRepository implements PlatformRepository {
  readonly storageMode = "memory" as const;
  private runs = new Map<string, ScheduleRunResponse>();
  private drafts = new Map<string, ScheduleDraftDetailResponse>();
  private draftLocks = new Map<string, Set<string>>();
  private scheduleJobs = new Map<string, ScheduleJobSummary>();
  private scheduleJobAttempts = new Map<string, number>();
  private scheduleJobEvents: Array<Record<string, unknown>> = [];
  private outboxEvents: Array<Record<string, unknown>> = [];
  private authUsers = new Map<string, AuthUserRecord>();
  private authSessions = new Map<string, AuthSessionRecord>();
  private auditEvents: AuditEventSummary[] = [];
  private batch = structuredClone(demoBatch);
  private publishedRunId: string | null = null;
  private scheduleInput = structuredClone(demoScheduleInput);

  constructor(options: { authUsers?: AuthUserRecord[] } = {}) {
    for (const user of options.authUsers ?? []) {
      this.authUsers.set(user.id, structuredClone(user));
    }
  }

  async checkReadiness(): Promise<void> {}

  async getDashboard(): Promise<DashboardResponse> {
    const latestRun = Array.from(this.runs.values()).at(-1)?.run ?? null;
    return {
      batch: this.batch,
      metrics: {
        examTaskCount: this.scheduleInput.exam_tasks.length,
        teacherCount: this.scheduleInput.teachers.length,
        roomCount: this.scheduleInput.rooms.length,
        timeSlotCount: this.scheduleInput.time_slots.length,
        conflictCount: latestRun?.conflictCount ?? 0,
        score: latestRun?.score ?? null,
      },
      latestRun,
    };
  }

  async getReferenceData(): Promise<ReferenceDataResponse> {
    return {
      batch: this.batch,
      scheduleInput: this.scheduleInput,
    };
  }

  async createReferenceRecord(
    resource: ReferenceResource,
    record: ReferenceRecord,
  ): Promise<ReferenceRecord> {
    validateReferenceRecord(resource, record, this.scheduleInput);
    const collection = this.getCollection(resource);
    collection.push(record as never);
    return record;
  }

  async updateReferenceRecord(
    resource: ReferenceResource,
    id: string,
    patch: Partial<ReferenceRecord>,
  ): Promise<ReferenceRecord | null> {
    const collection = this.getCollection(resource);
    const index = collection.findIndex((record) => record.id === id);
    if (index === -1) {
      return null;
    }
    const nextRecord = {
      ...collection[index],
      ...patch,
      id,
    } as never;
    validateReferenceRecord(resource, nextRecord as ReferenceRecord, this.scheduleInput);
    collection[index] = nextRecord;
    return collection[index] as ReferenceRecord;
  }

  async importReferenceRecords(
    resource: ReferenceResource,
    records: ReferenceRecord[],
  ): Promise<ReferenceImportResponse> {
    const collection = this.getCollection(resource);
    const imported = records.map((record) => {
      validateReferenceRecord(resource, record, this.scheduleInput);
      const index = collection.findIndex((item) => item.id === record.id);
      if (index === -1) {
        collection.push(record as never);
        return record;
      }
      collection[index] = record as never;
      return collection[index] as ReferenceRecord;
    });
    return { resource, records: imported };
  }

  async deleteReferenceRecord(
    resource: ReferenceResource,
    id: string,
  ): Promise<ReferenceDeleteResponse | null> {
    validateReferenceDelete(resource, id, this.scheduleInput);
    const collection = this.getCollection(resource);
    const index = collection.findIndex((record) => record.id === id);
    if (index === -1) {
      return null;
    }
    const [deleted] = collection.splice(index, 1);
    return {
      resource,
      deleted: deleted as ReferenceRecord,
    };
  }

  async createScheduleRun(result: ScheduleResult): Promise<ScheduleRunResponse> {
    return this.createScheduleRunInternal(result);
  }

  private createScheduleRunInternal(result: ScheduleResult): ScheduleRunResponse {
    const id = `run-${randomUUID()}`;
    const run: ScheduleRunSummary = {
      id,
      status: result.statistics.status,
      createdAt: new Date().toISOString(),
      elapsedMs: result.statistics.elapsed_ms,
      score: result.score.total_score,
      conflictCount: result.conflicts.length,
      assignmentCount: result.assignments.length,
    };
    const response = { run, result };
    this.runs.set(id, response);
    this.recordAuditEvent("schedule_run.created", "schedule_run", id, {
      status: result.statistics.status,
      score: result.score.total_score,
      assignmentCount: result.assignments.length,
      conflictCount: result.conflicts.length,
    });
    return response;
  }

  async listScheduleRuns(): Promise<ScheduleRunListResponse> {
    return {
      runs: Array.from(this.runs.values()).map((item) => item.run).reverse(),
    };
  }

  async getScheduleRun(id: string): Promise<ScheduleRunResponse | null> {
    return this.runs.get(id) ?? null;
  }

  async compareScheduleRuns(
    baseId: string,
    targetId: string,
  ): Promise<ScheduleRunComparisonResponse | null> {
    const base = await this.getScheduleRun(baseId);
    const target = await this.getScheduleRun(targetId);
    return base && target ? buildRunComparison(base, target) : null;
  }

  async listAuditEvents(filter: AuditEventFilter = {}): Promise<AuditEventListResponse> {
    const events = [...this.auditEvents]
      .reverse()
      .filter((event) => matchesAuditFilter(event, filter))
      .slice(0, filter.limit ?? 50);
    return { events };
  }

  async publishScheduleRun(id: string): Promise<PublishScheduleRunResult> {
    const response = this.runs.get(id);
    if (!response) {
      return null;
    }
    if (!isScheduleResultPublishable(this.scheduleInput, response.result)) {
      return "not_publishable";
    }
    this.publishedRunId = id;
    this.batch = {
      ...this.batch,
      status: "published",
    };
    this.recordAuditEvent("schedule_run.published", "schedule_run", id, {
      status: response.run.status,
      score: response.run.score,
    });
    return {
      batch: this.batch,
      ...response,
    };
  }

  async createScheduleDraftFromRun(id: string): Promise<ScheduleDraftDetailResponse | null> {
    const source = this.runs.get(id);
    if (!source) {
      return null;
    }
    const now = new Date().toISOString();
    const draftId = `draft-${randomUUID()}`;
    const assignments = structuredClone(source.result.assignments);
    const conflicts = validateDraftAssignments(this.scheduleInput, assignments);
    const draft: ScheduleDraftSummary = {
      id: draftId,
      batchId: this.batch.id,
      sourceRunId: id,
      basePublishedRunId: this.publishedRunId,
      status: conflicts.length > 0 ? "blocked" : "validated",
      score: scoreDraft(conflicts),
      conflictCount: conflicts.length,
      assignmentCount: assignments.length,
      createdBy: "admin",
      createdAt: now,
      updatedAt: now,
    };
    const detail = {
      draft,
      assignments,
      conflicts,
      changeEvents: [],
      lockedExamTaskIds: [],
    };
    this.drafts.set(draftId, detail);
    this.draftLocks.set(draftId, new Set());
    this.recordAuditEvent("schedule_draft.created", "schedule_draft", draftId, {
      sourceRunId: id,
      assignmentCount: assignments.length,
      conflictCount: conflicts.length,
    });
    return detail;
  }

  async listScheduleDrafts(): Promise<ScheduleDraftListResponse> {
    return {
      drafts: Array.from(this.drafts.values())
        .map((item) => item.draft)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    };
  }

  async getScheduleDraft(id: string): Promise<ScheduleDraftDetailResponse | null> {
    const draft = this.drafts.get(id);
    return draft ? this.withLocks(draft) : null;
  }

  async updateScheduleDraftAssignment(
    id: string,
    examTaskId: string,
    patch: Partial<ScheduleResult["assignments"][number]>,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | "assignment_locked" | null> {
    const current = this.drafts.get(id);
    if (!current) {
      return null;
    }
    if (current.draft.status === "published" || current.draft.status === "discarded") {
      return "not_editable";
    }
    if (this.draftLocks.get(id)?.has(examTaskId)) {
      return "assignment_locked";
    }
    const index = current.assignments.findIndex((assignment) => (
      assignment.exam_task_id === examTaskId
    ));
    if (index === -1) {
      return null;
    }

    const before = structuredClone(current.assignments[index]);
    const after = {
      ...before,
      ...patch,
      exam_task_id: examTaskId,
    };
    const assignments = [...current.assignments];
    assignments[index] = after;
    const conflicts = validateDraftAssignments(this.scheduleInput, assignments);
    const now = new Date().toISOString();
    const changeEvent: ScheduleDraftChangeEvent = {
      id: `draft-change-${randomUUID()}`,
      draftId: id,
      examTaskId,
      before,
      after,
      actor: "admin",
      createdAt: now,
    };
    const detail = {
      draft: {
        ...current.draft,
        status: conflicts.length > 0 ? "blocked" as const : "validated" as const,
        score: scoreDraft(conflicts),
        conflictCount: conflicts.length,
        assignmentCount: assignments.length,
        updatedAt: now,
      },
      assignments,
      conflicts,
      changeEvents: [...current.changeEvents, changeEvent],
      lockedExamTaskIds: this.getLockedExamTaskIds(id),
    };
    this.drafts.set(id, detail);
    this.recordAuditEvent("schedule_draft.assignment_updated", "schedule_draft", id, {
      examTaskId,
      before,
      after,
      conflictCount: conflicts.length,
    });
    return detail;
  }

  async validateScheduleDraft(id: string): Promise<ScheduleDraftDetailResponse | "not_editable" | null> {
    const current = this.drafts.get(id);
    if (!current) {
      return null;
    }
    if (current.draft.status === "published" || current.draft.status === "discarded") {
      return "not_editable";
    }
    const conflicts = validateDraftAssignments(this.scheduleInput, current.assignments);
    const now = new Date().toISOString();
    const detail = {
      ...current,
      draft: {
        ...current.draft,
        status: conflicts.length > 0 ? "blocked" as const : "validated" as const,
        score: scoreDraft(conflicts),
        conflictCount: conflicts.length,
        updatedAt: now,
      },
      conflicts,
      lockedExamTaskIds: this.getLockedExamTaskIds(id),
    };
    this.drafts.set(id, detail);
    this.recordAuditEvent("schedule_draft.validated", "schedule_draft", id, {
      conflictCount: conflicts.length,
    });
    return detail;
  }

  async compareScheduleDraft(id: string): Promise<ScheduleDraftComparisonResponse | null> {
    const current = this.drafts.get(id);
    const source = current ? this.runs.get(current.draft.sourceRunId) : null;
    const published = this.publishedRunId ? this.runs.get(this.publishedRunId) ?? null : null;
    if (!current || !source) {
      return null;
    }
    return buildDraftComparison(current, source, published);
  }

  async suggestScheduleDraftAssignment(
    id: string,
    examTaskId: string,
  ): Promise<ScheduleDraftAdjustmentSuggestionsResponse | null> {
    const current = this.drafts.get(id);
    if (!current) {
      return null;
    }
    if (this.draftLocks.get(id)?.has(examTaskId)) {
      return {
        draft: current.draft,
        examTaskId,
        suggestions: [],
      };
    }
    return buildDraftAdjustmentSuggestions(this.scheduleInput, this.withLocks(current), examTaskId);
  }

  async lockScheduleDraftAssignment(
    id: string,
    examTaskId: string,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | null> {
    const current = this.drafts.get(id);
    if (!current || !current.assignments.some((assignment) => assignment.exam_task_id === examTaskId)) {
      return null;
    }
    if (current.draft.status === "published" || current.draft.status === "discarded") {
      return "not_editable";
    }
    const locks = this.draftLocks.get(id) ?? new Set<string>();
    locks.add(examTaskId);
    this.draftLocks.set(id, locks);
    this.recordAuditEvent("schedule_draft.assignment_locked", "schedule_draft", id, { examTaskId });
    return this.withLocks(current);
  }

  async unlockScheduleDraftAssignment(
    id: string,
    examTaskId: string,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | null> {
    const current = this.drafts.get(id);
    if (!current || !current.assignments.some((assignment) => assignment.exam_task_id === examTaskId)) {
      return null;
    }
    if (current.draft.status === "published" || current.draft.status === "discarded") {
      return "not_editable";
    }
    const locks = this.draftLocks.get(id) ?? new Set<string>();
    locks.delete(examTaskId);
    this.draftLocks.set(id, locks);
    this.recordAuditEvent("schedule_draft.assignment_unlocked", "schedule_draft", id, { examTaskId });
    return this.withLocks(current);
  }

  async rebalanceScheduleDraft(id: string): Promise<ScheduleDraftDetailResponse | "not_editable" | null> {
    const current = this.drafts.get(id);
    if (!current) {
      return null;
    }
    if (current.draft.status === "published" || current.draft.status === "discarded") {
      return "not_editable";
    }

    let detail = current;
    const locked = this.draftLocks.get(id) ?? new Set<string>();
    const conflictedExamIds = new Set(detail.conflicts.flatMap((conflict) => conflict.affected_ids));
    for (const assignment of [...detail.assignments]) {
      if (locked.has(assignment.exam_task_id) || !conflictedExamIds.has(assignment.exam_task_id)) {
        continue;
      }
      const candidate = buildDraftAdjustmentSuggestions(
        this.scheduleInput,
        this.withLocks(detail),
        assignment.exam_task_id,
      )?.suggestions.find((suggestion) => suggestion.hardConflictCount === 0);
      if (!candidate) {
        continue;
      }
      const updated = await this.updateScheduleDraftAssignment(id, assignment.exam_task_id, {
        room_id: candidate.assignment.room_id,
        time_slot_id: candidate.assignment.time_slot_id,
        teacher_ids: candidate.assignment.teacher_ids,
      });
      if (updated && updated !== "not_editable" && updated !== "assignment_locked") {
        detail = updated;
      }
    }
    this.recordAuditEvent("schedule_draft.rebalanced", "schedule_draft", id, {
      lockedExamTaskIds: [...locked],
      conflictCount: detail.conflicts.length,
    });
    return this.withLocks(detail);
  }

  async publishScheduleDraft(id: string): Promise<ScheduleDraftPublishResponse | "conflict" | "not_publishable" | null> {
    const existing = this.drafts.get(id);
    if (!existing) {
      return null;
    }
    if (existing.draft.status === "published" || existing.draft.status === "discarded") {
      return "not_publishable";
    }
    const current = await this.validateScheduleDraft(id);
    if (!current) {
      return null;
    }
    if (current === "not_editable") {
      return "not_publishable";
    }
    if (current.conflicts.some((conflict) => conflict.severity === "error")) {
      return "conflict";
    }

    const runId = `run-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const result = buildDraftScheduleResult(current);
    const run: ScheduleRunSummary = {
      id: runId,
      status: "feasible",
      createdAt,
      elapsedMs: 0,
      score: current.draft.score,
      conflictCount: current.conflicts.length,
      assignmentCount: current.assignments.length,
    };
    this.runs.set(runId, { run, result });
    this.publishedRunId = runId;
    this.batch = {
      ...this.batch,
      status: "published",
    };
    const draft = {
      ...current.draft,
      status: "published" as const,
      updatedAt: createdAt,
    };
    const detail = {
      ...current,
      draft,
      lockedExamTaskIds: this.getLockedExamTaskIds(id),
    };
    this.drafts.set(id, detail);
    this.recordAuditEvent("schedule_draft.published", "schedule_draft", id, {
      runId,
      sourceRunId: current.draft.sourceRunId,
      score: current.draft.score,
    });
    return {
      batch: this.batch,
      draft,
      run,
      result,
    };
  }

  async discardScheduleDraft(id: string): Promise<ScheduleDraftDiscardResponse | "not_discardable" | null> {
    const current = this.drafts.get(id);
    if (!current) {
      return null;
    }
    if (current.draft.status === "published" || current.draft.status === "discarded") {
      return "not_discardable";
    }
    const now = new Date().toISOString();
    const draft = {
      ...current.draft,
      status: "discarded" as const,
      updatedAt: now,
    };
    this.drafts.set(id, {
      ...current,
      draft,
      lockedExamTaskIds: this.getLockedExamTaskIds(id),
    });
    this.recordAuditEvent("schedule_draft.discarded", "schedule_draft", id, {
      sourceRunId: current.draft.sourceRunId,
      conflictCount: current.draft.conflictCount,
      assignmentCount: current.draft.assignmentCount,
    });
    return { draft };
  }

  async createScheduleJob(command: CreateScheduleJobCommand): Promise<CreateScheduleJobResult> {
    const existing = [...this.scheduleJobs.values()].find(
      (job) => job.idempotencyKey === command.idempotencyKey,
    );
    if (existing) {
      if (existing.requestDigest !== command.requestDigest) {
        throw new ScheduleJobIdempotencyConflictError(command.idempotencyKey);
      }
      return { job: existing, created: false };
    }
    const now = new Date().toISOString();
    const job: ScheduleJobSummary = {
      id: `job-${randomUUID()}`,
      batchId: command.batchId,
      status: "queued",
      progress: 0,
      idempotencyKey: command.idempotencyKey,
      requestDigest: command.requestDigest,
      traceId: command.traceId,
      runId: null,
      error: null,
      cancellationRequestedAt: null,
      queuedAt: now,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.scheduleJobs.set(job.id, job);
    this.recordScheduleJobEvent(job, "schedule_job.queued", { status: job.status });
    return { job, created: true };
  }

  async listScheduleJobs(): Promise<{ jobs: ScheduleJobSummary[] }> {
    return {
      jobs: [...this.scheduleJobs.values()].sort((left, right) => (
        right.createdAt.localeCompare(left.createdAt)
      )),
    };
  }

  async getScheduleJob(id: string): Promise<ScheduleJobSummary | null> {
    return this.scheduleJobs.get(id) ?? null;
  }

  async transitionScheduleJob(
    id: string,
    command: TransitionScheduleJobCommand,
  ): Promise<ScheduleJobTransitionResult> {
    const current = this.scheduleJobs.get(id);
    if (!current) {
      return { job: null, resolution: "not_found" };
    }
    const resolution = resolveScheduleJobTransition(current.status, command.to);
    if (resolution !== "apply") {
      return { job: current, resolution };
    }
    const now = new Date().toISOString();
    const terminal = ["succeeded", "failed", "cancelled", "timed_out"].includes(command.to);
    const next = {
      ...current,
      status: command.to,
      progress: command.progress,
      error: command.error ?? null,
      startedAt: command.to === "running" ? now : current.startedAt,
      finishedAt: terminal ? now : current.finishedAt,
      cancellationRequestedAt: command.to === "cancelled" ? now : current.cancellationRequestedAt,
      updatedAt: now,
    };
    this.scheduleJobs.set(id, next);
    if (command.to === "running") {
      this.scheduleJobAttempts.set(id, (this.scheduleJobAttempts.get(id) ?? 0) + 1);
    }
    this.recordScheduleJobEvent(next, `schedule_job.${command.to}`, {
      status: command.to,
      progress: command.progress,
      error: next.error,
    });
    return { job: next, resolution };
  }

  async completeScheduleJob(
    id: string,
    result: ScheduleResult,
  ): Promise<ScheduleJobTransitionResult> {
    const current = this.scheduleJobs.get(id);
    if (!current) {
      return { job: null, resolution: "not_found" };
    }
    const status = scheduleJobStatusForSolveResult(result.statistics.status);
    const resolution = resolveScheduleJobTransition(current.status, status);
    if (resolution !== "apply") {
      return { job: current, resolution };
    }
    const response = this.createScheduleRunInternal(result);
    const now = new Date().toISOString();
    const next: ScheduleJobSummary = {
      ...current,
      status,
      progress: 100,
      runId: response.run.id,
      finishedAt: now,
      updatedAt: now,
    };
    this.scheduleJobs.set(id, next);
    this.recordScheduleJobEvent(next, `schedule_job.${status}`, {
      status,
      runId: response.run.id,
    });
    return { job: next, resolution };
  }

  async recoverInterruptedScheduleJobs(): Promise<ScheduleJobSummary[]> {
    const recovered: ScheduleJobSummary[] = [];
    for (const job of this.scheduleJobs.values()) {
      if (job.status !== "queued" && job.status !== "running") {
        continue;
      }
      const failed = await this.transitionScheduleJob(job.id, {
        to: "failed",
        progress: 100,
        error: {
          category: "infrastructure",
          code: "schedule_job_interrupted",
          message: "Schedule job was interrupted before completion.",
          retryable: true,
        },
      });
      if (failed.job && failed.resolution === "apply") {
        recovered.push(failed.job);
        this.recordAuditEvent("schedule_job.interrupted", "schedule_job", failed.job.id, {
          previousStatus: job.status,
        });
      }
    }
    return recovered;
  }

  async createAuthUser(command: CreateAuthUserCommand): Promise<AuthUserRecord> {
    if ([...this.authUsers.values()].some((user) => user.username === command.username)) {
      throw new Error(`Auth user ${command.username} already exists.`);
    }
    const user = structuredClone(command);
    this.authUsers.set(user.id, user);
    return structuredClone(user);
  }

  async findAuthUserByUsername(username: string): Promise<AuthUserRecord | null> {
    const user = [...this.authUsers.values()].find((candidate) => candidate.username === username);
    return user ? structuredClone(user) : null;
  }

  async createAuthSession(command: CreateAuthSessionCommand): Promise<AuthSessionRecord> {
    const session: AuthSessionRecord = {
      ...structuredClone(command),
      revokedAt: null,
      lastSeenAt: command.createdAt,
    };
    this.authSessions.set(session.id, session);
    return structuredClone(session);
  }

  async findAuthSessionByTokenDigest(tokenDigest: string): Promise<AuthSessionWithUser | null> {
    const session = [...this.authSessions.values()].find(
      (candidate) => candidate.tokenDigest === tokenDigest,
    );
    const user = session ? this.authUsers.get(session.userId) : null;
    return session && user
      ? { session: structuredClone(session), user: structuredClone(user) }
      : null;
  }

  async revokeAuthSession(id: string, revokedAt: string): Promise<boolean> {
    const session = this.authSessions.get(id);
    if (!session || session.revokedAt) {
      return false;
    }
    this.authSessions.set(id, { ...session, revokedAt });
    return true;
  }

  private recordScheduleJobEvent(
    job: ScheduleJobSummary,
    type: string,
    payload: Record<string, unknown>,
  ) {
    const event = {
      eventId: `event-${randomUUID()}`,
      jobId: job.id,
      type,
      version: 1,
      occurredAt: new Date().toISOString(),
      payload,
      traceId: job.traceId,
    };
    this.scheduleJobEvents.push(event);
    this.outboxEvents.push({
      id: `outbox-${randomUUID()}`,
      ...event,
      publishedAt: null,
    });
  }

  async getPublishedSchedule(): Promise<PublishedScheduleResponse | null> {
    if (!this.publishedRunId) {
      return null;
    }
    const response = this.runs.get(this.publishedRunId);
    return response ? {
      batch: this.batch,
      ...response,
    } : null;
  }

  async rollbackPublishedSchedule(): Promise<ScheduleRollbackResponse> {
    const previousRun = this.publishedRunId
      ? this.runs.get(this.publishedRunId)?.run ?? null
      : null;
    this.publishedRunId = null;
    this.batch = {
      ...this.batch,
      status: "ready",
    };
    this.recordAuditEvent("schedule_run.rollback", "exam_batch", this.batch.id, {
      previousRunId: previousRun?.id ?? null,
    });
    return {
      batch: this.batch,
      previousRun,
    };
  }

  private getCollection(resource: ReferenceResource): Array<ReferenceRecord> {
    const collections = {
      "student-groups": this.scheduleInput.student_groups,
      teachers: this.scheduleInput.teachers,
      courses: this.scheduleInput.courses,
      rooms: this.scheduleInput.rooms,
      "time-slots": this.scheduleInput.time_slots,
      "exam-tasks": this.scheduleInput.exam_tasks,
    };
    return collections[resource] as Array<ReferenceRecord>;
  }

  private getLockedExamTaskIds(id: string) {
    return [...(this.draftLocks.get(id) ?? new Set<string>())].sort();
  }

  private withLocks(detail: ScheduleDraftDetailResponse): ScheduleDraftDetailResponse {
    return {
      ...detail,
      lockedExamTaskIds: this.getLockedExamTaskIds(detail.draft.id),
    };
  }

  recordAuditEvent(
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
    actor = "system",
  ) {
    const context = getCurrentAuthContext();
    this.auditEvents.push({
      id: `audit-${randomUUID()}`,
      actor: context?.user.username ?? actor,
      actorUserId: context?.user.id ?? null,
      actorRoles: context?.user.roles ?? [],
      action,
      entityType,
      entityId,
      payload,
      createdAt: new Date().toISOString(),
    });
  }
}

function matchesAuditFilter(event: AuditEventSummary, filter: AuditEventFilter) {
  return (!filter.entityType || event.entityType === filter.entityType)
    && (!filter.entityId || event.entityId === filter.entityId)
    && (!filter.actor || event.actor === filter.actor)
    && (!filter.since || Date.parse(event.createdAt) >= Date.parse(filter.since))
    && (!filter.until || Date.parse(event.createdAt) <= Date.parse(filter.until));
}

export function buildRunComparison(
  base: ScheduleRunResponse,
  target: ScheduleRunResponse,
): ScheduleRunComparisonResponse {
  const baseKeys = new Map(base.result.assignments.map((assignment) => [
    assignmentKey(assignment),
    assignment,
  ]));
  const targetKeys = new Map(target.result.assignments.map((assignment) => [
    assignmentKey(assignment),
    assignment,
  ]));
  const added = target.result.assignments.filter((assignment) => (
    !baseKeys.has(assignmentKey(assignment))
  ));
  const removed = base.result.assignments.filter((assignment) => (
    !targetKeys.has(assignmentKey(assignment))
  ));

  return {
    baseRun: base.run,
    targetRun: target.run,
    deltas: {
      score: target.run.score - base.run.score,
      assignments: target.run.assignmentCount - base.run.assignmentCount,
      conflicts: target.run.conflictCount - base.run.conflictCount,
      elapsedMs: target.run.elapsedMs - base.run.elapsedMs,
    },
    assignmentChanges: {
      unchanged: base.result.assignments.length - removed.length,
      added,
      removed,
    },
  };
}

function assignmentKey(assignment: ScheduleResult["assignments"][number]) {
  return [
    assignment.exam_task_id,
    assignment.room_id,
    assignment.time_slot_id,
    ...assignment.teacher_ids,
  ].join("|");
}

export function validateReferenceRecord(
  resource: ReferenceResource,
  record: ReferenceRecord,
  scheduleInput: ReferenceDataResponse["scheduleInput"],
) {
  const issues: string[] = [];

  if (resource === "rooms") {
    const room = record as ReferenceDataResponse["scheduleInput"]["rooms"][number];
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(room.building_id)) {
      issues.push("Room building_id must be a lowercase slug between 2 and 64 characters.");
    }
  }

  if (resource === "teachers") {
    const teacher = record as ReferenceDataResponse["scheduleInput"]["teachers"][number];
    const timeSlotIds = new Set(scheduleInput.time_slots.map((slot) => slot.id));
    for (const slotId of teacher.unavailable_slot_ids) {
      if (!timeSlotIds.has(slotId)) {
        issues.push(`Time slot ${slotId} does not exist.`);
      }
    }
  }

  if (resource === "exam-tasks") {
    const task = record as ReferenceDataResponse["scheduleInput"]["exam_tasks"][number];
    const courseIds = new Set(scheduleInput.courses.map((course) => course.id));
    const studentGroupIds = new Set(scheduleInput.student_groups.map((group) => group.id));
    const timeSlotIds = new Set(scheduleInput.time_slots.map((slot) => slot.id));

    if (!courseIds.has(task.course_id)) {
      issues.push(`Course ${task.course_id} does not exist.`);
    }

    for (const groupId of task.student_group_ids) {
      if (!studentGroupIds.has(groupId)) {
        issues.push(`Student group ${groupId} does not exist.`);
      }
    }

    for (const slotId of task.allowed_slot_ids) {
      if (!timeSlotIds.has(slotId)) {
        issues.push(`Time slot ${slotId} does not exist.`);
      }
    }
  }

  if (issues.length > 0) {
    throw new ReferenceIntegrityError(issues);
  }
}

export function validateReferenceDelete(
  resource: ReferenceResource,
  id: string,
  scheduleInput: ReferenceDataResponse["scheduleInput"],
) {
  const issues: string[] = [];

  if (resource === "courses") {
    for (const task of scheduleInput.exam_tasks) {
      if (task.course_id === id) {
        issues.push(`Course ${id} is referenced by exam task ${task.id}.`);
      }
    }
  }

  if (resource === "student-groups") {
    for (const task of scheduleInput.exam_tasks) {
      if (task.student_group_ids.includes(id)) {
        issues.push(`Student group ${id} is referenced by exam task ${task.id}.`);
      }
    }
  }

  if (resource === "time-slots") {
    for (const task of scheduleInput.exam_tasks) {
      if (task.allowed_slot_ids.includes(id)) {
        issues.push(`Time slot ${id} is referenced by exam task ${task.id}.`);
      }
    }
    for (const teacher of scheduleInput.teachers) {
      if (teacher.unavailable_slot_ids.includes(id)) {
        issues.push(`Time slot ${id} is referenced by teacher ${teacher.id}.`);
      }
    }
  }

  if (issues.length > 0) {
    throw new ReferenceIntegrityError(issues);
  }
}

export function buildDraftComparison(
  detail: ScheduleDraftDetailResponse,
  source: ScheduleRunResponse,
  published: ScheduleRunResponse | null,
): ScheduleDraftComparisonResponse {
  const sourceChanges = buildDraftAssignmentChanges(source.result.assignments, detail.assignments);
  const publishedChanges = published
    ? buildDraftAssignmentChanges(published.result.assignments, detail.assignments)
    : null;

  return {
    draft: detail.draft,
    source: {
      run: source.run,
      assignmentChanges: sourceChanges,
    },
    published: published && publishedChanges ? {
      run: published.run,
      assignmentChanges: publishedChanges,
    } : null,
    summary: {
      changedFromSource: sourceChanges.changed.length,
      changedFromPublished: publishedChanges?.changed.length ?? null,
      hardConflictCount: detail.conflicts.filter((conflict) => conflict.severity === "error").length,
      score: detail.draft.score,
    },
  };
}

function buildDraftAssignmentChanges(
  baseAssignments: ScheduleResult["assignments"],
  draftAssignments: ScheduleResult["assignments"],
): ScheduleDraftComparisonResponse["source"]["assignmentChanges"] {
  const baseByTask = new Map(baseAssignments.map((assignment) => [
    assignment.exam_task_id,
    assignment,
  ]));
  const changed: ScheduleDraftComparisonResponse["source"]["assignmentChanges"]["changed"] = [];
  let unchanged = 0;

  for (const after of draftAssignments) {
    const before = baseByTask.get(after.exam_task_id);
    if (!before) {
      continue;
    }
    if (assignmentKey(before) === assignmentKey(after)) {
      unchanged += 1;
    } else {
      changed.push({ before, after });
    }
  }

  return {
    unchanged,
    changed,
  };
}

export function buildDraftAdjustmentSuggestions(
  scheduleInput: ReferenceDataResponse["scheduleInput"],
  detail: ScheduleDraftDetailResponse,
  examTaskId: string,
): ScheduleDraftAdjustmentSuggestionsResponse | null {
  const task = scheduleInput.exam_tasks.find((item) => item.id === examTaskId);
  const currentIndex = detail.assignments.findIndex((assignment) => (
    assignment.exam_task_id === examTaskId
  ));
  if (!task || currentIndex === -1) {
    return null;
  }

  const slots = task.allowed_slot_ids.length > 0
    ? scheduleInput.time_slots.filter((slot) => task.allowed_slot_ids.includes(slot.id))
    : scheduleInput.time_slots;
  const teacherGroups = buildTeacherGroups(
    scheduleInput.teachers.map((teacher) => teacher.id),
    task.invigilator_count,
  );
  const suggestions: ScheduleDraftAdjustmentSuggestionsResponse["suggestions"] = [];
  const seen = new Set<string>();

  for (const room of scheduleInput.rooms) {
    for (const slot of slots) {
      for (const teacherIds of teacherGroups) {
        const assignment = {
          exam_task_id: examTaskId,
          room_id: room.id,
          time_slot_id: slot.id,
          teacher_ids: teacherIds,
        };
        const key = assignmentKey(assignment);
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        const assignments = [...detail.assignments];
        assignments[currentIndex] = assignment;
        const conflicts = validateDraftAssignments(scheduleInput, assignments);
        const hardConflictCount = conflicts.filter((conflict) => conflict.severity === "error").length;
        suggestions.push({
          assignment,
          hardConflictCount,
          score: scoreDraft(conflicts),
          reasons: buildSuggestionReasons(conflicts, room.name, slot.id),
        });
      }
    }
  }

  suggestions.sort((left, right) => (
    left.hardConflictCount - right.hardConflictCount
    || right.score - left.score
    || left.assignment.time_slot_id.localeCompare(right.assignment.time_slot_id)
    || left.assignment.room_id.localeCompare(right.assignment.room_id)
  ));

  return {
    draft: detail.draft,
    examTaskId,
    suggestions: suggestions.slice(0, 8),
  };
}

function buildTeacherGroups(teacherIds: string[], requiredCount: number): string[][] {
  if (requiredCount <= 1) {
    return teacherIds.map((teacherId) => [teacherId]);
  }
  const groups: string[][] = [];
  const visit = (start: number, selected: string[]) => {
    if (selected.length === requiredCount) {
      groups.push([...selected]);
      return;
    }
    for (let index = start; index < teacherIds.length; index += 1) {
      selected.push(teacherIds[index]);
      visit(index + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return groups;
}

function buildSuggestionReasons(
  conflicts: ConflictRecord[],
  roomName: string,
  slotId: string,
): string[] {
  const hardConflicts = conflicts.filter((conflict) => conflict.severity === "error");
  if (hardConflicts.length === 0) {
    return [
      `${roomName} 在 ${slotId} 可承接该考试。`,
      "候选安排通过当前硬约束校验。",
    ];
  }
  return hardConflicts.slice(0, 3).map((conflict) => conflict.message);
}

export function validateDraftAssignments(
  scheduleInput: ReferenceDataResponse["scheduleInput"],
  assignments: ScheduleResult["assignments"],
): ConflictRecord[] {
  const conflicts: ConflictRecord[] = [];
  const tasks = new Map(scheduleInput.exam_tasks.map((task) => [task.id, task]));
  const rooms = new Map(scheduleInput.rooms.map((room) => [room.id, room]));
  const teachers = new Map(scheduleInput.teachers.map((teacher) => [teacher.id, teacher]));
  const timeSlots = new Set(scheduleInput.time_slots.map((slot) => slot.id));
  const roomSlot = new Map<string, string>();
  const teacherSlot = new Map<string, string>();
  const groupSlot = new Map<string, string>();
  const assignmentCounts = new Map<string, number>();

  for (const assignment of assignments) {
    assignmentCounts.set(
      assignment.exam_task_id,
      (assignmentCounts.get(assignment.exam_task_id) ?? 0) + 1,
    );
  }
  for (const task of scheduleInput.exam_tasks) {
    const assignmentCount = assignmentCounts.get(task.id) ?? 0;
    if (assignmentCount === 0) {
      conflicts.push(buildConflict(
        "exam_task_unassigned",
        [task.id],
        `考试任务 ${task.id} 尚未安排。`,
        "为该考试任务补充唯一的考场、时间段和监考安排。",
      ));
    } else if (assignmentCount > 1) {
      conflicts.push(buildConflict(
        "exam_task_duplicate_assignment",
        [task.id],
        `考试任务 ${task.id} 存在 ${assignmentCount} 条安排。`,
        "仅保留一条有效安排后重新校验。",
      ));
    }
  }

  assignments.forEach((assignment) => {
    const task = tasks.get(assignment.exam_task_id);
    const room = rooms.get(assignment.room_id);

    if (!task) {
      conflicts.push(buildConflict(
        "exam_task_not_found",
        [assignment.exam_task_id],
        `考试任务 ${assignment.exam_task_id} 不存在。`,
        "请重新选择有效考试任务后再调整草稿。",
      ));
      return;
    }

    if (!timeSlots.has(assignment.time_slot_id)) {
      conflicts.push(buildConflict(
        "time_slot_not_found",
        [assignment.time_slot_id],
        `时间段 ${assignment.time_slot_id} 不存在。`,
        "请选择有效时间段后重新校验。",
      ));
    } else if (
      task.allowed_slot_ids.length > 0
      && !task.allowed_slot_ids.includes(assignment.time_slot_id)
    ) {
      conflicts.push(buildConflict(
        "allowed_slot",
        [task.id, assignment.time_slot_id],
        `${task.id} 不能安排在当前时间段。`,
        "请选择考试任务允许的时间段。",
      ));
    }

    if (assignment.teacher_ids.length < task.invigilator_count) {
      conflicts.push(buildConflict(
        "invigilator_count",
        [task.id],
        `${task.id} 需要至少 ${task.invigilator_count} 名监考教师。`,
        "补齐监考教师后重新校验。",
      ));
    }

    if (!room) {
      conflicts.push(buildConflict(
        "room_not_found",
        [assignment.room_id],
        `考场 ${assignment.room_id} 不存在。`,
        "请选择有效考场。",
      ));
    } else {
      if (room.capacity < task.expected_count) {
        conflicts.push(buildConflict(
          "room_capacity",
          [task.id, room.id],
          `${room.name} 容量不足，无法容纳 ${task.expected_count} 人。`,
          "选择容量更大的考场。",
        ));
      }
      if (room.room_type !== task.required_room_type) {
        conflicts.push(buildConflict(
          "room_requirement",
          [task.id, room.id],
          `${room.name} 类型不满足 ${task.required_room_type} 考试要求。`,
          "选择符合考试类型的考场。",
        ));
      }
      const missingEquipment = task.required_equipment_tags.filter((tag) => (
        !room.equipment_tags.includes(tag)
      ));
      if (missingEquipment.length > 0) {
        conflicts.push(buildConflict(
          "room_equipment",
          [task.id, room.id, ...missingEquipment],
          `${room.name} 缺少 ${missingEquipment.join("、")} 设备。`,
          "选择设备满足要求的考场。",
        ));
      }
    }

    const roomSlotKey = `${assignment.room_id}|${assignment.time_slot_id}`;
    const existingRoomTask = roomSlot.get(roomSlotKey);
    if (existingRoomTask) {
      conflicts.push(buildConflict(
        "room_time_unique",
        [existingRoomTask, assignment.exam_task_id, assignment.room_id, assignment.time_slot_id],
        "同一考场同一时间段存在多场考试。",
        "调整其中一场考试的时间或考场。",
      ));
    } else {
      roomSlot.set(roomSlotKey, assignment.exam_task_id);
    }

    for (const groupId of task.student_group_ids) {
      const key = `${groupId}|${assignment.time_slot_id}`;
      const existingGroupTask = groupSlot.get(key);
      if (existingGroupTask) {
        conflicts.push(buildConflict(
          "student_group_time_unique",
          [existingGroupTask, assignment.exam_task_id, groupId, assignment.time_slot_id],
          `学生群体 ${groupId} 同一时间段存在多场考试。`,
          "调整其中一场考试时间。",
        ));
      } else {
        groupSlot.set(key, assignment.exam_task_id);
      }
    }

    for (const teacherId of assignment.teacher_ids) {
      const teacher = teachers.get(teacherId);
      if (!teacher) {
        conflicts.push(buildConflict(
          "teacher_not_found",
          [teacherId],
          `教师 ${teacherId} 不存在。`,
          "请选择有效监考教师。",
        ));
        continue;
      }
      if (teacher.unavailable_slot_ids.includes(assignment.time_slot_id)) {
        conflicts.push(buildConflict(
          "teacher_unavailable",
          [teacherId, assignment.time_slot_id],
          `${teacher.name} 当前时间段不可用。`,
          "替换监考教师或调整考试时间。",
        ));
      }
      const key = `${teacherId}|${assignment.time_slot_id}`;
      const existingTeacherTask = teacherSlot.get(key);
      if (existingTeacherTask) {
        conflicts.push(buildConflict(
          "teacher_time_unique",
          [existingTeacherTask, assignment.exam_task_id, teacherId, assignment.time_slot_id],
          `${teacher.name} 同一时间段被安排多场监考。`,
          "调整监考教师或考试时间。",
        ));
      } else {
        teacherSlot.set(key, assignment.exam_task_id);
      }
    }
  });

  return conflicts;
}

export function isScheduleResultPublishable(
  scheduleInput: ReferenceDataResponse["scheduleInput"],
  result: ScheduleResult,
): boolean {
  return result.statistics.status === "feasible"
    && result.score.hard_violation_count === 0
    && !result.conflicts.some((conflict) => conflict.severity === "error")
    && !validateDraftAssignments(scheduleInput, result.assignments).some(
      (conflict) => conflict.severity === "error",
    );
}

export function buildDraftScheduleResult(detail: ScheduleDraftDetailResponse): ScheduleResult {
  return {
    assignments: structuredClone(detail.assignments),
    conflicts: structuredClone(detail.conflicts),
    score: {
      total_score: detail.draft.score,
      hard_violation_count: detail.conflicts.filter((conflict) => conflict.severity === "error").length,
      soft_penalty_items: [],
    },
    statistics: {
      status: detail.conflicts.length > 0 ? "partial" : "feasible",
      elapsed_ms: 0,
      exam_count: detail.assignments.length,
      room_count: new Set(detail.assignments.map((assignment) => assignment.room_id)).size,
      slot_count: new Set(detail.assignments.map((assignment) => assignment.time_slot_id)).size,
      attempted_assignments: detail.assignments.length,
    },
    report: {
      source: "schedule_draft",
      draft_id: detail.draft.id,
      source_run_id: detail.draft.sourceRunId,
    },
  };
}

function scoreDraft(conflicts: ConflictRecord[]) {
  const penalty = conflicts.reduce((total, conflict) => (
    total + (conflict.severity === "error" ? 20 : 5)
  ), 0);
  return Math.max(0, 100 - penalty);
}

function buildConflict(
  type: string,
  affectedIds: string[],
  message: string,
  suggestion: string,
): ConflictRecord {
  return {
    type,
    severity: "error",
    affected_ids: affectedIds,
    message,
    suggestion,
  };
}
