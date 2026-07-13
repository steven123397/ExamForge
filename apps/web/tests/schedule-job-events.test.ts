import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ScheduleJobEventEnvelope,
  ScheduleJobListResponse,
  ScheduleJobSummary,
} from "@examforge/shared";
import {
  ScheduleJobSseParser,
  applyScheduleJobEventToList,
  selectScheduleJobEventTargets,
} from "../features/async-jobs/use-schedule-job-events.js";

describe("schedule job event client", () => {
  it("parses versioned SSE frames across arbitrary chunks and ignores heartbeats", () => {
    const parser = new ScheduleJobSseParser();
    const event = buildEvent("schedule_job.running", {
      status: "running",
      progress: 35,
      attemptNumber: 2,
    });
    const frame = [
      `id: ${event.eventId}`,
      "event: schedule_job.running.v1",
      `data: ${JSON.stringify(event)}`,
      "",
      ": heartbeat 1",
      "",
    ].join("\n");

    assert.deepEqual(parser.push(frame.slice(0, 31)), []);
    assert.deepEqual(parser.push(frame.slice(31)), [event]);
  });

  it("merges event progress, retry count, cancellation, and terminal data into query cache", () => {
    const initial: ScheduleJobListResponse = {
      jobs: [buildJob()],
      page: 1,
      pageSize: 20,
      total: 1,
      pageCount: 1,
    };
    const running = applyScheduleJobEventToList(initial, buildEvent(
      "schedule_job.running",
      { status: "running", progress: 35, attemptNumber: 2 },
    ));
    assert.equal(running.jobs[0].status, "running");
    assert.equal(running.jobs[0].progress, 35);
    assert.equal(running.jobs[0].attemptCount, 2);

    const cancellation = applyScheduleJobEventToList(running, buildEvent(
      "schedule_job.cancellation_requested",
      { status: "running" },
    ));
    assert.equal(cancellation.jobs[0].cancellationRequestedAt, "2026-07-13T08:00:00.000Z");

    const succeeded = applyScheduleJobEventToList(cancellation, buildEvent(
      "schedule_job.succeeded",
      { status: "succeeded", runId: "run-1" },
    ));
    assert.equal(succeeded.jobs[0].status, "succeeded");
    assert.equal(succeeded.jobs[0].progress, 100);
    assert.equal(succeeded.jobs[0].runId, "run-1");
    assert.equal(succeeded.jobs[0].finishedAt, "2026-07-13T08:00:00.000Z");
  });

  it("bounds concurrent streams while always prioritizing the running job", () => {
    const jobs = [
      buildJob("queued-newest", "queued"),
      buildJob("queued-newer", "queued"),
      buildJob("queued-middle", "queued"),
      buildJob("queued-older", "queued"),
      buildJob("running-oldest", "running"),
      buildJob("finished", "succeeded"),
    ];

    assert.deepEqual(selectScheduleJobEventTargets(jobs), [
      "running-oldest",
      "queued-newest",
      "queued-newer",
      "queued-middle",
    ]);
  });
});

function buildJob(
  id = "job-1",
  status: ScheduleJobSummary["status"] = "queued",
): ScheduleJobSummary {
  return {
    id,
    batchId: "batch-1",
    status,
    progress: 0,
    idempotencyKey: "request-1",
    requestDigest: "a".repeat(64),
    traceId: "trace-1",
    runId: null,
    error: null,
    attemptCount: 0,
    cancellationRequestedAt: null,
    queuedAt: "2026-07-13T07:59:00.000Z",
    startedAt: null,
    finishedAt: null,
    createdAt: "2026-07-13T07:59:00.000Z",
    updatedAt: "2026-07-13T07:59:00.000Z",
  };
}

function buildEvent(
  type: ScheduleJobEventEnvelope["type"],
  payload: Record<string, unknown>,
): ScheduleJobEventEnvelope {
  return {
    eventId: `event-${type}`,
    sequence: 1,
    jobId: "job-1",
    type,
    version: 1,
    occurredAt: "2026-07-13T08:00:00.000Z",
    payload,
    traceId: "trace-1",
  };
}
