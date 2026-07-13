import { execFileSync } from "node:child_process";

const apiBase = process.env.DEMO_API_BASE_URL ?? "http://127.0.0.1:4000";
const webBase = process.env.DEMO_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const schedulerBase = process.env.DEMO_SCHEDULER_BASE_URL ?? "http://127.0.0.1:8000";
const operatorPassword = process.env.DEMO_OPERATOR_PASSWORD
  ?? process.env.EXAMFORGE_OPERATOR_PASSWORD;
const databaseUser = process.env.POSTGRES_USER ?? "examforge";
const databaseName = process.env.POSTGRES_DB ?? "examforge";
const runFaultDrills = process.env.DEMO_RUN_FAULT_DRILLS !== "0";
const terminalStatuses = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
const terminalEvents = new Set([
  "schedule_job.succeeded",
  "schedule_job.failed",
  "schedule_job.cancelled",
  "schedule_job.timed_out",
]);
const timelines = [];

assert(operatorPassword, "DEMO_OPERATOR_PASSWORD must be set.");

try {
  const result = await run();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  restoreDependencies();
  console.error(`Demo reliability smoke failed: ${errorMessage(error)}`);
  process.exitCode = 1;
}

async function run() {
  const schedulerHealth = await getJson(`${schedulerBase}/health`);
  assert(
    schedulerHealth.ok === true && schedulerHealth.service === "examforge-scheduler",
    "Scheduler liveness is invalid.",
  );
  const schedulerReadiness = await getJson(`${schedulerBase}/ready`);
  assert(schedulerReadiness.ok === true, "Scheduler is not ready.");

  const health = await getJson(`${apiBase}/health`);
  assert(health.ok === true && health.service === "examforge-api", "API liveness is invalid.");
  const readiness = await getJson(`${apiBase}/ready`);
  assert(readiness.ok === true, "API is not ready.");
  assert(readiness.storage === "postgres", `Expected PostgreSQL storage, received ${readiness.storage}.`);
  await assertWorkerHealth("publisher");
  await assertWorkerHealth("worker");

  const sessionCookie = await login("operator", operatorPassword);
  const authenticatedHeaders = { cookie: sessionCookie };
  const referenceData = await getJson(`${apiBase}/api/reference-data`, {
    headers: authenticatedHeaders,
  });
  for (const [resource, records] of Object.entries({
    exams: referenceData.scheduleInput?.exam_tasks,
    rooms: referenceData.scheduleInput?.rooms,
    teachers: referenceData.scheduleInput?.teachers,
    slots: referenceData.scheduleInput?.time_slots,
  })) {
    assert(Array.isArray(records) && records.length > 0, `Seeded ${resource} are missing.`);
  }

  const directSchedule = await getJson(`${schedulerBase}/solve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "demo-smoke-feasible",
    },
    body: JSON.stringify(referenceData.scheduleInput),
  });
  assert(
    directSchedule.statistics?.status === "feasible",
    `Expected direct scheduler feasible result, received ${directSchedule.statistics?.status}.`,
  );
  const infeasibleInput = structuredClone(referenceData.scheduleInput);
  infeasibleInput.rooms = infeasibleInput.rooms.map((room) => ({ ...room, capacity: 1 }));
  const directInfeasible = await getJson(`${schedulerBase}/solve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": "demo-smoke-infeasible",
    },
    body: JSON.stringify(infeasibleInput),
  });
  assert(
    directInfeasible.statistics?.status === "infeasible",
    `Expected direct scheduler infeasible result, received ${directInfeasible.statistics?.status}.`,
  );

  const jobs = {};
  jobs.apiRestartAndSseReconnect = await timed("api_restart_and_sse_reconnect", async () => {
    compose("stop", "publisher");
    const job = await submitJob(authenticatedHeaders, "api-restart");
    const queuedEvidence = await waitForEvidence(
      job.id,
      (value) => value.pendingOutbox > 0,
      "queued outbox before API restart",
    );
    compose("restart", "api");
    await waitForApiReady();
    compose("start", "publisher");
    await waitForWorkerReady("publisher");

    const firstConnection = await readSse(job.id, authenticatedHeaders, { maxEvents: 1 });
    assert(firstConnection.length === 1, "Initial SSE connection did not deliver queued history.");
    const replay = await readSse(job.id, authenticatedHeaders, {
      lastEventId: firstConnection[0].id,
    });
    const observed = [...firstConnection, ...replay];
    const finalJob = await waitForTerminalJob(job.id, authenticatedHeaders);
    const evidence = await jobEvidence(job.id);
    assert(finalJob.status === "succeeded", `API restart job ended as ${finalJob.status}.`);
    assert(evidence.runCount === 1, "API restart job did not persist exactly one run.");
    assert(observed.some((event) => terminalEvents.has(event.type)), "SSE did not deliver a terminal event.");
    assert(new Set(observed.map((event) => event.id)).size === observed.length, "SSE replay duplicated an event ID.");
    assert(observed.length === evidence.eventCount, "SSE reconnect did not recover the full PostgreSQL event history.");
    return { queuedEvidence, observedSseEvents: observed.map((event) => event.type), ...evidence };
  });

  if (runFaultDrills) {
    jobs.redisOutage = await timed("redis_outage", async () => {
      compose("stop", "redis");
      const job = await submitJob(authenticatedHeaders, "redis-outage");
      const outageEvidence = await waitForEvidence(
        job.id,
        (value) => value.pendingOutbox > 0,
        "PostgreSQL outbox retained while Redis was stopped",
      );
      compose("start", "redis");
      await waitForApiReady();
      await waitForWorkerReady("publisher");
      await waitForWorkerReady("worker");
      const finalJob = await waitForTerminalJob(job.id, authenticatedHeaders, 90_000);
      const evidence = await jobEvidence(job.id);
      assert(finalJob.status === "succeeded", `Redis outage job ended as ${finalJob.status}.`);
      assert(evidence.runCount === 1, "Redis outage produced an invalid run count.");
      return { outageEvidence, ...evidence };
    });

    jobs.publisherRestart = await timed("publisher_restart", async () => {
      compose("stop", "publisher");
      const job = await submitJob(authenticatedHeaders, "publisher-restart");
      const stoppedEvidence = await waitForEvidence(
        job.id,
        (value) => value.pendingOutbox > 0,
        "outbox retained while Publisher was stopped",
      );
      compose("start", "publisher");
      await waitForWorkerReady("publisher");
      const finalJob = await waitForTerminalJob(job.id, authenticatedHeaders);
      const evidence = await jobEvidence(job.id);
      assert(finalJob.status === "succeeded", `Publisher restart job ended as ${finalJob.status}.`);
      assert(evidence.runCount === 1, "Publisher restart produced an invalid run count.");
      return { stoppedEvidence, ...evidence };
    });

    jobs.workerCrash = await timed("worker_crash_and_stalled_recovery", async () => {
      compose("pause", "scheduler");
      const job = await submitJob(authenticatedHeaders, "worker-crash");
      const runningEvidence = await waitForEvidence(
        job.id,
        (value) => value.status === "running" && value.attemptCount === 1,
        "Worker claimed the job before crash",
      );
      compose("kill", "-s", "SIGKILL", "worker");
      compose("unpause", "scheduler");
      await waitForHttp(`${schedulerBase}/ready`, "scheduler readiness after unpause");
      startExistingContainer("worker");
      await waitForWorkerReady("worker");
      const finalJob = await waitForTerminalJob(job.id, authenticatedHeaders, 120_000);
      const evidence = await jobEvidence(job.id);
      assert(finalJob.status === "succeeded", `Stalled recovery job ended as ${finalJob.status}.`);
      assert(evidence.attemptCount >= 2, "Stalled recovery did not create a reclaim attempt.");
      assert(evidence.runCount === 1, "Stalled recovery produced duplicate schedule runs.");
      assert(
        evidence.events.includes("schedule_job.retry_scheduled"),
        "Stalled recovery did not record a retry event.",
      );
      return { runningEvidence, ...evidence };
    });

    jobs.schedulerOutage = await timed("scheduler_outage", async () => {
      compose("stop", "scheduler");
      assertSchedulerUnavailableFromWorker();
      const job = await submitJob(authenticatedHeaders, "scheduler-outage");
      const unavailableEvidence = await waitForEvidence(
        job.id,
        (value) => value.attempts.some((attempt) => (
          attempt.status === "failed" && attempt.errorCode === "scheduler_unavailable"
        )) && value.events.includes("schedule_job.retry_scheduled"),
        "Worker committed an unavailable attempt and retry event",
        30_000,
        100,
      );
      compose("start", "scheduler");
      await waitForHttp(`${schedulerBase}/ready`, "scheduler readiness");
      const finalJob = await waitForTerminalJob(job.id, authenticatedHeaders, 90_000);
      const evidence = await jobEvidence(job.id);
      assert(finalJob.status === "succeeded", `Scheduler outage job ended as ${finalJob.status}.`);
      assert(evidence.attemptCount >= 2, "Scheduler outage did not exercise retry delivery.");
      assert(evidence.runCount === 1, "Scheduler outage produced an invalid run count.");
      return { unavailableEvidence, ...evidence };
    });

    jobs.duplicateOutbox = await timed("duplicate_outbox", async () => {
      const source = jobs.publisherRestart;
      const before = await jobEvidence(source.jobId);
      resetQueuedOutbox(source.jobId);
      await waitForEvidence(
        source.jobId,
        (value) => value.outboxAttemptMax > before.outboxAttemptMax,
        "duplicate outbox was acknowledged",
      );
      await delay(1_500);
      const after = await jobEvidence(source.jobId);
      assert(after.attemptCount === before.attemptCount, "Duplicate outbox created another Worker attempt.");
      assert(after.eventCount === before.eventCount, "Duplicate outbox created another business event.");
      assert(after.runCount === before.runCount && after.runCount === 1, "Duplicate outbox created another run.");
      return { before, after };
    });
  }

  const webResponse = await fetch(webBase, { signal: AbortSignal.timeout(15_000) });
  assert(webResponse.ok, `Web returned HTTP ${webResponse.status}.`);

  return {
    smoke: true,
    storage: readiness.storage,
    schedulerVersion: schedulerReadiness.version,
    faultDrills: runFaultDrills,
    jobs,
    timelines,
  };
}

