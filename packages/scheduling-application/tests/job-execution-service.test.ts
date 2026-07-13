import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  demoScheduleInput,
  type ScheduleJobAttempt,
  type ScheduleJobSummary,
  type ScheduleResult,
} from "@examforge/shared";
import {
  JobExecutionService,
  SchedulerClientError,
  type CompleteScheduleJobCommand,
  type ClaimScheduleJobCommand,
  type FailScheduleJobAttemptCommand,
  type ScheduleJobClaimResult,
  type ScheduleJobExecutionRepository,
  type ScheduleJobExecutionTransitionResult,
  type ScheduleResultWriter,
  type SchedulerClient,
  type SchedulerSolveOptions,
} from "../src/index.js";

describe("job execution service", () => {
  it("claims a queued snapshot and completes the matching attempt", async () => {
    const harness = createHarness();

    const result = await harness.service.execute("job-1", {
      deliveryAttempt: 1,
      reclaimRunning: true,
    });

    assert.equal(result.resolution, "succeeded");
    assert.deepEqual(harness.scheduler.inputs, [demoScheduleInput]);
    assert.equal(harness.scheduler.options[0]?.requestId, "trace-1:attempt:1");
    assert.equal(harness.writer.commands[0]?.attemptId, "attempt-1");
    assert.equal(harness.writer.commands[0]?.schedulerVersion, "0.1.0-test");
    assert.deepEqual(harness.repository.claimCommands, [{
      deliveryAttempt: 1,
      reclaimRunning: true,
    }]);
  });

  it("does not invoke the scheduler for a duplicate running delivery", async () => {
    const job = buildJob({ status: "running", progress: 35 });
    const harness = createHarness({
      claim: { resolution: "not_claimable", job },
    });

    const result = await harness.service.execute(job.id);

    assert.equal(result.resolution, "not_claimable");
    assert.equal(harness.scheduler.inputs.length, 0);
    assert.equal(harness.writer.commands.length, 0);
  });

  it("schedules an allowed retry before the attempt limit", async () => {
    const failure = new SchedulerClientError(
      "Scheduler service is unavailable.",
      "unavailable",
      "scheduler_unavailable",
      true,
      "trace-1:attempt:1",
    );
    const harness = createHarness({ schedulerError: failure });

    const result = await harness.service.execute("job-1");

    assert.equal(result.resolution, "retry_scheduled");
    assert.equal(harness.repository.failures[0]?.outcome, "retry");
    assert.equal(harness.repository.failures[0]?.error.code, "scheduler_unavailable");
    assert.match(harness.repository.failures[0]?.retryAt ?? "", /^2026-07-13T08:00:01/);
  });

  it("ends a retryable failure after the attempt limit", async () => {
    const failure = new SchedulerClientError(
      "Scheduler failed to process the request.",
      "internal",
      "scheduler_internal_error",
      true,
      "trace-1:attempt:3",
    );
    const harness = createHarness({
      attemptNumber: 3,
      schedulerError: failure,
    });

    const result = await harness.service.execute("job-1");

    assert.equal(result.resolution, "failed");
    assert.equal(harness.repository.failures[0]?.outcome, "failed");
    assert.equal(harness.repository.failures[0]?.retryAt, null);
  });

  it("maps non-retryable, timeout and cancelled failures to stable outcomes", async () => {
    const cases = [
      {
        error: new SchedulerClientError(
          "Schedule input failed semantic validation.",
          "validation",
          "scheduler_input_invalid",
          false,
        ),
        outcome: "failed",
      },
      {
        error: new SchedulerClientError(
          "Scheduler response does not match the HTTP contract.",
          "protocol",
          "scheduler_protocol_invalid",
          false,
        ),
        outcome: "failed",
      },
      {
        error: new SchedulerClientError(
          "Scheduler request exceeded its deadline.",
          "timeout",
          "scheduler_timeout",
          true,
        ),
        outcome: "timed_out",
      },
      {
        error: new SchedulerClientError(
          "Scheduler request was cancelled.",
          "cancelled",
          "scheduler_cancelled",
          false,
        ),
        outcome: "cancelled",
      },
    ] as const;

    for (const testCase of cases) {
      const harness = createHarness({ schedulerError: testCase.error });
      const result = await harness.service.execute("job-1");

      assert.equal(result.resolution, testCase.outcome);
      assert.equal(harness.repository.failures[0]?.outcome, testCase.outcome);
      assert.equal(harness.repository.failures[0]?.retryAt, null);
    }
  });

  it("reports a stale success when cancellation wins the terminal race", async () => {
    const cancelled = buildJob({
      status: "cancelled",
      progress: 100,
      finishedAt: "2026-07-13T08:00:02.000Z",
      cancellationRequestedAt: "2026-07-13T08:00:01.000Z",
    });
    const harness = createHarness({
      completion: { job: cancelled, resolution: "reject" },
    });

    const result = await harness.service.execute("job-1");

    assert.equal(result.resolution, "stale");
    assert.equal(result.job?.status, "cancelled");
    assert.equal(harness.writer.commands[0]?.attemptId, "attempt-1");
  });
});

