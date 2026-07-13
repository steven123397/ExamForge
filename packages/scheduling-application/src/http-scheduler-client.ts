import { scheduleResultSchema, type ScheduleInput, type ScheduleResult } from "@examforge/shared";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  SchedulerClientError,
  type SchedulerClient,
  type SchedulerSolveOptions,
} from "./contracts.js";

export interface HttpSchedulerClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

const schedulerErrorEnvelopeSchema = z.object({
  error: z.object({
    category: z.enum(["validation", "internal"]),
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).strict(),
  request_id: z.string(),
  issues: z.array(z.unknown()).optional(),
}).strict();

const schedulerStatusSchema = z.object({
  ok: z.literal(true),
  service: z.literal("examforge-scheduler"),
  version: z.string().min(1),
}).strict();

export class HttpSchedulerClient implements SchedulerClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpSchedulerClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 35_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("Scheduler HTTP timeout must be a positive number.");
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async solve(
    input: ScheduleInput,
    options: SchedulerSolveOptions = {},
  ): Promise<ScheduleResult> {
    const requestId = options.requestId ?? `scheduler-client-${randomUUID()}`;
    const response = await this.request("/solve", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
      },
      body: JSON.stringify(input),
    }, options.signal, requestId);
    const payload = await readJson(response, requestId);

    if (!response.ok) {
      throw errorFromResponse(response, payload, requestId);
    }
    const parsed = scheduleResultSchema.strict().safeParse(payload);
    if (!parsed.success) {
      throw protocolError(requestId);
    }
    const schedulerVersion = response.headers.get("x-scheduler-version");
    if (!schedulerVersion) {
      throw protocolError(requestId);
    }
    options.onMetadata?.({ schedulerVersion });
    return parsed.data;
  }

  async checkReadiness(): Promise<void> {
    const requestId = `scheduler-readiness-${randomUUID()}`;
    const response = await this.request("/ready", {
      headers: { "x-request-id": requestId },
    }, undefined, requestId);
    const payload = await readJson(response, requestId);
    if (!response.ok) {
      throw errorFromResponse(response, payload, requestId);
    }
    if (!schedulerStatusSchema.safeParse(payload).success) {
      throw protocolError(requestId);
    }
  }

  private async request(
    pathname: string,
    init: RequestInit,
    callerSignal: AbortSignal | undefined,
    requestId: string,
  ) {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => {
      timeoutController.abort(new DOMException("Scheduler request timed out.", "TimeoutError"));
    }, this.timeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutController.signal])
      : timeoutController.signal;
    try {
      return await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        ...init,
        signal,
      });
    } catch (error) {
      if (callerSignal?.aborted) {
        throw new SchedulerClientError(
          "Scheduler request was cancelled.",
          "cancelled",
          "scheduler_cancelled",
          false,
          requestId,
          { cause: error },
        );
      }
      if (timeoutController.signal.aborted) {
        throw new SchedulerClientError(
          "Scheduler request exceeded its deadline.",
          "timeout",
          "scheduler_timeout",
          true,
          requestId,
          { cause: error },
        );
      }
      throw new SchedulerClientError(
        "Scheduler service is unavailable.",
        "unavailable",
        "scheduler_unavailable",
        true,
        requestId,
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readJson(response: Response, requestId: string): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch (error) {
    throw protocolError(requestId, error);
  }
}

function errorFromResponse(
  response: Response,
  payload: unknown,
  fallbackRequestId: string,
): SchedulerClientError {
  const parsed = schedulerErrorEnvelopeSchema.safeParse(payload);
  if (parsed.success) {
    return new SchedulerClientError(
      parsed.data.error.message,
      parsed.data.error.category,
      parsed.data.error.code,
      parsed.data.error.retryable,
      parsed.data.request_id,
    );
  }
  const requestId = response.headers.get("x-request-id") ?? fallbackRequestId;
  if (response.status === 408 || response.status === 504) {
    return new SchedulerClientError(
      "Scheduler request exceeded its deadline.",
      "timeout",
      "scheduler_timeout",
      true,
      requestId,
    );
  }
  if (response.status === 502 || response.status === 503) {
    return new SchedulerClientError(
      "Scheduler service is unavailable.",
      "unavailable",
      "scheduler_unavailable",
      true,
      requestId,
    );
  }
  return protocolError(requestId);
}

function protocolError(requestId: string, cause?: unknown): SchedulerClientError {
  return new SchedulerClientError(
    "Scheduler response does not match the HTTP contract.",
    "protocol",
    "scheduler_protocol_invalid",
    false,
    requestId,
    cause === undefined ? undefined : { cause },
  );
}

function normalizeBaseUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Scheduler base URL must use HTTP or HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}
