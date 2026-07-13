import type {
  ScheduleInput,
  ScheduleJobAttempt,
  ScheduleJobError,
  ScheduleJobEventEnvelope,
  ScheduleJobRequestSnapshot,
  ScheduleJobSummary,
  ScheduleJobListQuery,
  ScheduleJobListResponse,
  ScheduleResult,
} from "@examforge/shared";

export interface CreateScheduleJobCommand {
  batchId: string;
  idempotencyKey: string;
  requestDigest: string;
  requestSnapshot: ScheduleJobRequestSnapshot;
  constraintProfileVersionId?: string;
  submittedBy?: string;
  submittedByUserId?: string;
  traceId: string;
}

export interface CreateScheduleJobResult {
  job: ScheduleJobSummary;
  created: boolean;
}

export interface ScheduleJobSubmissionRepository {
  createScheduleJob(command: CreateScheduleJobCommand): Promise<CreateScheduleJobResult>;
}

export type ScheduleJobExecutionTransitionResolution =
  | "apply"
  | "idempotent"
  | "reject"
  | "not_found"
  | "stale_attempt";

export interface ScheduleJobExecutionTransitionResult {
  job: ScheduleJobSummary | null;
  resolution: ScheduleJobExecutionTransitionResolution;
}

export type ScheduleJobCancellationResolution =
  | "cancelled"
  | "requested"
  | "idempotent"
  | "terminal"
  | "not_found";

export interface ScheduleJobCancellationResult {
  job: ScheduleJobSummary | null;
  resolution: ScheduleJobCancellationResolution;
}

export interface ListScheduleJobEventsOptions {
  afterSequence?: number;
  limit?: number;
}

export type ScheduleJobEventCursorResult =
  | { resolution: "valid"; sequence: number }
  | { resolution: "unknown"; sequence: null }
  | { resolution: "wrong_job"; sequence: null };

export interface ScheduleJobEventRepository {
  listScheduleJobEvents(
    jobId: string,
    options?: ListScheduleJobEventsOptions,
  ): Promise<ScheduleJobEventEnvelope[]>;
  resolveScheduleJobEventCursor(
    jobId: string,
    eventId: string,
  ): Promise<ScheduleJobEventCursorResult>;
}

export interface ClaimScheduleJobCommand {
  deliveryAttempt?: number;
  reclaimRunning?: boolean;
}

export type ScheduleJobClaimResult =
  | {
      resolution: "claimed";
      job: ScheduleJobSummary;
      attempt: ScheduleJobAttempt;
      requestSnapshot: ScheduleJobRequestSnapshot;
    }
  | {
      resolution: "not_claimable";
      job: ScheduleJobSummary;
    }
  | {
      resolution: "not_found";
      job: null;
    };

export type ScheduleJobFailureOutcome = "retry" | "failed" | "timed_out" | "cancelled";

export interface FailScheduleJobAttemptCommand {
  attemptId: string;
  error: ScheduleJobError;
  outcome: ScheduleJobFailureOutcome;
  retryAt: string | null;
}

export interface CompleteScheduleJobCommand {
  attemptId: string;
  result: ScheduleResult;
  schedulerVersion?: string;
}

export interface ScheduleJobExecutionRepository {
  claimScheduleJob(
    id: string,
    command?: ClaimScheduleJobCommand,
  ): Promise<ScheduleJobClaimResult>;
  failScheduleJobAttempt(
    id: string,
    command: FailScheduleJobAttemptCommand,
  ): Promise<ScheduleJobExecutionTransitionResult>;
}

export interface ScheduleJobRepository
  extends ScheduleJobSubmissionRepository, ScheduleJobExecutionRepository {
  listScheduleJobs(query?: ScheduleJobListQuery): Promise<ScheduleJobListResponse>;
  getScheduleJob(id: string): Promise<ScheduleJobSummary | null>;
  requestScheduleJobCancellation(id: string): Promise<ScheduleJobCancellationResult>;
  isScheduleJobCancellationRequested(id: string): Promise<boolean>;
}

export interface ScheduleResultWriter {
  completeScheduleJob(
    id: string,
    command: CompleteScheduleJobCommand,
  ): Promise<ScheduleJobExecutionTransitionResult>;
}

export interface ScheduleJobOutboxEvent {
  id: string;
  aggregateId: string;
  eventType: string;
  attemptCount: number;
  event: ScheduleJobEventEnvelope;
}

export interface ProcessOutboxBatchOptions {
  batchSize: number;
  now?: Date;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

export interface ProcessOutboxBatchResult {
  claimed: number;
  published: number;
  failed: number;
}

export interface OutboxDeliveryRepository {
  processOutboxBatch(
    options: ProcessOutboxBatchOptions,
    deliver: (event: ScheduleJobOutboxEvent) => Promise<void>,
  ): Promise<ProcessOutboxBatchResult>;
}

export type SchedulerErrorCategory =
  | "validation"
  | "timeout"
  | "cancelled"
  | "unavailable"
  | "protocol"
  | "internal";

export interface SchedulerSolveOptions {
  requestId?: string;
  signal?: AbortSignal;
  onMetadata?: (metadata: SchedulerResponseMetadata) => void;
}

export interface SchedulerResponseMetadata {
  schedulerVersion: string;
}

export interface SchedulerClient {
  solve(input: ScheduleInput, options?: SchedulerSolveOptions): Promise<ScheduleResult>;
  checkReadiness?(): Promise<void>;
}

export class SchedulerClientError extends Error {
  constructor(
    message: string,
    readonly category: SchedulerErrorCategory,
    readonly code: string,
    readonly retryable: boolean,
    readonly requestId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SchedulerClientError";
  }
}

export class ScheduleJobIdempotencyConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Schedule job idempotency key ${idempotencyKey} was reused with a different request.`);
    this.name = "ScheduleJobIdempotencyConflictError";
  }
}
