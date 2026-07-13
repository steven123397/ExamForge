import type { FastifyReply } from "fastify";
import { Redis } from "ioredis";
import {
  scheduleJobSseEventName,
  type ScheduleJobEventEnvelope,
} from "@examforge/shared";
import type {
  ScheduleJobEventNotifier,
  ScheduleJobEventSink,
} from "./services/schedule-job-event-service.js";

export const SCHEDULE_JOB_EVENT_CHANNEL = "examforge:schedule-job-events";

export function createScheduleJobEventNotifier(
  redisUrl = process.env.REDIS_URL,
): ScheduleJobEventNotifier {
  return redisUrl?.trim()
    ? new RedisScheduleJobEventNotifier(redisUrl)
    : new NoopScheduleJobEventNotifier();
}

export class RedisScheduleJobEventNotifier implements ScheduleJobEventNotifier {
  private readonly client: Redis;
  private readonly listeners = new Set<(eventId: string) => void>();
  private startPromise: Promise<void> | null = null;

  constructor(
    redisUrl: string,
    private readonly channel = SCHEDULE_JOB_EVENT_CHANNEL,
  ) {
    this.client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    this.client.on("error", () => undefined);
    this.client.on("message", (channel, eventId) => {
      if (channel !== this.channel) {
        return;
      }
      for (const listener of this.listeners) {
        listener(eventId);
      }
    });
  }

  async subscribe(listener: (eventId: string) => void) {
    this.listeners.add(listener);
    try {
      await this.start();
    } catch (error) {
      this.listeners.delete(listener);
      throw error;
    }
    return async () => {
      this.listeners.delete(listener);
    };
  }

  async checkReadiness() {
    await this.start();
    await this.client.ping();
  }

  async close() {
    this.listeners.clear();
    try {
      await this.client.unsubscribe(this.channel);
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  private start() {
    if (!this.startPromise) {
      this.startPromise = (async () => {
        if (this.client.status === "wait") {
          await this.client.connect();
        }
        await this.client.subscribe(this.channel);
      })().catch((error) => {
        this.startPromise = null;
        throw error;
      });
    }
    return this.startPromise;
  }
}

class NoopScheduleJobEventNotifier implements ScheduleJobEventNotifier {
  async subscribe() {
    return async () => undefined;
  }
}

export function createScheduleJobEventSink(reply: FastifyReply): ScheduleJobEventSink {
  let opened = false;
  return {
    async open() {
      if (opened) {
        return;
      }
      opened = true;
      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.flushHeaders();
    },
    writeEvent(event) {
      return writeChunk(reply, [
        `id: ${event.eventId}`,
        `event: ${scheduleJobSseEventName(event)}`,
        `data: ${JSON.stringify(event)}`,
        "",
        "",
      ].join("\n"));
    },
    writeHeartbeat() {
      return writeChunk(reply, `: heartbeat ${Date.now()}\n\n`);
    },
    async close() {
      if (opened && !reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.end();
      }
    },
  };
}

async function writeChunk(reply: FastifyReply, chunk: string) {
  if (reply.raw.destroyed || reply.raw.writableEnded) {
    throw new Error("SSE client disconnected.");
  }
  if (reply.raw.write(chunk)) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      reply.raw.off("drain", onDrain);
      reply.raw.off("close", onClose);
      reply.raw.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("SSE client disconnected."));
    };
    const onError = () => {
      cleanup();
      reject(new Error("SSE response failed."));
    };
    reply.raw.once("drain", onDrain);
    reply.raw.once("close", onClose);
    reply.raw.once("error", onError);
  });
}

export function readLastEventId(value: string | string[] | undefined) {
  const eventId = Array.isArray(value) ? value[0] : value;
  return eventId?.trim() || null;
}
