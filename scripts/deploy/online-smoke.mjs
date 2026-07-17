#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const apiBase = process.env.ONLINE_API_BASE_URL ?? "http://127.0.0.1:4000";
const webBase = process.env.ONLINE_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const publicOrigin = process.env.EXAMFORGE_PUBLIC_ORIGIN;
const composeFile = process.env.ONLINE_COMPOSE_FILE ?? "compose.production.yml";
const composeEnvFile = process.env.ONLINE_COMPOSE_ENV_FILE ?? ".env.production";
const projectName = process.env.COMPOSE_PROJECT_NAME ?? "examforge";
const databaseUser = process.env.POSTGRES_USER ?? "examforge";
const databaseName = process.env.POSTGRES_DB ?? "examforge";
const runFaultDrills = process.env.ONLINE_RUN_FAULT_DRILLS !== "0";
const terminalStatuses = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
const terminalEvents = new Set([
  "schedule_job.succeeded",
  "schedule_job.failed",
  "schedule_job.cancelled",
  "schedule_job.timed_out",
]);
const timelines = [];

assert(publicOrigin, "EXAMFORGE_PUBLIC_ORIGIN must be set.");
for (const name of ["ADMIN", "OPERATOR", "TEACHER", "STUDENT"]) {
  assert(password(name), `ONLINE_${name}_PASSWORD must be set.`);
}