class RecordingScheduler implements SchedulerClient {
  readonly inputs = [] as typeof demoScheduleInput[];
  readonly options: Array<SchedulerSolveOptions | undefined> = [];

  constructor(private readonly error?: Error) {}

  async solve(
    input: typeof demoScheduleInput,
    options?: SchedulerSolveOptions,
  ): Promise<ScheduleResult> {
    this.inputs.push(structuredClone(input));
    this.options.push(options);
    if (this.error) {
      throw this.error;
    }
    options?.onMetadata?.({ schedulerVersion: "0.1.0-test" });
    return buildResult();
  }
}

class RecordingExecutionRepository implements ScheduleJobExecutionRepository {
  readonly failures: FailScheduleJobAttemptCommand[] = [];
  readonly claimCommands: ClaimScheduleJobCommand[] = [];

  constructor(private readonly claim: ScheduleJobClaimResult) {}

  async claimScheduleJob(
    _jobId: string,
    command: ClaimScheduleJobCommand,
  ): Promise<ScheduleJobClaimResult> {
    this.claimCommands.push(command);
    return this.claim;
  }

  async failScheduleJobAttempt(
    _jobId: string,
    command: FailScheduleJobAttemptCommand,
  ): Promise<ScheduleJobExecutionTransitionResult> {
    this.failures.push(command);
    const status = command.outcome === "retry" ? "queued" : command.outcome;
    return {
      resolution: "apply",
      job: buildJob({
        status: status === "timed_out" || status === "cancelled" || status === "failed"
          ? status
          : "queued",
      }),
    };
  }
}

class RecordingResultWriter implements ScheduleResultWriter {
  readonly commands: CompleteScheduleJobCommand[] = [];

  constructor(private readonly completion: ScheduleJobExecutionTransitionResult) {}

  async completeScheduleJob(
    _jobId: string,
    command: CompleteScheduleJobCommand,
  ): Promise<ScheduleJobExecutionTransitionResult> {
    this.commands.push(command);
    return this.completion;
  }
}

function createHarness(options: {
  claim?: ScheduleJobClaimResult;
  attemptNumber?: number;
  schedulerError?: Error;
  completion?: ScheduleJobExecutionTransitionResult;
} = {}) {
  const attempt = buildAttempt(options.attemptNumber ?? 1);
  const running = buildJob({ status: "running", progress: 35 });
  const claim = options.claim ?? {
    resolution: "claimed" as const,
    job: running,
    attempt,
    requestSnapshot: { version: 1 as const, input: demoScheduleInput },
  };
  const repository = new RecordingExecutionRepository(claim);
  const scheduler = new RecordingScheduler(options.schedulerError);
  const writer = new RecordingResultWriter(options.completion ?? {
    resolution: "apply",
    job: buildJob({
      status: "succeeded",
      progress: 100,
      runId: "run-1",
      finishedAt: "2026-07-13T08:00:01.000Z",
    }),
  });
  const service = new JobExecutionService(repository, writer, scheduler, {
    maxAttempts: 3,
    retryBaseDelayMs: 1_000,
    now: () => new Date("2026-07-13T08:00:00.000Z"),
  });
  return { repository, scheduler, writer, service };
}

function buildAttempt(attemptNumber: number): ScheduleJobAttempt {
  return {
    id: `attempt-${attemptNumber}`,
    jobId: "job-1",
    attemptNumber,
    status: "started",
    schedulerRequestId: `trace-1:attempt:${attemptNumber}`,
    startedAt: "2026-07-13T08:00:00.000Z",
    finishedAt: null,
    durationMs: null,
    error: null,
  };
}

function buildJob(overrides: Partial<ScheduleJobSummary> = {}): ScheduleJobSummary {
  return {
    id: "job-1",
    batchId: "batch-2026-spring-final",
    status: "queued",
    progress: 0,
    idempotencyKey: "job-request-1",
    requestDigest: "a".repeat(64),
    traceId: "trace-1",
    runId: null,
    error: null,
    cancellationRequestedAt: null,
    queuedAt: "2026-07-13T08:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-07-13T08:00:00.000Z",
    updatedAt: "2026-07-13T08:00:00.000Z",
    ...overrides,
  };
}

function buildResult(): ScheduleResult {
  return {
    assignments: [],
    conflicts: [],
    score: {
      total_score: 100,
      hard_violation_count: 0,
      soft_penalty_items: [],
    },
    statistics: {
      status: "feasible",
      elapsed_ms: 1,
      exam_count: 0,
      room_count: 0,
      slot_count: 0,
      attempted_assignments: 0,
    },
  };
}
