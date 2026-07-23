import {
  ScheduleJobIdempotencyConflictError,
  type ClaimScheduleJobCommand,
  type CompleteScheduleJobCommand,
  type CreateScheduleJobCommand,
  type CreateScheduleJobResult,
  type FailScheduleJobAttemptCommand,
  type ListScheduleJobEventsOptions,
  type OutboxDeliveryRepository,
  type ProcessOutboxBatchOptions,
  type ProcessOutboxBatchResult,
  type ScheduleJobOutboxEvent,
  type ScheduleJobClaimResult,
  type ScheduleJobCancellationResult,
  type ScheduleJobExecutionTransitionResult,
  type ScheduleJobEventCursorResult,
} from "@examforge/scheduling-application";
import {
  resolveScheduleJobTransition,
  scheduleJobEventEnvelopeSchema,
  scheduleJobRequestSnapshotSchema,
  scheduleJobStatusForSolveResult,
  type ScheduleJobAttempt,
  type ScheduleJobDetailResponse,
  type ScheduleJobError,
  type ScheduleJobEventEnvelope,
  type ScheduleJobSummary,
  type ScheduleJobListQuery,
  type ScheduleJobListResponse,
  type ScheduleJobStatus,
  type ScheduleResult,
} from "@examforge/shared";
import { and, asc, desc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { createDbSession, type ExamForgeDatabase, type ExamForgeDbClient } from "./client.js";
import { resolveConstraintProfile } from "./constraint-profile-store.js";
import {
  auditEvents,
  conflictRecords,
  outboxEvents,
  scheduleJobAttempts,
  scheduleJobEvents,
  scheduleJobs,
  scheduleRuns,
  scheduledExamInvigilators,
  scheduledExams,
} from "./schema.js";

type ScheduleJobRow = typeof scheduleJobs.$inferSelect;
type ScheduleJobAttemptRow = typeof scheduleJobAttempts.$inferSelect;
type ScheduleJobEventRow = typeof scheduleJobEvents.$inferSelect;

export interface TransitionScheduleJobCommand {
  to: ScheduleJobStatus;
  progress: number;
  error?: ScheduleJobError | null;
}

export interface ScheduleJobTransitionResult {
  job: ScheduleJobSummary | null;
  resolution: "apply" | "idempotent" | "reject" | "not_found";
}

export class ScheduleJobStore implements OutboxDeliveryRepository {
  constructor(private readonly client: ExamForgeDbClient) {}

  async createScheduleJob(command: CreateScheduleJobCommand): Promise<CreateScheduleJobResult> {
    const now = new Date();
    return this.withTransaction(async (db) => {
      const strategy = await resolveConstraintProfile(db, command.constraintProfileVersionId);
      const requestSnapshot = scheduleJobRequestSnapshotSchema.parse({
        version: 2,
        input: {
          ...structuredClone(command.requestSnapshot.input),
          constraint_profile: structuredClone(strategy.snapshot.config),
        },
        constraintProfile: strategy.snapshot,
      });
      const requestDigest = createHash("sha256")
        .update(JSON.stringify(requestSnapshot))
        .digest("hex");
      const [row] = await db.insert(scheduleJobs).values({
        id: `job-${randomUUID()}`,
        batchId: command.batchId,
        status: "queued",
        progress: 0,
        idempotencyKey: command.idempotencyKey,
        requestDigest,
        requestVersion: requestSnapshot.version,
        requestPayload: requestSnapshot,
        constraintProfileVersionId: strategy.versionId,
        constraintProfileSnapshot: strategy.snapshot,
        submittedBy: command.submittedBy ?? "system",
        submittedByUserId: command.submittedByUserId ?? null,
        traceId: command.traceId,
        runId: null,
        error: null,
        queuedAt: now,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing({ target: scheduleJobs.idempotencyKey }).returning();
      if (!row) {
        const [existing] = await db
          .select()
          .from(scheduleJobs)
          .where(eq(scheduleJobs.idempotencyKey, command.idempotencyKey))
          .limit(1);
        if (!existing) {
          throw new Error("Schedule job idempotency conflict did not return an existing job.");
        }
        if (existing.requestDigest !== requestDigest) {
          throw new ScheduleJobIdempotencyConflictError(command.idempotencyKey);
        }
        return { job: toScheduleJob(existing), created: false };
      }
      await this.insertScheduleJobEvent(db, row, "schedule_job.queued", {
        status: row.status,
      }, now);
      return { job: toScheduleJob(row), created: true };
    });
  }

  async listScheduleJobs(query: ScheduleJobListQuery = {
    page: 1,
    pageSize: 20,
  }): Promise<ScheduleJobListResponse> {
    const conditions = [
      query.status ? eq(scheduleJobs.status, query.status) : undefined,
      query.submittedBy ? eq(scheduleJobs.submittedBy, query.submittedBy) : undefined,
      query.constraintProfileVersionId
        ? eq(scheduleJobs.constraintProfileVersionId, query.constraintProfileVersionId)
        : undefined,
      query.from ? gte(scheduleJobs.createdAt, new Date(query.from)) : undefined,
      query.to ? lte(scheduleJobs.createdAt, new Date(query.to)) : undefined,
    ].filter((condition) => condition !== undefined);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const [rows, totalRows] = await Promise.all([
      this.client.db
      .select()
      .from(scheduleJobs)
      .where(where)
        .orderBy(desc(scheduleJobs.createdSequence))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
      this.client.db
        .select({ count: sql<number>`count(*)::int` })
        .from(scheduleJobs)
        .where(where),
    ]);
    const total = totalRows[0]?.count ?? 0;
    return {
      jobs: rows.map(toScheduleJob),
      page: query.page,
      pageSize: query.pageSize,
      total,
      pageCount: Math.ceil(total / query.pageSize),
    };
  }

  async getScheduleJob(id: string): Promise<ScheduleJobSummary | null> {
    const [row] = await this.client.db
      .select()
      .from(scheduleJobs)
      .where(eq(scheduleJobs.id, id))
      .limit(1);
    return row ? toScheduleJob(row) : null;
  }

  async getScheduleJobDetail(id: string): Promise<ScheduleJobDetailResponse | null> {
    const [row] = await this.client.db
      .select()
      .from(scheduleJobs)
      .where(eq(scheduleJobs.id, id))
      .limit(1);
    if (!row) {
      return null;
    }
    const attempts = await this.client.db
      .select()
      .from(scheduleJobAttempts)
      .where(eq(scheduleJobAttempts.jobId, id))
      .orderBy(asc(scheduleJobAttempts.attemptNumber));
    const events = await this.client.db
      .select()
      .from(scheduleJobEvents)
      .where(eq(scheduleJobEvents.jobId, id))
      .orderBy(asc(scheduleJobEvents.sequence));
    return {
      job: { ...toScheduleJob(row), attemptCount: attempts.length },
      attempts: attempts.map(toScheduleJobAttempt),
      events: events.map(toScheduleJobEvent),
    };
  }

  async requestScheduleJobCancellation(id: string): Promise<ScheduleJobCancellationResult> {
    return this.withLockedScheduleJob<ScheduleJobCancellationResult>(id, async (db, current) => {
      const now = new Date();
      if (current.status === "cancelled" || current.cancellationRequestedAt !== null) {
        return { job: toScheduleJob(current), resolution: "idempotent" };
      }
      if (current.status === "queued") {
        const [row] = await db.update(scheduleJobs).set({
          status: "cancelled",
          progress: 100,
          cancellationRequestedAt: now,
          finishedAt: now,
          updatedAt: now,
        }).where(eq(scheduleJobs.id, id)).returning();
        await this.insertScheduleJobEvent(db, row, "schedule_job.cancelled", {
          status: row.status,
          progress: row.progress,
          reason: "cancelled_before_execution",
        }, now);
        return { job: toScheduleJob(row), resolution: "cancelled" };
      }
      if (current.status === "running") {
        const [row] = await db.update(scheduleJobs).set({
          cancellationRequestedAt: now,
          updatedAt: now,
        }).where(eq(scheduleJobs.id, id)).returning();
        await this.insertScheduleJobEvent(db, row, "schedule_job.cancellation_requested", {
          status: row.status,
          attempt: "cooperative",
        }, now);
        return { job: toScheduleJob(row), resolution: "requested" };
      }
      return { job: toScheduleJob(current), resolution: "terminal" };
    }, () => ({ job: null, resolution: "not_found" }));
  }

  async isScheduleJobCancellationRequested(id: string): Promise<boolean> {
    const [row] = await this.client.db
      .select({ cancellationRequestedAt: scheduleJobs.cancellationRequestedAt })
      .from(scheduleJobs)
      .where(eq(scheduleJobs.id, id))
      .limit(1);
    return row?.cancellationRequestedAt !== null && row?.cancellationRequestedAt !== undefined;
  }

  async listScheduleJobEvents(
    jobId: string,
    options: ListScheduleJobEventsOptions = {},
  ): Promise<ScheduleJobEventEnvelope[]> {
    const afterSequence = options.afterSequence ?? 0;
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new Error("afterSequence must be a non-negative integer.");
    }
    const limit = boundedPositiveInteger(options.limit ?? 100, "limit", 200);
    const rows = await this.client.db
      .select()
      .from(scheduleJobEvents)
      .where(and(
        eq(scheduleJobEvents.jobId, jobId),
        gt(scheduleJobEvents.sequence, afterSequence),
      ))
      .orderBy(asc(scheduleJobEvents.sequence))
      .limit(limit);
    return rows.map(toScheduleJobEvent);
  }

  async resolveScheduleJobEventCursor(
    jobId: string,
    eventId: string,
  ): Promise<ScheduleJobEventCursorResult> {
    const [event] = await this.client.db
      .select({
        jobId: scheduleJobEvents.jobId,
        sequence: scheduleJobEvents.sequence,
      })
      .from(scheduleJobEvents)
      .where(eq(scheduleJobEvents.id, eventId))
      .limit(1);
    if (!event) {
      return { resolution: "unknown", sequence: null };
    }
    if (event.jobId !== jobId) {
      return { resolution: "wrong_job", sequence: null };
    }
    return { resolution: "valid", sequence: event.sequence };
  }

  async claimScheduleJob(
    id: string,
    command: ClaimScheduleJobCommand = {},
  ): Promise<ScheduleJobClaimResult> {
    return this.withLockedScheduleJob<ScheduleJobClaimResult>(id, async (db, current) => {
      const parsedSnapshot = scheduleJobRequestSnapshotSchema.safeParse(current.requestPayload);
      if (
        !parsedSnapshot.success
        || (current.requestVersion !== 1 && current.requestVersion !== 2)
      ) {
        throw new Error(`Schedule job ${id} does not contain a recoverable request snapshot.`);
      }
      const [previousAttempt] = await db
        .select()
        .from(scheduleJobAttempts)
        .where(eq(scheduleJobAttempts.jobId, id))
        .orderBy(desc(scheduleJobAttempts.attemptNumber))
        .limit(1);
      const now = new Date();
      const attemptNumber = command.deliveryAttempt ?? (previousAttempt?.attemptNumber ?? 0) + 1;
      const reclaimRunning = current.status === "running"
        && command.reclaimRunning === true
        && previousAttempt?.finishedAt === null
        && attemptNumber > previousAttempt.attemptNumber;
      const claimQueued = current.status === "queued"
        && attemptNumber > (previousAttempt?.attemptNumber ?? 0);
      if (!claimQueued && !reclaimRunning) {
        return { resolution: "not_claimable", job: toScheduleJob(current) };
      }
      if (reclaimRunning && previousAttempt) {
        const reclaimedError = {
          category: "internal" as const,
          code: "worker_delivery_reclaimed",
          message: "Worker delivery was reclaimed after execution stopped.",
          retryable: true,
        };
        await db.update(scheduleJobAttempts).set({
          status: "failed",
          finishedAt: now,
          durationMs: Math.max(0, now.getTime() - previousAttempt.startedAt.getTime()),
          error: reclaimedError,
        }).where(eq(scheduleJobAttempts.id, previousAttempt.id));
        await this.insertScheduleJobEvent(db, current, "schedule_job.retry_scheduled", {
          status: current.status,
          attemptId: previousAttempt.id,
          attemptNumber: previousAttempt.attemptNumber,
          error: reclaimedError,
          retryAt: now.toISOString(),
          reason: "worker_delivery_reclaimed",
        }, now);
      }
      const [attempt] = await db.insert(scheduleJobAttempts).values({
        id: `attempt-${randomUUID()}`,
        jobId: id,
        attemptNumber,
        status: "started",
        schedulerRequestId: `${current.traceId}:attempt:${attemptNumber}`,
        startedAt: now,
      }).returning();
      const [row] = await db.update(scheduleJobs).set({
        status: "running",
        progress: 35,
        error: null,
        errorCategory: null,
        errorCode: null,
        errorRetryable: null,
        startedAt: current.startedAt ?? now,
        finishedAt: null,
        updatedAt: now,
      }).where(eq(scheduleJobs.id, id)).returning();
      await this.insertScheduleJobEvent(db, row, "schedule_job.attempt_started", {
        status: row.status,
        attemptId: attempt.id,
        attemptNumber,
        schedulerRequestId: attempt.schedulerRequestId,
      }, now);
      await this.insertScheduleJobEvent(db, row, "schedule_job.running", {
        status: row.status,
        progress: row.progress,
        attemptNumber,
      }, now);
      return {
        resolution: "claimed",
        job: toScheduleJob(row),
        attempt: toScheduleJobAttempt(attempt),
        requestSnapshot: parsedSnapshot.data,
      };
    }, () => ({ resolution: "not_found", job: null }));
  }

  async failScheduleJobAttempt(
    id: string,
    command: FailScheduleJobAttemptCommand,
  ): Promise<ScheduleJobExecutionTransitionResult> {
    return this.withLockedScheduleJob<ScheduleJobExecutionTransitionResult>(
      id,
      async (db, current) => {
      const [attempt] = await db
        .select()
        .from(scheduleJobAttempts)
        .where(eq(scheduleJobAttempts.id, command.attemptId))
        .limit(1);
      if (!attempt || attempt.jobId !== id) {
        return { job: toScheduleJob(current), resolution: "stale_attempt" };
      }
      if (attempt.finishedAt !== null) {
        const expectedStatus = command.outcome === "retry" ? "queued" : command.outcome;
        return {
          job: toScheduleJob(current),
          resolution: current.status === expectedStatus ? "idempotent" : "stale_attempt",
        };
      }
      const [latestAttempt] = await db
        .select({ id: scheduleJobAttempts.id })
        .from(scheduleJobAttempts)
        .where(eq(scheduleJobAttempts.jobId, id))
        .orderBy(desc(scheduleJobAttempts.attemptNumber))
        .limit(1);
      if (current.status !== "running" || latestAttempt?.id !== attempt.id) {
        return { job: toScheduleJob(current), resolution: "stale_attempt" };
      }

      const now = new Date();
      const status = command.outcome === "retry" ? "queued" : command.outcome;
      const retryAt = command.outcome === "retry" ? parseRetryAt(command.retryAt) : null;
      await db.update(scheduleJobAttempts).set({
        status: command.outcome === "retry" ? "failed" : command.outcome,
        finishedAt: now,
        durationMs: Math.max(0, now.getTime() - attempt.startedAt.getTime()),
        error: command.error,
      }).where(eq(scheduleJobAttempts.id, attempt.id));
      const [row] = await db.update(scheduleJobs).set({
        status,
        progress: command.outcome === "retry" ? 15 : 100,
        error: command.error.message,
        errorCategory: command.error.category,
        errorCode: command.error.code,
        errorRetryable: command.error.retryable,
        cancellationRequestedAt: command.outcome === "cancelled"
          ? current.cancellationRequestedAt ?? now
          : current.cancellationRequestedAt,
        finishedAt: command.outcome === "retry" ? null : now,
        updatedAt: now,
      }).where(eq(scheduleJobs.id, id)).returning();
      const eventType = command.outcome === "retry"
        ? "schedule_job.retry_scheduled"
        : `schedule_job.${command.outcome}`;
      await this.insertScheduleJobEvent(db, row, eventType, {
        status,
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        error: command.error,
        retryAt: retryAt?.toISOString() ?? null,
      }, now, retryAt ?? now);
        return { job: toScheduleJob(row), resolution: "apply" };
      },
      () => ({ job: null, resolution: "not_found" }),
    );
  }

  async completeScheduleJob(
    id: string,
    command: CompleteScheduleJobCommand,
  ): Promise<ScheduleJobExecutionTransitionResult> {
    return this.withLockedScheduleJob<ScheduleJobExecutionTransitionResult>(
      id,
      async (db, current) => {
      const [attempt] = await db
        .select()
        .from(scheduleJobAttempts)
        .where(eq(scheduleJobAttempts.id, command.attemptId))
        .limit(1);
      if (!attempt || attempt.jobId !== id) {
        return { job: toScheduleJob(current), resolution: "stale_attempt" };
      }
      if (attempt.finishedAt !== null) {
        return {
          job: toScheduleJob(current),
          resolution: current.runId !== null ? "idempotent" : "stale_attempt",
        };
      }
      const [latestAttempt] = await db
        .select({ id: scheduleJobAttempts.id })
        .from(scheduleJobAttempts)
        .where(eq(scheduleJobAttempts.jobId, id))
        .orderBy(desc(scheduleJobAttempts.attemptNumber))
        .limit(1);
      if (current.status !== "running" || latestAttempt?.id !== attempt.id) {
        return { job: toScheduleJob(current), resolution: "stale_attempt" };
      }

      const status = scheduleJobStatusForSolveResult(command.result.statistics.status);
      if (
        current.constraintProfileVersionId === null
        || current.constraintProfileSnapshot.schemaVersion !== 1
      ) {
        throw new Error(`Schedule job ${id} does not contain a current strategy snapshot.`);
      }
      const runId = await this.insertScheduleRun(
        db,
        command.result,
        current.batchId,
        current.constraintProfileVersionId,
        current.constraintProfileSnapshot,
        command.schedulerVersion ?? "unknown",
      );
      const now = new Date();
      const error = status === "failed" ? {
        category: "internal" as const,
        code: "scheduler_result_error",
        message: "Scheduler returned an error result.",
        retryable: true,
      } : null;
      await db.update(scheduleJobAttempts).set({
        status,
        finishedAt: now,
        durationMs: Math.max(0, now.getTime() - attempt.startedAt.getTime()),
        error,
      }).where(eq(scheduleJobAttempts.id, attempt.id));
      const [row] = await db.update(scheduleJobs).set({
        status,
        progress: 100,
        runId,
        error: error?.message ?? null,
        errorCategory: error?.category ?? null,
        errorCode: error?.code ?? null,
        errorRetryable: error?.retryable ?? null,
        finishedAt: now,
        updatedAt: now,
      }).where(eq(scheduleJobs.id, id)).returning();
      await this.insertScheduleJobEvent(db, row, "schedule_job.run_created", {
        status,
        runId,
        attemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
      }, now);
      await this.insertScheduleJobEvent(db, row, `schedule_job.${status}`, {
        status,
        runId,
        attemptId: attempt.id,
      }, now);
        return { job: toScheduleJob(row), resolution: "apply" };
      },
      () => ({ job: null, resolution: "not_found" }),
    );
  }

  async transitionScheduleJob(
    id: string,
    command: TransitionScheduleJobCommand,
  ): Promise<ScheduleJobTransitionResult> {
    if (command.to === "running") {
      const claim = await this.claimScheduleJob(id);
      if (claim.resolution === "claimed") {
        return { job: claim.job, resolution: "apply" };
      }
      return {
        job: claim.job,
        resolution: claim.resolution === "not_found" ? "not_found" : "reject",
      };
    }
    return this.withLockedScheduleJob<ScheduleJobTransitionResult>(id, async (db, current) => {
      const resolution = resolveScheduleJobTransition(current.status, command.to);
      if (resolution !== "apply") {
        return { job: toScheduleJob(current), resolution };
      }
      const now = new Date();
      const terminal = isTerminalStatus(command.to);
      const [row] = await db.update(scheduleJobs).set({
        status: command.to,
        progress: command.progress,
        error: command.error?.message ?? null,
        errorCategory: command.error?.category ?? null,
        errorCode: command.error?.code ?? null,
        errorRetryable: command.error?.retryable ?? null,
        cancellationRequestedAt: command.to === "cancelled"
          ? current.cancellationRequestedAt ?? now
          : current.cancellationRequestedAt,
        finishedAt: terminal ? now : current.finishedAt,
        updatedAt: now,
      }).where(eq(scheduleJobs.id, id)).returning();
      if (terminal) {
        const [attempt] = await db
          .select()
          .from(scheduleJobAttempts)
          .where(eq(scheduleJobAttempts.jobId, id))
          .orderBy(desc(scheduleJobAttempts.attemptNumber))
          .limit(1);
        if (attempt && attempt.finishedAt === null) {
          await db.update(scheduleJobAttempts).set({
            status: command.to,
            finishedAt: now,
            durationMs: Math.max(0, now.getTime() - attempt.startedAt.getTime()),
            error: command.error ?? null,
          }).where(eq(scheduleJobAttempts.id, attempt.id));
        }
      }
      await this.insertScheduleJobEvent(db, row, `schedule_job.${command.to}`, {
        status: command.to,
        progress: command.progress,
        error: command.error ?? null,
      }, now);
      return { job: toScheduleJob(row), resolution: "apply" };
    }, () => ({ job: null, resolution: "not_found" }));
  }

  async processOutboxBatch(
    options: ProcessOutboxBatchOptions,
    deliver: (event: ScheduleJobOutboxEvent) => Promise<void>,
  ): Promise<ProcessOutboxBatchResult> {
    const batchSize = positiveInteger(options.batchSize, "batchSize");
    const retryBaseDelayMs = positiveInteger(
      options.retryBaseDelayMs ?? 1_000,
      "retryBaseDelayMs",
    );
    const retryMaxDelayMs = positiveInteger(
      options.retryMaxDelayMs ?? 30_000,
      "retryMaxDelayMs",
    );
    const now = options.now ?? new Date();
    return this.withTransaction(async (_db, connection) => {
      const result = await connection.query<{
        id: string;
        aggregateId: string;
        eventType: string;
        attemptCount: number;
        payload: unknown;
      }>(`
        SELECT
          id,
          aggregate_id AS "aggregateId",
          event_type AS "eventType",
          attempt_count AS "attemptCount",
          payload
        FROM outbox_events
        WHERE published_at IS NULL
          AND available_at <= $1
        ORDER BY available_at, occurred_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      `, [now, batchSize]);
      let published = 0;
      let failed = 0;
      for (const row of result.rows) {
        const event: ScheduleJobOutboxEvent = {
          id: row.id,
          aggregateId: row.aggregateId,
          eventType: row.eventType,
          attemptCount: row.attemptCount,
          event: scheduleJobEventEnvelopeSchema.parse(row.payload),
        };
        try {
          await deliver(event);
          await connection.query(`
            UPDATE outbox_events
            SET published_at = $2,
              attempt_count = attempt_count + 1,
              last_error = NULL
            WHERE id = $1
          `, [row.id, now]);
          published += 1;
        } catch {
          const attemptNumber = row.attemptCount + 1;
          const delayMs = Math.min(
            retryMaxDelayMs,
            retryBaseDelayMs * (2 ** Math.max(0, attemptNumber - 1)),
          );
          await connection.query(`
            UPDATE outbox_events
            SET attempt_count = attempt_count + 1,
              last_error = 'Outbox delivery failed.',
              available_at = $2
            WHERE id = $1
          `, [row.id, new Date(now.getTime() + delayMs)]);
          failed += 1;
        }
      }
      return {
        claimed: result.rows.length,
        published,
        failed,
      };
    });
  }

  private async withLockedScheduleJob<T>(
    id: string,
    operation: (db: ExamForgeDatabase, current: ScheduleJobRow) => Promise<T>,
    notFound: () => T,
  ): Promise<T> {
    return this.withTransaction(async (db, connection) => {
      const lockResult = await connection.query<{ id: string }>(
        "SELECT id FROM schedule_jobs WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (lockResult.rowCount === 0) {
        return notFound();
      }
      const [current] = await db
        .select()
        .from(scheduleJobs)
        .where(eq(scheduleJobs.id, id))
        .limit(1);
      return operation(db, current);
    });
  }

  private async withTransaction<T>(
    operation: (
      db: ExamForgeDatabase,
      connection: PoolClient,
    ) => Promise<T>,
  ): Promise<T> {
    const connection = await this.client.pool.connect();
    const session = createDbSession(connection);
    try {
      await connection.query("BEGIN");
      const result = await operation(session.db, connection);
      await session.drain();
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      await session.drain();
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }

  private async insertScheduleJobEvent(
    db: ExamForgeDatabase,
    job: ScheduleJobRow,
    eventType: string,
    payload: Record<string, unknown>,
    occurredAt: Date,
    availableAt = occurredAt,
  ) {
    const eventId = `event-${randomUUID()}`;
    const eventVersion = 1;
    const [event] = await db.insert(scheduleJobEvents).values({
      id: eventId,
      jobId: job.id,
      eventType,
      eventVersion,
      occurredAt,
      payload,
      traceId: job.traceId,
    }).returning({ sequence: scheduleJobEvents.sequence });
    await db.insert(outboxEvents).values({
      id: `outbox-${randomUUID()}`,
      eventId,
      aggregateType: "schedule_job",
      aggregateId: job.id,
      eventType,
      eventVersion,
      payload: {
        eventId,
        sequence: event.sequence,
        jobId: job.id,
        type: eventType,
        version: eventVersion,
        occurredAt: occurredAt.toISOString(),
        payload,
        traceId: job.traceId,
      },
      occurredAt,
      availableAt,
    });
  }

  private async insertScheduleRun(
    db: ExamForgeDatabase,
    result: ScheduleResult,
    batchId: string,
    constraintProfileVersionId: string,
    constraintProfileSnapshot: Extract<
      ScheduleJobRow["constraintProfileSnapshot"],
      { schemaVersion: 1 }
    >,
    schedulerVersion: string,
  ): Promise<string> {
    const runId = `run-${randomUUID()}`;
    const createdAt = new Date();
    await db.insert(scheduleRuns).values({
      id: runId,
      batchId,
      status: result.statistics.status,
      score: result.score.total_score,
      scoreBreakdown: result.score,
      conflictCount: result.conflicts.length,
      assignmentCount: result.assignments.length,
      elapsedMs: result.statistics.elapsed_ms,
      statistics: result.statistics,
      report: result.report ?? {},
      constraintProfileVersionId,
      constraintProfileSnapshot,
      schedulerVersion,
      scoringContractVersion: result.score.scoring_contract_version,
      normalizedScore: result.score.normalized_score,
      createdAt,
    });
    if (result.assignments.length > 0) {
      const examRows = result.assignments.map((assignment, index) => ({
        id: `${runId}-exam-${index + 1}`,
        runId,
        examTaskId: assignment.exam_task_id,
        roomId: assignment.room_id,
        timeSlotId: assignment.time_slot_id,
      }));
      await db.insert(scheduledExams).values(examRows);
      const invigilatorRows = examRows.flatMap((row, index) => (
        result.assignments[index].teacher_ids.map((teacherId, teacherIndex) => ({
          scheduledExamId: row.id,
          position: teacherIndex + 1,
          teacherId,
        }))
      ));
      if (invigilatorRows.length > 0) {
        await db.insert(scheduledExamInvigilators).values(invigilatorRows);
      }
    }
    if (result.conflicts.length > 0) {
      await db.insert(conflictRecords).values(result.conflicts.map((conflict, index) => ({
        id: `${runId}-conflict-${index + 1}`,
        runId,
        type: conflict.type,
        severity: conflict.severity,
        affectedIds: conflict.affected_ids,
        message: conflict.message,
        suggestion: conflict.suggestion,
      })));
    }
    await db.insert(auditEvents).values({
      id: `audit-${randomUUID()}`,
      actor: "system",
      actorUserId: null,
      actorRoles: [],
      action: "schedule_run.created",
      entityType: "schedule_run",
      entityId: runId,
      payload: {
        batchId,
        status: result.statistics.status,
        score: result.score.total_score,
        assignmentCount: result.assignments.length,
        conflictCount: result.conflicts.length,
      },
    });
    return runId;
  }

}

function toScheduleJob(job: ScheduleJobRow): ScheduleJobSummary {
  return {
    id: job.id,
    batchId: job.batchId,
    status: job.status,
    progress: job.progress,
    idempotencyKey: job.idempotencyKey,
    requestDigest: job.requestDigest,
    constraintProfileVersionId: job.constraintProfileVersionId,
    constraintProfileSnapshot: job.constraintProfileSnapshot.schemaVersion === 1
      ? job.constraintProfileSnapshot
      : null,
    submittedBy: job.submittedBy,
    submittedByUserId: job.submittedByUserId,
    traceId: job.traceId,
    runId: job.runId,
    error: job.error && job.errorCategory && job.errorCode && job.errorRetryable !== null
      ? {
          category: job.errorCategory as NonNullable<ScheduleJobSummary["error"]>["category"],
          code: job.errorCode,
          message: job.error,
          retryable: job.errorRetryable,
        }
      : null,
    cancellationRequestedAt: job.cancellationRequestedAt?.toISOString() ?? null,
    queuedAt: job.queuedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function toScheduleJobAttempt(attempt: ScheduleJobAttemptRow): ScheduleJobAttempt {
  return {
    id: attempt.id,
    jobId: attempt.jobId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status as ScheduleJobAttempt["status"],
    schedulerRequestId: attempt.schedulerRequestId,
    startedAt: attempt.startedAt.toISOString(),
    finishedAt: attempt.finishedAt?.toISOString() ?? null,
    durationMs: attempt.durationMs,
    error: attempt.error as ScheduleJobError | null,
  };
}

function toScheduleJobEvent(event: ScheduleJobEventRow): ScheduleJobEventEnvelope {
  return scheduleJobEventEnvelopeSchema.parse({
    eventId: event.id,
    sequence: event.sequence,
    jobId: event.jobId,
    type: event.eventType,
    version: event.eventVersion,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
    traceId: event.traceId,
  });
}

function parseRetryAt(value: string | null) {
  if (!value) {
    throw new Error("Retry outcome requires retryAt.");
  }
  const retryAt = new Date(value);
  if (Number.isNaN(retryAt.getTime())) {
    throw new Error("retryAt must be a valid timestamp.");
  }
  return retryAt;
}

function isTerminalStatus(status: ScheduleJobStatus) {
  return status === "succeeded"
    || status === "failed"
    || status === "cancelled"
    || status === "timed_out";
}

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function boundedPositiveInteger(value: number, name: string, maximum: number) {
  const parsed = positiveInteger(value, name);
  if (parsed > maximum) {
    throw new Error(`${name} must not exceed ${maximum}.`);
  }
  return parsed;
}
