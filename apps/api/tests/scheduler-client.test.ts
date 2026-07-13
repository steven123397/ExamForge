import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { demoScheduleInput, scheduleResultSchema } from "@examforge/shared";
import {
  createSchedulerClient,
  HttpSchedulerClient,
  PythonSchedulerClient,
  SchedulerClientError,
} from "../src/scheduler-client.js";

describe("PythonSchedulerClient", () => {
  it("solves shared demo input through the Python CLI contract", async () => {
    const client = new PythonSchedulerClient();

    const result = await client.solve(demoScheduleInput);
    const parsed = scheduleResultSchema.parse(result);

    assert.equal(parsed.statistics.exam_count, demoScheduleInput.exam_tasks.length);
    assert.equal(parsed.statistics.room_count, demoScheduleInput.rooms.length);
    assert.equal(parsed.statistics.slot_count, demoScheduleInput.time_slots.length);
    assert.ok(Array.isArray(parsed.assignments));
    assert.ok(Array.isArray(parsed.conflicts));
    assert.equal(typeof parsed.score.total_score, "number");
    assert.ok("report" in parsed);
  });

  it("solves reschedule context through the Python CLI contract", async () => {
    const client = new PythonSchedulerClient();
    const baseline = await client.solve(demoScheduleInput);
    assert.equal(baseline.statistics.status, "feasible");

    const result = await client.solve({
      ...demoScheduleInput,
      constraint_profile: {
        ...demoScheduleInput.constraint_profile,
        soft_weights: {
          ...demoScheduleInput.constraint_profile.soft_weights,
          schedule_stability: 100,
        },
      },
      reschedule_context: {
        baseline_assignments: baseline.assignments,
        movable_exam_task_ids: ["e-data-structures"],
      },
    });

    assert.equal(result.statistics.status, "feasible");
    assert.deepEqual(result.report?.reschedule, {
      baseline_exam_count: demoScheduleInput.exam_tasks.length,
      frozen_exam_task_ids: [
        "e-ai",
        "e-calculus",
        "e-database",
        "e-english",
        "e-os",
      ],
      retained_exam_task_ids: [
        "e-ai",
        "e-calculus",
        "e-data-structures",
        "e-database",
        "e-english",
        "e-os",
      ],
      changed_exam_task_ids: [],
    });
  });

  it("adds scheduler command context when the process cannot start", async () => {
    const client = new PythonSchedulerClient("../scheduler", "definitely-missing-scheduler-executable");

    await assert.rejects(
      () => client.solve(demoScheduleInput),
      /failed to start scheduler process/,
    );
  });
});

