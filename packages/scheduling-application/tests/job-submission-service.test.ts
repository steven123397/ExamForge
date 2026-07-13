import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoScheduleInput, type ScheduleJobSummary } from "@examforge/shared";
import {
  JobSubmissionService,
  type CreateScheduleJobCommand,
  type CreateScheduleJobResult,
} from "../src/index.js";

describe("job submission service", () => {
  it("freezes a complete input snapshot and reuses an idempotent submission", async () => {
    const commands: CreateScheduleJobCommand[] = [];
    const job = buildQueuedJob();
    const repository = {
      async createScheduleJob(command: CreateScheduleJobCommand): Promise<CreateScheduleJobResult> {
        commands.push(structuredClone(command));
        return { job, created: commands.length === 1 };
      },
    };
    const service = new JobSubmissionService(repository);
    const request = {
      batchId: job.batchId,
      input: demoScheduleInput,
      idempotencyKey: job.idempotencyKey,
      traceId: job.traceId,
      constraintProfileVersionId: "constraint-profile-balanced-v2",
    };

    const first = await service.submit(request);
    const second = await service.submit(request);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.job.id, first.job.id);
    assert.equal(commands[0].requestDigest, commands[1].requestDigest);
    assert.match(commands[0].requestDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(commands[0].requestSnapshot, {
      version: 1,
      input: demoScheduleInput,
    });
    assert.equal(
      commands[0].constraintProfileVersionId,
      "constraint-profile-balanced-v2",
    );
  });
});

function buildQueuedJob(): ScheduleJobSummary {
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
  };
}
