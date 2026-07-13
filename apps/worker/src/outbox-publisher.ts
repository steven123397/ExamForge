import type {
  OutboxDeliveryRepository,
  ProcessOutboxBatchResult,
  ScheduleJobOutboxEvent,
} from "@examforge/scheduling-application";
import type { JobsOptions } from "bullmq";
import {
  scheduleQueueJobId,
  type ScheduleQueueJobData,
} from "./queue.js";

export interface ScheduleQueue {
  add(
    name: string,
    data: ScheduleQueueJobData,
    options: JobsOptions,
  ): Promise<unknown>;
}

export interface OutboxPublisherOptions {
  queue: ScheduleQueue;
  publishEventId: (eventId: string) => Promise<unknown>;
  batchSize?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  now?: () => Date;
}

export class OutboxPublisher {
  private readonly batchSize: number;

  constructor(
    private readonly repository: OutboxDeliveryRepository,
    private readonly options: OutboxPublisherOptions,
  ) {
    this.batchSize = positiveInteger(options.batchSize ?? 25, "batchSize");
  }

  publishBatch(): Promise<ProcessOutboxBatchResult> {
    return this.repository.processOutboxBatch({
      batchSize: this.batchSize,
      now: this.options.now?.(),
      retryBaseDelayMs: this.options.retryBaseDelayMs,
      retryMaxDelayMs: this.options.retryMaxDelayMs,
    }, async (outbox) => {
      if (isQueueEvent(outbox.eventType)) {
        await this.options.queue.add("schedule-job", {
          jobId: outbox.aggregateId,
          outboxEventId: outbox.id,
          traceId: outbox.event.traceId,
        }, {
          jobId: scheduleQueueJobId(outbox.aggregateId),
        });
      }
      await this.options.publishEventId(outbox.event.eventId);
    });
  }
}

function isQueueEvent(eventType: ScheduleJobOutboxEvent["eventType"]) {
  return eventType === "schedule_job.queued"
    || eventType === "schedule_job.retry_scheduled";
}

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
