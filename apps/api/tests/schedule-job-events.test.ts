import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ScheduleJobEventEnvelope } from "@examforge/shared";
import { demoScheduleInput } from "@examforge/shared";
import { InMemoryPlatformRepository } from "../src/repository.js";
import {
  ScheduleJobEventService,
  type ScheduleJobEventNotifier,
  type ScheduleJobEventSink,
} from "../src/services/schedule-job-event-service.js";

describe("schedule job events", () => {
  it("streams initial history, resumes after Last-Event-ID, and closes on terminal state", async () => {
    const repository = new InMemoryPlatformRepository();
    const job = await createJob(repository, "terminal-history");
    await repository.requestScheduleJobCancellation(job.id);
    const history = await repository.listScheduleJobEvents(job.id);

    const fullSink = new RecordingSink();
    const fullNotifier = new RecordingNotifier();
    const fullResult = await createService(repository, fullNotifier).stream({
      jobId: job.id,
      lastEventId: null,
      signal: new AbortController().signal,
    }, fullSink);
    assert.equal(fullResult.resolution, "streamed");
    assert.deepEqual(fullSink.events, history);
    assert.equal(fullSink.opened, true);
    assert.equal(fullNotifier.listenerCount, 0);

    const resumedSink = new RecordingSink();
    const resumedResult = await createService(repository, new RecordingNotifier()).stream({
      jobId: job.id,
      lastEventId: history[0].eventId,
      signal: new AbortController().signal,
    }, resumedSink);
    assert.equal(resumedResult.resolution, "streamed");
    assert.deepEqual(resumedSink.events, history.slice(1));
  });

  it("rejects unknown and cross-job cursors before opening the stream", async () => {
    const repository = new InMemoryPlatformRepository();
    const first = await createJob(repository, "cursor-first");
    const second = await createJob(repository, "cursor-second");
    const [secondEvent] = await repository.listScheduleJobEvents(second.id);
    const service = createService(repository, new RecordingNotifier());

    const unknownSink = new RecordingSink();
    assert.deepEqual(await service.stream({
      jobId: first.id,
      lastEventId: "event-missing",
      signal: new AbortController().signal,
    }, unknownSink), { resolution: "unknown_cursor" });
    assert.equal(unknownSink.opened, false);

    const crossJobSink = new RecordingSink();
    assert.deepEqual(await service.stream({
      jobId: first.id,
      lastEventId: secondEvent.eventId,
      signal: new AbortController().signal,
    }, crossJobSink), { resolution: "wrong_job_cursor" });
    assert.equal(crossJobSink.opened, false);
  });

  it("deduplicates repeated wakeups and recovers a missed wakeup on heartbeat", async () => {
    const repository = new InMemoryPlatformRepository();
    const created = await repository.createScheduleJob(jobCommand("wakeups"));
    const notifier = new RecordingNotifier();
    const sink = new RecordingSink();
    const service = createService(repository, notifier, { heartbeatIntervalMs: 20 });
    const stream = service.stream({
      jobId: created.job.id,
      lastEventId: null,
      signal: new AbortController().signal,
    }, sink);
    await sink.waitUntilOpened();
    await waitFor(() => sink.events.length === 1);

    const claim = await repository.claimScheduleJob(created.job.id, { deliveryAttempt: 1 });
    assert.equal(claim.resolution, "claimed");
    notifier.emit("event-wakeup");
    notifier.emit("event-wakeup");
    await waitFor(() => sink.events.length === 3);
    assert.equal(new Set(sink.events.map((event) => event.eventId)).size, 3);

    assert.ok(claim.resolution === "claimed");
    await repository.failScheduleJobAttempt(created.job.id, {
      attemptId: claim.attempt.id,
      error: {
        category: "validation",
        code: "scheduler_input_invalid",
        message: "Schedule input failed semantic validation.",
        retryable: false,
      },
      outcome: "failed",
      retryAt: null,
    });
    const result = await stream;

    assert.equal(result.resolution, "streamed");
    assert.equal(sink.events.at(-1)?.type, "schedule_job.failed");
    assert.ok(sink.heartbeats > 0);
    assert.equal(new Set(sink.events.map((event) => event.eventId)).size, sink.events.length);
    assert.equal(notifier.listenerCount, 0);
  });

  it("closes the initial query-to-subscribe window with a second database read", async () => {
    const repository = new InMemoryPlatformRepository();
    const created = await repository.createScheduleJob(jobCommand("subscribe-window"));
    const notifier: ScheduleJobEventNotifier = {
      async subscribe() {
        const claim = await repository.claimScheduleJob(created.job.id, {
          deliveryAttempt: 1,
        });
        assert.ok(claim.resolution === "claimed");
        await repository.failScheduleJobAttempt(created.job.id, {
          attemptId: claim.attempt.id,
          error: {
            category: "protocol",
            code: "scheduler_protocol_invalid",
            message: "Scheduler response does not match the HTTP contract.",
            retryable: false,
          },
          outcome: "failed",
          retryAt: null,
        });
        return async () => undefined;
      },
    };
    const sink = new RecordingSink();

    const result = await new ScheduleJobEventService(repository, notifier, {
      heartbeatIntervalMs: 1_000,
      maximumConnectionMs: 2_000,
      batchSize: 2,
    }).stream({
      jobId: created.job.id,
      lastEventId: null,
      signal: new AbortController().signal,
    }, sink);

    assert.equal(result.resolution, "streamed");
    assert.deepEqual(sink.events.map((event) => event.type), [
      "schedule_job.queued",
      "schedule_job.attempt_started",
      "schedule_job.running",
      "schedule_job.failed",
    ]);
  });

  it("cleans up the subscription when the client disconnects", async () => {
    const repository = new InMemoryPlatformRepository();
    const job = await createJob(repository, "disconnect");
    const notifier = new RecordingNotifier();
    const sink = new RecordingSink();
    const controller = new AbortController();
    const stream = createService(repository, notifier).stream({
      jobId: job.id,
      lastEventId: null,
      signal: controller.signal,
    }, sink);
    await sink.waitUntilOpened();
    controller.abort();

    assert.equal((await stream).resolution, "streamed");
    assert.equal(notifier.listenerCount, 0);
  });
});