describe("HttpSchedulerClient", () => {
  it("returns infeasible as a successful business result and propagates request id", async () => {
    let receivedRequestId: string | null = null;
    const client = new HttpSchedulerClient({
      baseUrl: "http://scheduler.internal:8000",
      fetch: mockFetch((_input, init) => {
        receivedRequestId = new Headers(init?.headers).get("x-request-id");
        return jsonResponse(infeasibleResult, 200, {
          "x-request-id": "request-http-001",
          "x-scheduler-version": "0.1.0",
        });
      }),
    });

    const result = await client.solve(demoScheduleInput, {
      requestId: "request-http-001",
    });

    assert.equal(result.statistics.status, "infeasible");
    assert.equal(receivedRequestId, "request-http-001");
  });

  it("maps scheduler validation errors without leaking the submitted input", async () => {
    const client = new HttpSchedulerClient({
      baseUrl: "http://scheduler.internal:8000",
      fetch: mockFetch(() => jsonResponse({
        error: {
          category: "validation",
          code: "scheduler_input_invalid",
          message: "Schedule input failed semantic validation.",
          retryable: false,
        },
        request_id: "request-validation-001",
        issues: ["teacher references missing slot"],
      }, 422)),
    });

    await assert.rejects(
      () => client.solve(demoScheduleInput),
      (error: unknown) => {
        assert.ok(error instanceof SchedulerClientError);
        assert.equal(error.category, "validation");
        assert.equal(error.code, "scheduler_input_invalid");
        assert.equal(error.retryable, false);
        assert.equal(error.requestId, "request-validation-001");
        assert.doesNotMatch(error.message, /student_groups/);
        return true;
      },
    );
  });

  it("maps internal and unavailable failures to sanitized retryable errors", async () => {
    const internalClient = new HttpSchedulerClient({
      baseUrl: "http://scheduler.internal:8000",
      fetch: mockFetch(() => jsonResponse({
        error: {
          category: "internal",
          code: "scheduler_internal_error",
          message: "Scheduler failed to process the request.",
          retryable: true,
        },
        request_id: "request-internal-001",
      }, 500)),
    });
    const unavailableClient = new HttpSchedulerClient({
      baseUrl: "http://scheduler.internal:8000",
      fetch: mockFetch(() => {
        throw new TypeError("connect ECONNREFUSED password=do-not-leak");
      }),
    });

    await assertSchedulerError(internalClient.solve(demoScheduleInput), {
      category: "internal",
      code: "scheduler_internal_error",
      retryable: true,
    });
    await assert.rejects(
      () => unavailableClient.solve(demoScheduleInput),
      (error: unknown) => {
        assert.ok(error instanceof SchedulerClientError);
        assert.equal(error.category, "unavailable");
        assert.equal(error.code, "scheduler_unavailable");
        assert.equal(error.retryable, true);
        assert.doesNotMatch(error.message, /password/);
        return true;
      },
    );
  });

  it("distinguishes deadline timeout from caller cancellation", async () => {
    const timeoutClient = new HttpSchedulerClient({
      baseUrl: "http://scheduler.internal:8000",
      timeoutMs: 10,
      fetch: hangingFetch,
    });
    const cancelledClient = new HttpSchedulerClient({
      baseUrl: "http://scheduler.internal:8000",
      timeoutMs: 1_000,
      fetch: hangingFetch,
    });
    const controller = new AbortController();
    const cancelled = cancelledClient.solve(demoScheduleInput, {
      signal: controller.signal,
    });
    const cancelledAssertion = assertSchedulerError(cancelled, {
      category: "cancelled",
      code: "scheduler_cancelled",
      retryable: false,
    });
    controller.abort();

    await assertSchedulerError(timeoutClient.solve(demoScheduleInput), {
      category: "timeout",
      code: "scheduler_timeout",
      retryable: true,
    });
    await cancelledAssertion;
  });

  it("rejects non-JSON and schema-drifted success responses as protocol failures", async () => {
    const nonJsonClient = new HttpSchedulerClient({
      baseUrl: "http://scheduler.internal:8000",
      fetch: mockFetch(() => new Response("not-json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      })),
    });
    const driftedClient = new HttpSchedulerClient({
      baseUrl: "http://scheduler.internal:8000",
      fetch: mockFetch(() => jsonResponse({ assignments: [] }, 200)),
    });

    await assertSchedulerError(nonJsonClient.solve(demoScheduleInput), {
      category: "protocol",
      code: "scheduler_protocol_invalid",
      retryable: false,
    });
    await assertSchedulerError(driftedClient.solve(demoScheduleInput), {
      category: "protocol",
      code: "scheduler_protocol_invalid",
      retryable: false,
    });
  });

  it("checks remote readiness through the same bounded client", async () => {
    const client = new HttpSchedulerClient({
      baseUrl: "http://scheduler.internal:8000/",
      fetch: mockFetch((input) => {
        assert.equal(String(input), "http://scheduler.internal:8000/ready");
        return jsonResponse({
          ok: true,
          service: "examforge-scheduler",
          version: "0.1.0",
        });
      }),
    });

    await client.checkReadiness();
  });
});

describe("scheduler client configuration", () => {
  it("requires an explicit valid transport and HTTP base URL", () => {
    assert.ok(createSchedulerClient({ SCHEDULER_TRANSPORT: "cli" }) instanceof PythonSchedulerClient);
    assert.ok(createSchedulerClient({
      SCHEDULER_TRANSPORT: "http",
      SCHEDULER_BASE_URL: "http://scheduler:8000",
    }) instanceof HttpSchedulerClient);
    assert.throws(
      () => createSchedulerClient({ SCHEDULER_TRANSPORT: "unknown" }),
      /Unsupported scheduler transport/,
    );
    assert.throws(
      () => createSchedulerClient({ SCHEDULER_TRANSPORT: "http" }),
      /SCHEDULER_BASE_URL/,
    );
  });

  it("keeps the generated OpenAPI contract aligned with shared input fields", () => {
    const document = JSON.parse(readFileSync(
      new URL("../../scheduler/openapi.json", import.meta.url),
      "utf8",
    ));
    const inputSchema = document.components.schemas.ScheduleInputModel;

    assert.equal(inputSchema.additionalProperties, false);
    assert.deepEqual(inputSchema.required, [
      "student_groups",
      "teachers",
      "courses",
      "rooms",
      "time_slots",
      "exam_tasks",
      "constraint_profile",
    ]);
  });
});

const infeasibleResult = {
  assignments: [],
  conflicts: [],
  score: {
    total_score: 0,
    hard_violation_count: 1,
    soft_penalty_items: [],
  },
  statistics: {
    status: "infeasible",
    elapsed_ms: 1,
    exam_count: demoScheduleInput.exam_tasks.length,
    room_count: demoScheduleInput.rooms.length,
    slot_count: demoScheduleInput.time_slots.length,
    attempted_assignments: 0,
  },
  report: { summary: { status: "infeasible" } },
};

const hangingFetch = mockFetch((_input, init) => new Promise<Response>((_resolve, reject) => {
  const signal = init?.signal;
  if (signal?.aborted) {
    reject(signal.reason);
    return;
  }
  signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
}));

function mockFetch(
  implementation: (input: URL | RequestInfo, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return implementation as typeof fetch;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });
}

async function assertSchedulerError(
  promise: Promise<unknown>,
  expected: Pick<SchedulerClientError, "category" | "code" | "retryable">,
) {
  await assert.rejects(
    promise,
    (error: unknown) => {
      assert.ok(error instanceof SchedulerClientError);
      assert.equal(error.category, expected.category);
      assert.equal(error.code, expected.code);
      assert.equal(error.retryable, expected.retryable);
      return true;
    },
  );
}
