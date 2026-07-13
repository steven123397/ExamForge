"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  scheduleJobEventEnvelopeSchema,
  scheduleJobStatusSchema,
  type ScheduleJobEventEnvelope,
  type ScheduleJobListResponse,
  type ScheduleJobSummary,
} from "@examforge/shared";
import { apiBase } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";

export type ScheduleJobEventConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "degraded";

type PerJobConnectionState = Exclude<ScheduleJobEventConnectionState, "idle">;
const MAXIMUM_CONCURRENT_JOB_STREAMS = 4;

export function useScheduleJobEvents(jobs: ScheduleJobSummary[]) {
  const queryClient = useQueryClient();
  const lastEventIds = useRef<Record<string, string>>({});
  const activeJobIds = useMemo(() => selectScheduleJobEventTargets(jobs), [jobs]);
  const activeKey = activeJobIds.join("\u0000");
  const [connections, setConnections] = useState<Record<string, PerJobConnectionState>>({});

  useEffect(() => {
    const jobIds = activeKey ? activeKey.split("\u0000") : [];
    if (jobIds.length === 0) {
      setConnections({});
      return;
    }
    const controllers = new Map<string, AbortController>();
    let mounted = true;
    setConnections(Object.fromEntries(jobIds.map((jobId) => [jobId, "connecting"])));
    const setConnection = (jobId: string, state: PerJobConnectionState) => {
      if (!mounted) {
        return;
      }
      setConnections((current) => ({ ...current, [jobId]: state }));
    };
    for (const jobId of jobIds) {
      const controller = new AbortController();
      controllers.set(jobId, controller);
      void streamScheduleJobEvents(
        jobId,
        lastEventIds.current[jobId] ?? null,
        controller.signal,
        {
        onConnectionState: (state) => setConnection(jobId, state),
        onEvent(event) {
          lastEventIds.current[jobId] = event.eventId;
          queryClient.setQueriesData<ScheduleJobListResponse>(
            { queryKey: queryKeys.scheduleJobsRoot },
            (current) => current ? applyScheduleJobEventToList(current, event) : current,
          );
          void queryClient.invalidateQueries({ queryKey: queryKeys.scheduleJob(event.jobId) });
          if (isTerminalEvent(event)) {
            delete lastEventIds.current[jobId];
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: queryKeys.scheduleJobsRoot }),
              queryClient.invalidateQueries({ queryKey: queryKeys.scheduleRunsRoot }),
              queryClient.invalidateQueries({ queryKey: queryKeys.auditEventsRoot }),
              queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
            ]);
          }
        },
        },
      );
    }
    return () => {
      mounted = false;
      for (const controller of controllers.values()) {
        controller.abort();
      }
    };
  }, [activeKey, queryClient]);

  const state = aggregateConnectionState(activeJobIds, connections);
  useEffect(() => {
    if (state !== "degraded" || activeJobIds.length === 0) {
      return;
    }
    const refresh = () => {
      void queryClient.refetchQueries({ queryKey: queryKeys.scheduleJobsRoot, type: "active" });
    };
    refresh();
    const fallback = setInterval(refresh, 5_000);
    return () => clearInterval(fallback);
  }, [activeKey, activeJobIds.length, queryClient, state]);

  return state;
}

export function selectScheduleJobEventTargets(jobs: ScheduleJobSummary[]) {
  return [
    ...jobs.filter((job) => job.status === "running"),
    ...jobs.filter((job) => job.status === "queued"),
  ]
    .slice(0, MAXIMUM_CONCURRENT_JOB_STREAMS)
    .map((job) => job.id);
}

interface StreamCallbacks {
  onConnectionState(state: PerJobConnectionState): void;
  onEvent(event: ScheduleJobEventEnvelope): void;
}

async function streamScheduleJobEvents(
  jobId: string,
  initialLastEventId: string | null,
  signal: AbortSignal,
  callbacks: StreamCallbacks,
) {
  let lastEventId = initialLastEventId;
  let reconnectAttempt = 0;
  const seenEventIds = new Set<string>();
  while (!signal.aborted) {
    callbacks.onConnectionState(reconnectAttempt === 0 ? "connecting" : "degraded");
    try {
      const response = await fetch(
        `${apiBase}/api/schedule-jobs/${encodeURIComponent(jobId)}/events`,
        {
          cache: "no-store",
          credentials: "include",
          headers: lastEventId ? { "last-event-id": lastEventId } : undefined,
          signal,
        },
      );
      if (response.status === 401) {
        window.dispatchEvent(new Event("examforge:session-expired"));
        callbacks.onConnectionState("degraded");
        return;
      }
      if (!response.ok || !response.body) {
        callbacks.onConnectionState("degraded");
        if (response.status === 403 || response.status === 404) {
          return;
        }
        throw new Error("Schedule job event stream is unavailable.");
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("text/event-stream")) {
        throw new Error("Schedule job event stream returned an invalid content type.");
      }
      callbacks.onConnectionState("connected");
      reconnectAttempt = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new ScheduleJobSseParser();
      let terminal = false;
      while (!signal.aborted) {
        const chunk = await reader.read();
        const events = parser.push(decoder.decode(chunk.value, { stream: !chunk.done }));
        for (const event of events) {
          if (event.jobId !== jobId || seenEventIds.has(event.eventId)) {
            continue;
          }
          seenEventIds.add(event.eventId);
          lastEventId = event.eventId;
          callbacks.onEvent(event);
          terminal ||= isTerminalEvent(event);
        }
        if (chunk.done || terminal) {
          break;
        }
      }
      if (terminal || signal.aborted) {
        return;
      }
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        return;
      }
      callbacks.onConnectionState("degraded");
    }
    reconnectAttempt += 1;
    await abortableDelay(Math.min(5_000, 1_000 * reconnectAttempt), signal);
  }
}