function createService(
  repository: InMemoryPlatformRepository,
  notifier: RecordingNotifier,
  options: { heartbeatIntervalMs?: number } = {},
) {
  return new ScheduleJobEventService(repository, notifier, {
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 1_000,
    maximumConnectionMs: 2_000,
    batchSize: 2,
  });
}

class RecordingNotifier implements ScheduleJobEventNotifier {
  private readonly listeners = new Set<(eventId: string) => void>();

  get listenerCount() {
    return this.listeners.size;
  }

  async subscribe(listener: (eventId: string) => void) {
    this.listeners.add(listener);
    return async () => {
      this.listeners.delete(listener);
    };
  }

  emit(eventId: string) {
    for (const listener of this.listeners) {
      listener(eventId);
    }
  }
}

class RecordingSink implements ScheduleJobEventSink {
  opened = false;
  events: ScheduleJobEventEnvelope[] = [];
  heartbeats = 0;
  private markOpened!: () => void;
  private readonly openedPromise = new Promise<void>((resolve) => {
    this.markOpened = resolve;
  });

  async open() {
    this.opened = true;
    this.markOpened();
  }

  async writeEvent(event: ScheduleJobEventEnvelope) {
    this.events.push(structuredClone(event));
  }

  async writeHeartbeat() {
    this.heartbeats += 1;
  }

  waitUntilOpened() {
    return this.openedPromise;
  }
}

async function createJob(repository: InMemoryPlatformRepository, suffix: string) {
  return (await repository.createScheduleJob(jobCommand(suffix))).job;
}

function jobCommand(suffix: string) {
  return {
    batchId: "batch-2026-spring-final",
    idempotencyKey: `events-${suffix}`,
    requestDigest: suffix.padEnd(64, "a").slice(0, 64),
    requestSnapshot: { version: 1 as const, input: demoScheduleInput },
    traceId: `trace-events-${suffix}`,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for schedule job event state.");
}