async function submitJob(headers, suffix) {
  const response = await getJson(`${apiBase}/api/schedule-jobs`, {
    method: "POST",
    headers: {
      ...headers,
      origin: webBase,
      "idempotency-key": `demo-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    },
  });
  assert(response.job?.id, `Job submission for ${suffix} did not return an ID.`);
  assert(response.job.status === "queued", `Job submission for ${suffix} was not queued.`);
  return response.job;
}

async function readSse(jobId, headers, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);
  try {
    const response = await fetch(
      `${apiBase}/api/schedule-jobs/${encodeURIComponent(jobId)}/events`,
      {
        headers: {
          ...headers,
          accept: "text/event-stream",
          ...(options.lastEventId ? { "last-event-id": options.lastEventId } : {}),
        },
        signal: controller.signal,
      },
    );
    assert(response.ok, `SSE returned HTTP ${response.status}.`);
    assert(response.body, "SSE response did not include a body.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseSseFrame(frame);
        if (!event) {
          continue;
        }
        events.push(event);
        if (options.maxEvents && events.length >= options.maxEvents) {
          await reader.cancel();
          return events;
        }
      }
      if (done || events.some((event) => terminalEvents.has(event.type))) {
        await reader.cancel().catch(() => undefined);
        return events;
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

function parseSseFrame(frame) {
  let id = "";
  let type = "";
  const data = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
    } else if (line.startsWith("event:")) {
      type = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).trimStart());
    }
  }
  if (!id || data.length === 0) {
    return null;
  }
  const envelope = JSON.parse(data.join("\n"));
  return {
    id,
    type: envelope.type,
    protocolEvent: type,
    sequence: envelope.sequence,
  };
}

async function waitForTerminalJob(jobId, headers, timeoutMs = 60_000) {
  return waitUntil(
    `job ${jobId} terminal state`,
    () => getJson(`${apiBase}/api/schedule-jobs/${encodeURIComponent(jobId)}`, { headers })
      .then((response) => response.job),
    (job) => terminalStatuses.has(job.status),
    timeoutMs,
  );
}

async function waitForEvidence(
  jobId,
  accept,
  label,
  timeoutMs = 60_000,
  intervalMs = 250,
) {
  return waitUntil(label, () => jobEvidence(jobId), accept, timeoutMs, intervalMs);
}

async function waitForApiReady() {
  return waitUntil(
    "API readiness",
    () => getJson(`${apiBase}/ready`),
    (value) => value.ok === true && value.storage === "postgres",
    90_000,
    500,
  );
}

async function waitForWorkerReady(role) {
  const port = role === "publisher"
    ? process.env.PUBLISHER_HEALTH_PORT ?? "4010"
    : process.env.WORKER_HEALTH_PORT ?? "4011";
  return waitForHttp(`http://127.0.0.1:${port}/ready`, `${role} readiness`);
}

async function assertWorkerHealth(role) {
  const port = role === "publisher"
    ? process.env.PUBLISHER_HEALTH_PORT ?? "4010"
    : process.env.WORKER_HEALTH_PORT ?? "4011";
  const health = await getJson(`http://127.0.0.1:${port}/health`);
  const ready = await getJson(`http://127.0.0.1:${port}/ready`);
  assert(health.ok === true && ready.ok === true, `${role} is not healthy and ready.`);
}

async function waitForHttp(url, label) {
  return waitUntil(label, () => getJson(url), (value) => value.ok === true, 90_000, 500);
}

async function waitUntil(label, sample, accept, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let lastValue;
  while (Date.now() < deadline) {
    try {
      lastValue = await sample();
      if (accept(lastValue)) {
        return lastValue;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  const detail = lastError ? errorMessage(lastError) : JSON.stringify(lastValue);
  throw new Error(`${label} timed out: ${detail}`);
}

function jobEvidence(jobId) {
  validateIdentifier(jobId);
  const id = sqlLiteral(jobId);
  return sqlJson(`
    SELECT json_build_object(
      'jobId', job.id,
      'status', job.status,
      'runId', job.run_id,
      'attemptCount', (
        SELECT count(*)::int FROM schedule_job_attempts attempt WHERE attempt.job_id = job.id
      ),
      'attempts', COALESCE((
        SELECT json_agg(json_build_object(
          'number', attempt.attempt_number,
          'status', attempt.status,
          'errorCategory', attempt.error->>'category',
          'errorCode', attempt.error->>'code'
        ) ORDER BY attempt.attempt_number)
        FROM schedule_job_attempts attempt WHERE attempt.job_id = job.id
      ), '[]'::json),
      'eventCount', (
        SELECT count(*)::int FROM schedule_job_events event WHERE event.job_id = job.id
      ),
      'events', COALESCE((
        SELECT json_agg(event.event_type ORDER BY event.sequence)
        FROM schedule_job_events event WHERE event.job_id = job.id
      ), '[]'::json),
      'pendingOutbox', (
        SELECT count(*)::int FROM outbox_events outbox
        WHERE outbox.aggregate_id = job.id AND outbox.published_at IS NULL
      ),
      'outboxAttemptMax', COALESCE((
        SELECT max(outbox.attempt_count)::int FROM outbox_events outbox
        WHERE outbox.aggregate_id = job.id
      ), 0),
      'runCount', (
        SELECT count(*)::int FROM schedule_runs run WHERE run.id = job.run_id
      )
    )
    FROM schedule_jobs job
    WHERE job.id = ${id};
  `);
}

function resetQueuedOutbox(jobId) {
  validateIdentifier(jobId);
  const result = sql(`
    UPDATE outbox_events
    SET published_at = NULL, available_at = now(), last_error = NULL
    WHERE id = (
      SELECT id FROM outbox_events
      WHERE aggregate_id = ${sqlLiteral(jobId)}
        AND event_type = 'schedule_job.queued'
      ORDER BY created_at
      LIMIT 1
    )
    RETURNING id;
  `);
  assert(result.trim(), `No queued outbox event exists for ${jobId}.`);
}

function sqlJson(query) {
  const output = sql(query).trim();
  assert(output, "PostgreSQL evidence query returned no rows.");
  return JSON.parse(output);
}

function sql(query) {
  return execFileSync("docker", [
    "compose",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    databaseUser,
    "-d",
    databaseName,
    "-AtX",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    query,
  ], {
    encoding: "utf8",
    env: composeEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function compose(...args) {
  return execFileSync("docker", ["compose", ...args], {
    encoding: "utf8",
    env: composeEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function startExistingContainer(service) {
  const containerId = compose("ps", "--all", "-q", service).trim();
  assert(containerId, `Compose service ${service} has no existing container.`);
  execFileSync("docker", ["start", containerId], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function assertSchedulerUnavailableFromWorker() {
  const workerId = compose("ps", "--all", "-q", "worker").trim();
  assert(workerId, "Compose Worker container is missing.");
  execFileSync("docker", [
    "exec",
    workerId,
    "node",
    "-e",
    "fetch('http://scheduler:8000/ready',{signal:AbortSignal.timeout(1000)}).then(()=>process.exit(1)).catch(()=>process.exit(0))",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function restoreDependencies() {
  bestEffortCompose("unpause", "scheduler");
  bestEffortCompose("start", "postgres", "redis", "scheduler", "publisher", "worker", "api", "web");
}

function bestEffortCompose(...args) {
  try {
    compose(...args);
  } catch {
    // The E2E wrapper still owns final teardown and diagnostics.
  }
}

function composeEnvironment() {
  return {
    ...process.env,
    COMPOSE_ANSI: "never",
  };
}

async function timed(name, operation) {
  const startedAt = new Date();
  try {
    const result = await operation();
    const finishedAt = new Date();
    timelines.push({
      scenario: name,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      outcome: "passed",
    });
    return result;
  } catch (error) {
    const finishedAt = new Date();
    timelines.push({
      scenario: name,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      outcome: "failed",
      error: errorMessage(error),
    });
    throw error;
  }
}

async function login(username, password) {
  const response = await fetch(`${apiBase}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: webBase,
    },
    body: JSON.stringify({ username, password }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Login returned HTTP ${response.status}.`);
  }
  const setCookie = response.headers.get("set-cookie");
  assert(setCookie, "Login response did not issue a session cookie.");
  return setCookie.split(";", 1)[0];
}

async function getJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    let errorCode = "unknown_error";
    try {
      const body = await response.json();
      errorCode = body.error ?? body.code ?? errorCode;
    } catch {
      // Status and stable error code are sufficient for smoke diagnostics.
    }
    throw new Error(`${init.method ?? "GET"} ${new URL(url).pathname} returned HTTP ${response.status} (${errorCode}).`);
  }
  return response.json();
}

function validateIdentifier(value) {
  assert(/^[A-Za-z0-9_-]+$/.test(value), "Evidence identifier contains unsupported characters.");
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
