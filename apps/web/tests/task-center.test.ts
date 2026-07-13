import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ScheduleJobAttempt,
  ScheduleJobEventEnvelope,
  ScheduleJobSummary,
} from "@examforge/shared";
import {
  buildJobTimeline,
} from "../features/async-jobs/async-job-panel.js";
import {
  buildScheduleJobApiQuery,
  fallbackScheduleJobPage,
  readScheduleJobsPageState,
  updateScheduleJobsPageSearch,
} from "../features/async-jobs/job-page-model.js";
import {
  confirmDefaultProfileChange,
  profileConfigFromForm,
} from "../features/constraint-profiles/constraint-profile-panel.js";

describe("task center models", () => {
  it("normalizes shareable job filters and builds bounded API parameters", () => {
    const state = readScheduleJobsPageState(new URLSearchParams(
      "status=failed&submittedBy=%20admin%20&constraintProfileVersionId=profile-v2"
      + "&from=2026-07-13&to=2026-07-14&page=2&pageSize=50&jobId=job-2",
    ));
    assert.deepEqual(state, {
      status: "failed",
      submittedBy: "admin",
      constraintProfileVersionId: "profile-v2",
      from: "2026-07-13",
      to: "2026-07-14",
      page: 2,
      pageSize: 50,
      jobId: "job-2",
    });
    assert.deepEqual(buildScheduleJobApiQuery(state), {
      status: "failed",
      submittedBy: "admin",
      constraintProfileVersionId: "profile-v2",
      from: "2026-07-13T00:00:00.000Z",
      to: "2026-07-14T23:59:59.999Z",
      page: 2,
      pageSize: 50,
    });
    assert.deepEqual(
      readScheduleJobsPageState(new URLSearchParams("status=unknown&from=no&page=0&pageSize=500")),
      {
        status: "all",
        submittedBy: "",
        constraintProfileVersionId: "",
        from: "",
        to: "",
        page: 1,
        pageSize: 20,
        jobId: "",
      },
    );
  });

  it("resets pagination for filters, preserves inspectors, and falls back from empty pages", () => {
    assert.equal(updateScheduleJobsPageSearch(
      new URLSearchParams("status=failed&page=4&jobId=job-2&trace=keep"),
      { status: "queued", page: 1 },
    ), "status=queued&jobId=job-2&trace=keep");
    assert.equal(fallbackScheduleJobPage(9, 3, 28), 3);
    assert.equal(fallbackScheduleJobPage(9, 0, 0), 1);
  });

  it("builds an ordered attempt timeline without parsing display text", () => {
    const currentJob = job("job-running", {
      status: "succeeded",
      attemptCount: 2,
      queuedAt: "2026-07-13T08:00:00.000Z",
      startedAt: "2026-07-13T08:00:02.000Z",
      finishedAt: "2026-07-13T08:00:09.000Z",
      runId: "run-1",
    });
    const attempts: ScheduleJobAttempt[] = [
      attempt("attempt-1", 1, "failed", "2026-07-13T08:00:02.000Z", "2026-07-13T08:00:04.000Z"),
      attempt("attempt-2", 2, "succeeded", "2026-07-13T08:00:06.000Z", "2026-07-13T08:00:09.000Z"),
    ];
    const events: ScheduleJobEventEnvelope[] = [
      event(1, "schedule_job.queued", "2026-07-13T08:00:00.000Z", { status: "queued" }),
      event(2, "schedule_job.attempt_started", "2026-07-13T08:00:02.000Z", { attemptNumber: 1 }),
      event(3, "schedule_job.retry_scheduled", "2026-07-13T08:00:04.000Z", { attemptNumber: 1 }),
      event(4, "schedule_job.attempt_started", "2026-07-13T08:00:06.000Z", { attemptNumber: 2 }),
      event(5, "schedule_job.succeeded", "2026-07-13T08:00:09.000Z", { status: "succeeded", runId: "run-1" }),
    ];
    const timeline = buildJobTimeline(currentJob, events, attempts);

    assert.deepEqual(timeline.map((item) => item.code), [
      "1:schedule_job.queued",
      "2:schedule_job.attempt_started",
      "3:schedule_job.retry_scheduled",
      "4:schedule_job.attempt_started",
      "5:schedule_job.succeeded",
    ]);
    assert.equal(timeline[1].detail, "第 1 次执行 · scheduler-request-1");
    assert.equal(timeline[2].detail, "第 1 次执行失败，等待重试");
    assert.equal(timeline[3].detail, "第 2 次执行 · scheduler-request-2");
    assert.equal(timeline[4].detail, "生成 run-1");
  });

  it("converts governed weight inputs to an immutable profile config", () => {
    assert.deepEqual(profileConfigFromForm({
      hardRules: "room_capacity\nteacher_time_unique",
      softWeights: {
        room_utilization: "4",
        teacher_workload_balance: "8",
      },
      timeLimitSeconds: "20",
    }), {
      hard_rules: ["room_capacity", "teacher_time_unique"],
      soft_weights: {
        room_utilization: 4,
        teacher_workload_balance: 8,
      },
      time_limit_seconds: 20,
    });
  });

  it("requires an explicit confirmation before changing the default strategy", () => {
    const prompts: string[] = [];
    assert.equal(confirmDefaultProfileChange("High capacity", (message) => {
      prompts.push(message);
      return false;
    }), false);
    assert.deepEqual(prompts, ["确认将策略“High capacity”设为默认？后续新任务将使用其当前版本。"]);
  });
});

function job(id: string, overrides: Partial<ScheduleJobSummary>): ScheduleJobSummary {
  return {
    id,
    batchId: "batch-1",
    status: "queued",
    progress: 0,
    idempotencyKey: `${id}-key`,
    requestDigest: "a".repeat(64),
    traceId: `${id}-trace`,
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

function attempt(
  id: string,
  attemptNumber: number,
  status: ScheduleJobAttempt["status"],
  startedAt: string,
  finishedAt: string,
): ScheduleJobAttempt {
  return {
    id,
    jobId: "job-running",
    attemptNumber,
    status,
    schedulerRequestId: `scheduler-request-${attemptNumber}`,
    startedAt,
    finishedAt,
    durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    error: status === "failed" ? {
      category: "unavailable",
      code: "scheduler_unavailable",
      message: "Scheduler unavailable.",
      retryable: true,
    } : null,
  };
}

function event(
  sequence: number,
  type: ScheduleJobEventEnvelope["type"],
  occurredAt: string,
  payload: Record<string, unknown>,
): ScheduleJobEventEnvelope {
  return {
    eventId: `event-${sequence}`,
    sequence,
    jobId: "job-running",
    type,
    version: 1,
    occurredAt,
    payload,
    traceId: "trace-job-running",
  };
}