try {
  const result = await run();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  restoreDependencies();
  process.stderr.write(`Online smoke failed: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}

async function run() {
  await waitForApiReady();
  await waitForInternalReadiness("publisher");
  await waitForInternalReadiness("worker");
  await waitForInternalReadiness("scheduler");

  const adminCookie = await login("admin", password("ADMIN"));
  let operatorCookie = await login("operator", password("OPERATOR"));
  const teacherCookie = await login("teacher", password("TEACHER"));
  const studentCookie = await login("student", password("STUDENT"));
  const adminHeaders = { cookie: adminCookie };
  let operatorHeaders = { cookie: operatorCookie };
  const teacherHeaders = { cookie: teacherCookie };
  const studentHeaders = { cookie: studentCookie };

  await assertRole(adminHeaders, "admin");
  await assertRole(operatorHeaders, "operator");
  await assertRole(teacherHeaders, "teacher");
  await assertRole(studentHeaders, "student");
  const teacherAudience = await getJson(`${apiBase}/api/me/audience`, { headers: teacherHeaders });
  const studentAudience = await getJson(`${apiBase}/api/me/audience`, { headers: studentHeaders });
  assert(teacherAudience.kind === "teacher", "Teacher audience scope is invalid.");
  assert(studentAudience.kind === "student", "Student audience scope is invalid.");

  const referenceData = await getJson(`${apiBase}/api/reference-data`, {
    headers: operatorHeaders,
  });
  assert(referenceData.scheduleInput?.exam_tasks?.length > 0, "Reference data is empty.");
  const profiles = await getJson(`${apiBase}/api/constraint-profiles`, {
    headers: operatorHeaders,
  });
  assert(Array.isArray(profiles.profiles) && profiles.profiles.length > 0,
    "Constraint profile governance is unavailable.");

  const primaryJob = await submitJob(operatorHeaders, "business-workflow");
  const sseEvents = await readSse(primaryJob.id, operatorHeaders);
  assert(sseEvents.some((event) => terminalEvents.has(event.type)),
    "SSE did not deliver a terminal event.");
  const primaryFinal = await waitForTerminalJob(primaryJob.id, operatorHeaders);
  assert(primaryFinal.status === "succeeded", `Primary job ended as ${primaryFinal.status}.`);
  const primaryEvidence = jobEvidence(primaryJob.id);
  assertJobIntegrity(primaryEvidence, "primary workflow");

  const draft = await getJson(
    `${apiBase}/api/schedule-runs/${encodeURIComponent(primaryFinal.runId)}/drafts`,
    { method: "POST", headers: mutationHeaders(operatorHeaders) },
  );
  assert(draft.draft?.id, "Draft creation did not return an ID.");
  const validatedDraft = await getJson(
    `${apiBase}/api/schedule-drafts/${encodeURIComponent(draft.draft.id)}/validate`,
    { method: "POST", headers: mutationHeaders(operatorHeaders) },
  );
  assert(validatedDraft.draft?.status === "validated", "Draft validation did not succeed.");
  const published = await getJson(
    `${apiBase}/api/schedule-drafts/${encodeURIComponent(draft.draft.id)}/publish`,
    { method: "POST", headers: mutationHeaders(adminHeaders) },
  );
  assert(published.run?.id, "Draft publication did not create a published run.");

  const teacherSchedule = await getJson(`${apiBase}/api/me/published-schedule`, {
    headers: teacherHeaders,
  });
  const studentSchedule = await getJson(`${apiBase}/api/me/published-schedule`, {
    headers: studentHeaders,
  });
  assert(Array.isArray(teacherSchedule.assignments), "Teacher published schedule is invalid.");
  assert(Array.isArray(studentSchedule.assignments), "Student published schedule is invalid.");
  const audit = await getJson(`${apiBase}/api/audit-events?page=1&pageSize=20`, {
    headers: adminHeaders,
  });
  assert(Array.isArray(audit.events) && audit.events.length > 0, "Audit trail is empty.");

  const faults = {};
  if (runFaultDrills) {
    faults.api = await timed("api_restart", async () => {
      compose("stop", "publisher");
      const job = await submitJob(operatorHeaders, "api-restart");
      const initialEvents = await readSse(job.id, operatorHeaders, { stopAfterFirstEvent: true });
      assert(initialEvents.length > 0, "API restart SSE did not return an initial event.");
      const lastEventId = initialEvents.at(-1).id;
      await waitForEvidence(job.id, (value) => value.pendingOutbox > 0, "API restart outbox");
      compose("restart", "api");
      await waitForApiReady();
      operatorCookie = await login("operator", password("OPERATOR"));
      operatorHeaders = { cookie: operatorCookie };
      compose("start", "publisher");
      await waitForInternalReadiness("publisher");
      const resumedEvents = await readSse(job.id, operatorHeaders, { lastEventId });
      assert(resumedEvents.some((event) => terminalEvents.has(event.type)),
        "API restart SSE reconnect did not deliver a terminal event.");
      assert(resumedEvents.every((event) => event.id !== lastEventId),
        "API restart SSE reconnect replayed the acknowledged event.");
      const evidence = await finishFaultJob(job.id, operatorHeaders, "API restart");
      return {
        ...evidence,
        sseReconnect: {
          lastEventId,
          replayedEventCount: resumedEvents.length,
          terminalEvent: resumedEvents.at(-1).type,
        },
      };
    });

    faults.redis = await timed("redis_restart", async () => {
      compose("stop", "redis");
      const job = await submitJob(operatorHeaders, "redis-restart");
      await waitForEvidence(job.id, (value) => value.pendingOutbox > 0, "Redis outage outbox");
      compose("start", "redis");
      await waitForApiReady();
      await waitForInternalReadiness("publisher");
      await waitForInternalReadiness("worker");
      return finishFaultJob(job.id, operatorHeaders, "Redis restart");
    });

    faults.publisher = await timed("publisher_restart", async () => {
      compose("stop", "publisher");
      const job = await submitJob(operatorHeaders, "publisher-restart");
      await waitForEvidence(job.id, (value) => value.pendingOutbox > 0, "Publisher outage outbox");
      compose("start", "publisher");
      await waitForInternalReadiness("publisher");
      return finishFaultJob(job.id, operatorHeaders, "Publisher restart");
    });

    faults.worker = await timed("worker_crash", async () => {
      compose("pause", "scheduler");
      const job = await submitJob(operatorHeaders, "worker-crash");
      await waitForEvidence(
        job.id,
        (value) => value.status === "running" && value.attemptCount === 1,
        "Worker claim before crash",
      );
      compose("kill", "-s", "SIGKILL", "worker");
      compose("unpause", "scheduler");
      await waitForInternalReadiness("scheduler");
      startExistingContainer("worker");
      await waitForInternalReadiness("worker");
      const evidence = await finishFaultJob(job.id, operatorHeaders, "Worker crash", 120_000);
      assert(evidence.attemptCount >= 2, "Worker crash did not create a reclaim attempt.");
      return evidence;
    });

    faults.scheduler = await timed("scheduler_restart", async () => {
      compose("stop", "scheduler");
      const job = await submitJob(operatorHeaders, "scheduler-restart");
      await waitForEvidence(
        job.id,
        (value) => value.attempts.some((attempt) => (
          attempt.status === "failed" && attempt.errorCode === "scheduler_unavailable"
        )) && value.events.includes("schedule_job.retry_scheduled"),
        "Scheduler outage attempt",
        30_000,
        100,
      );
      compose("start", "scheduler");
      await waitForInternalReadiness("scheduler");
      return finishFaultJob(job.id, operatorHeaders, "Scheduler restart", 120_000);
    });
  }

  const webResponse = await fetch(webBase, { signal: AbortSignal.timeout(15_000) });
  assert(webResponse.ok, `Web returned HTTP ${webResponse.status}.`);
  return {
    smoke: true,
    roles: ["admin", "operator", "teacher", "student"],
    primary: primaryEvidence,
    publishedRunId: published.run.id,
    faultDrills: runFaultDrills,
    faults,
    timelines,
  };
}

async function login(username, value) {
  const response = await fetch(`${apiBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: publicOrigin },
    body: JSON.stringify({ username, password: value }),
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `Login for ${username} returned HTTP ${response.status}.`);
  const cookie = response.headers.get("set-cookie");
  assert(cookie, `Login for ${username} did not return a cookie.`);
  return cookie.split(";", 1)[0];
}