export class ScheduleJobSseParser {
  private buffer = "";

  push(chunk: string): ScheduleJobEventEnvelope[] {
    this.buffer += chunk.replaceAll("\r\n", "\n");
    const events: ScheduleJobEventEnvelope[] = [];
    let boundary = this.buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          const parsed = scheduleJobEventEnvelopeSchema.safeParse(JSON.parse(data));
          if (parsed.success) {
            events.push(parsed.data);
          }
        } catch {
          // Ignore malformed frames and keep the last valid cursor.
        }
      }
      boundary = this.buffer.indexOf("\n\n");
    }
    return events;
  }
}

export function applyScheduleJobEventToList(
  current: ScheduleJobListResponse,
  event: ScheduleJobEventEnvelope,
): ScheduleJobListResponse {
  return {
    jobs: current.jobs.map((job) => (
      job.id === event.jobId ? applyScheduleJobEvent(job, event) : job
    )),
    page: current.page,
    pageSize: current.pageSize,
    total: current.total,
    pageCount: current.pageCount,
  };
}

function applyScheduleJobEvent(
  job: ScheduleJobSummary,
  event: ScheduleJobEventEnvelope,
): ScheduleJobSummary {
  const parsedStatus = scheduleJobStatusSchema.safeParse(event.payload.status);
  const attemptNumber = typeof event.payload.attemptNumber === "number"
    && Number.isInteger(event.payload.attemptNumber)
    && event.payload.attemptNumber > 0
    ? event.payload.attemptNumber
    : null;
  const terminal = isTerminalEvent(event);
  const status = parsedStatus.success ? parsedStatus.data : job.status;
  const progress = typeof event.payload.progress === "number"
    ? Math.max(0, Math.min(100, event.payload.progress))
    : event.type === "schedule_job.retry_scheduled"
      ? 15
      : terminal
        ? 100
        : job.progress;
  return {
    ...job,
    status,
    progress,
    attemptCount: attemptNumber === null
      ? job.attemptCount
      : Math.max(job.attemptCount ?? 0, attemptNumber),
    runId: typeof event.payload.runId === "string" ? event.payload.runId : job.runId,
    error: isEventError(event.payload.error)
      ? event.payload.error
      : event.type === "schedule_job.succeeded"
        ? null
        : job.error,
    cancellationRequestedAt: (
      event.type === "schedule_job.cancellation_requested"
      || event.type === "schedule_job.cancelled"
    ) ? job.cancellationRequestedAt ?? event.occurredAt : job.cancellationRequestedAt,
    startedAt: event.type === "schedule_job.attempt_started"
      ? job.startedAt ?? event.occurredAt
      : job.startedAt,
    finishedAt: terminal ? event.occurredAt : job.finishedAt,
    updatedAt: event.occurredAt,
  };
}

function isEventError(value: unknown): value is NonNullable<ScheduleJobSummary["error"]> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const error = value as Record<string, unknown>;
  return typeof error.category === "string"
    && typeof error.code === "string"
    && typeof error.message === "string"
    && typeof error.retryable === "boolean";
}

function isTerminalEvent(event: ScheduleJobEventEnvelope) {
  return event.type === "schedule_job.succeeded"
    || event.type === "schedule_job.failed"
    || event.type === "schedule_job.cancelled"
    || event.type === "schedule_job.timed_out";
}

function aggregateConnectionState(
  activeJobIds: string[],
  connections: Record<string, PerJobConnectionState>,
): ScheduleJobEventConnectionState {
  if (activeJobIds.length === 0) {
    return "idle";
  }
  const states = activeJobIds.map((jobId) => connections[jobId] ?? "connecting");
  if (states.includes("degraded")) {
    return "degraded";
  }
  return states.every((state) => state === "connected") ? "connected" : "connecting";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortableDelay(delayMs: number, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
