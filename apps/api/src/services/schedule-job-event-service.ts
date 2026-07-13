import type {
  ScheduleJobEventCursorResult,
} from "@examforge/scheduling-application";
import type {
  ScheduleJobEventEnvelope,
  ScheduleJobSummary,
} from "@examforge/shared";

export interface ScheduleJobEventRepository {
  getScheduleJob(id: string): Promise<ScheduleJobSummary | null>;
  listScheduleJobEvents(
    jobId: string,
    options: { afterSequence?: number; limit?: number },
  ): Promise<ScheduleJobEventEnvelope[]>;
  resolveScheduleJobEventCursor(
    jobId: string,
    eventId: string,
  ): Promise<ScheduleJobEventCursorResult>;
}

export interface ScheduleJobEventNotifier {
  subscribe(listener: (eventId: string) => void): Promise<() => Promise<void>>;
  checkReadiness?(): Promise<void>;
  close?(): Promise<void>;
}

export interface ScheduleJobEventSink {
  open(): Promise<void>;
  writeEvent(event: ScheduleJobEventEnvelope): Promise<void>;
  writeHeartbeat(): Promise<void>;
  close?(): Promise<void>;
}

export interface ScheduleJobEventStreamRequest {
  jobId: string;
  lastEventId: string | null;
  signal: AbortSignal;
}

export type ScheduleJobEventStreamResult =
  | { resolution: "streamed" }
  | { resolution: "not_found" }
  | { resolution: "unknown_cursor" }
  | { resolution: "wrong_job_cursor" };

export interface ScheduleJobEventServiceOptions {
  heartbeatIntervalMs?: number;
  maximumConnectionMs?: number;
  batchSize?: number;
}

export class ScheduleJobEventService {
  private readonly heartbeatIntervalMs: number;
  private readonly maximumConnectionMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly repository: ScheduleJobEventRepository,
    private readonly notifier: ScheduleJobEventNotifier,
    options: ScheduleJobEventServiceOptions = {},
  ) {
    this.heartbeatIntervalMs = positiveInteger(
      options.heartbeatIntervalMs ?? 15_000,
      "heartbeatIntervalMs",
    );
    this.maximumConnectionMs = positiveInteger(
      options.maximumConnectionMs ?? 300_000,
      "maximumConnectionMs",
    );
    this.batchSize = boundedPositiveInteger(options.batchSize ?? 100, "batchSize", 200);
  }

  async stream(
    request: ScheduleJobEventStreamRequest,
    sink: ScheduleJobEventSink,
  ): Promise<ScheduleJobEventStreamResult> {
    const job = await this.repository.getScheduleJob(request.jobId);
    if (!job) {
      return { resolution: "not_found" };
    }
    const cursor = await this.resolveCursor(request.jobId, request.lastEventId);
    if (cursor.resolution !== "valid") {
      return cursor.resolution === "unknown"
        ? { resolution: "unknown_cursor" }
        : { resolution: "wrong_job_cursor" };
    }

    let lastSequence = cursor.sequence;
    let finished = false;
    let ready = false;
    let wakeRequested = false;
    let finishStream!: () => void;
    const streamFinished = new Promise<void>((resolve) => {
      finishStream = resolve;
    });
    const finish = () => {
      if (!finished) {
        finished = true;
        finishStream();
      }
    };
    const initialEvents = await this.repository.listScheduleJobEvents(request.jobId, {
      afterSequence: lastSequence,
      limit: this.batchSize,
    });
    let pumpTail = Promise.resolve();
    const deliver = async (events: ScheduleJobEventEnvelope[]) => {
      for (const event of events) {
        if (event.sequence <= lastSequence) {
          continue;
        }
        await sink.writeEvent(event);
        lastSequence = event.sequence;
        if (isTerminalEvent(event)) {
          finish();
        }
      }
    };
    const pump = () => {
      wakeRequested = true;
      pumpTail = pumpTail.then(async () => {
        while (wakeRequested && !finished) {
          wakeRequested = false;
          while (!finished) {
            const events = await this.repository.listScheduleJobEvents(request.jobId, {
              afterSequence: lastSequence,
              limit: this.batchSize,
            });
            if (events.length === 0) {
              break;
            }
            await deliver(events);
            if (events.length < this.batchSize) {
              break;
            }
          }
        }
      });
      return pumpTail;
    };
    const unsubscribe = await this.notifier.subscribe(() => {
      wakeRequested = true;
      if (ready) {
        void pump();
      }
    });
    const onAbort = () => finish();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let maximumConnection: ReturnType<typeof setTimeout> | undefined;
    try {
      await sink.open();
      ready = true;
      await deliver(initialEvents);
      await pump();
      const current = await this.repository.getScheduleJob(request.jobId);
      if (current && isTerminalStatus(current.status)) {
        finish();
      }
      if (request.signal.aborted) {
        finish();
      } else {
        request.signal.addEventListener("abort", onAbort, { once: true });
      }
      heartbeat = setInterval(() => {
        if (finished) {
          return;
        }
        void sink.writeHeartbeat()
          .then(() => pump())
          .catch(() => finish());
      }, this.heartbeatIntervalMs);
      maximumConnection = setTimeout(finish, this.maximumConnectionMs);
      await streamFinished;
      await pumpTail;
      return { resolution: "streamed" };
    } finally {
      ready = false;
      if (heartbeat) {
        clearInterval(heartbeat);
      }
      if (maximumConnection) {
        clearTimeout(maximumConnection);
      }
      request.signal.removeEventListener("abort", onAbort);
      await unsubscribe();
      await sink.close?.();
    }
  }

  private async resolveCursor(
    jobId: string,
    lastEventId: string | null,
  ): Promise<ScheduleJobEventCursorResult> {
    if (!lastEventId) {
      return { resolution: "valid", sequence: 0 };
    }
    return this.repository.resolveScheduleJobEventCursor(jobId, lastEventId);
  }
}

function isTerminalEvent(event: ScheduleJobEventEnvelope) {
  return event.type === "schedule_job.succeeded"
    || event.type === "schedule_job.failed"
    || event.type === "schedule_job.cancelled"
    || event.type === "schedule_job.timed_out";
}

function isTerminalStatus(status: ScheduleJobSummary["status"]) {
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