async function assertRole(headers, expectedRole) {
  const context = await getJson(`${apiBase}/api/auth/me`, { headers });
  assert(context.user?.roles?.includes(expectedRole), `Authenticated ${expectedRole} role is missing.`);
}

async function submitJob(headers, suffix) {
  const response = await getJson(`${apiBase}/api/schedule-jobs`, {
    method: "POST",
    headers: {
      ...mutationHeaders(headers),
      "idempotency-key": `online-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    },
  });
  assert(response.job?.id && response.job.status === "queued", `Job ${suffix} was not queued.`);
  return response.job;
}

function mutationHeaders(headers) {
  return { ...headers, origin: publicOrigin };
}

async function readSse(jobId, headers, options = {}) {
  const requestHeaders = { ...headers, accept: "text/event-stream" };
  if (options.lastEventId !== undefined) {
    requestHeaders["last-event-id"] = options.lastEventId;
  }
  const response = await fetch(`${apiBase}/api/schedule-jobs/${encodeURIComponent(jobId)}/events`, {
    headers: requestHeaders,
    signal: AbortSignal.timeout(90_000),
  });
  assert(response.ok && response.body, `SSE returned HTTP ${response.status}.`);
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
      if (event) events.push(event);
    }
    if (
      done
      || (options.stopAfterFirstEvent === true && events.length > 0)
      || events.some((event) => terminalEvents.has(event.type))
    ) {
      await reader.cancel().catch(() => undefined);
      return events;
    }
  }
}

function parseSseFrame(frame) {
  let id = "";
  const data = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("id:")) id = line.slice(3).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!id || data.length === 0) return null;
  const envelope = JSON.parse(data.join("\n"));
  return { id, type: envelope.type, sequence: envelope.sequence };
}

async function finishFaultJob(jobId, headers, label, timeoutMs = 90_000) {
  const job = await waitForTerminalJob(jobId, headers, timeoutMs);
  assert(job.status === "succeeded", `${label} job ended as ${job.status}.`);
  const evidence = jobEvidence(jobId);
  assertJobIntegrity(evidence, label);
  return evidence;
}

function assertJobIntegrity(evidence, label) {
  assert(evidence.runCount === 1, `${label} did not preserve exactly one run.`);
  assert(evidence.sequenceOrderValid === true, `${label} event order is invalid.`);
  assert(evidence.eventCount > 0 && evidence.attemptCount > 0, `${label} evidence is incomplete.`);
}

async function waitForTerminalJob(jobId, headers, timeoutMs = 90_000) {
  return waitUntil(
    `job ${jobId} terminal state`,
    () => getJson(`${apiBase}/api/schedule-jobs/${encodeURIComponent(jobId)}`, { headers })
      .then((response) => response.job),
    (job) => terminalStatuses.has(job.status),
    timeoutMs,
  );
}

async function waitForEvidence(jobId, accept, label, timeoutMs = 60_000, intervalMs = 250) {
  return waitUntil(label, () => jobEvidence(jobId), accept, timeoutMs, intervalMs);
}

function jobEvidence(jobId) {
  assert(/^[A-Za-z0-9_-]+$/.test(jobId), "Job ID contains unsupported characters.");
  const value = sqlJson(`
    SELECT json_build_object(
      'jobId', job.id,
      'status', job.status,
      'attemptCount', (SELECT count(*)::int FROM schedule_job_attempts WHERE job_id = job.id),
      'attempts', COALESCE((
        SELECT json_agg(json_build_object(
          'status', attempt.status,
          'errorCode', attempt.error->>'code'
        ) ORDER BY attempt.attempt_number)
        FROM schedule_job_attempts attempt WHERE attempt.job_id = job.id
      ), '[]'::json),
      'eventCount', (SELECT count(*)::int FROM schedule_job_events WHERE job_id = job.id),
      'events', COALESCE((
        SELECT json_agg(event.event_type ORDER BY event.sequence)
        FROM schedule_job_events event WHERE event.job_id = job.id
      ), '[]'::json),
      'pendingOutbox', (SELECT count(*)::int FROM outbox_events WHERE aggregate_id = job.id AND published_at IS NULL),
      'runCount', (SELECT count(*)::int FROM schedule_runs WHERE id = job.run_id),
      'sequenceOrderValid', NOT EXISTS (
        SELECT 1 FROM (
          SELECT sequence, lag(sequence) OVER (ORDER BY sequence) AS previous_sequence
          FROM schedule_job_events WHERE job_id = job.id
        ) ordered WHERE previous_sequence IS NOT NULL AND sequence <= previous_sequence
      )
    ) FROM schedule_jobs job WHERE job.id = '${jobId}';
  `);
  assert(value?.jobId === jobId, `No PostgreSQL evidence exists for ${jobId}.`);
  return value;
}

function sqlJson(query) {
  const output = compose("exec", "-T", "postgres", "psql", "-U", databaseUser,
    "-d", databaseName, "-AtX", "-v", "ON_ERROR_STOP=1", "-c", query).trim();
  return JSON.parse(output);
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

async function waitForInternalReadiness(service) {
  return waitUntil(`${service} readiness`, async () => {
    try {
      if (service === "scheduler") {
        compose("exec", "-T", service, "python", "-c",
          "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=3).read()");
      } else {
        compose("exec", "-T", service, "node", "-e",
          "fetch('http://127.0.0.1:4010/ready',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))");
      }
      return true;
    } catch {
      return false;
    }
  }, Boolean, 90_000, 500);
}

function startExistingContainer(service) {
  const containerId = compose("ps", "--all", "-q", service).trim();
  assert(containerId, `Compose service ${service} has no container.`);
  execFileSync("docker", ["start", containerId], { stdio: "ignore" });
}

function compose(...args) {
  return execFileSync("docker", [
    "compose",
    "--env-file", composeEnvFile,
    "-f", composeFile,
    "-p", projectName,
    ...args,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function restoreDependencies() {
  for (const args of [
    ["unpause", "scheduler"],
    ["start", "postgres", "redis", "scheduler", "publisher", "worker", "api", "web"],
  ]) {
    try { compose(...args); } catch { /* final cleanup belongs to the caller */ }
  }
}

async function getJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${new URL(url).pathname} returned HTTP ${response.status}.`);
  return response.json();
}

async function waitUntil(label, sample, accept, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let lastValue;
  while (Date.now() < deadline) {
    try {
      lastValue = await sample();
      if (accept(lastValue)) return lastValue;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} timed out: ${lastError ? errorMessage(lastError) : JSON.stringify(lastValue)}`);
}

async function timed(name, operation) {
  const startedAt = Date.now();
  const value = await operation();
  timelines.push({ scenario: name, durationMs: Date.now() - startedAt, outcome: "passed" });
  return value;
}

function password(name) {
  return process.env[`ONLINE_${name}_PASSWORD`] ?? process.env[`EXAMFORGE_${name}_PASSWORD`];
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
