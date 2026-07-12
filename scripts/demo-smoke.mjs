import { execFileSync } from "node:child_process";

const apiBase = process.env.DEMO_API_BASE_URL ?? "http://127.0.0.1:4000";
const webBase = process.env.DEMO_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const operatorPassword = process.env.DEMO_OPERATOR_PASSWORD
  ?? process.env.EXAMFORGE_OPERATOR_PASSWORD;
assert(operatorPassword, "DEMO_OPERATOR_PASSWORD must be set.");

const health = await getJson(`${apiBase}/health`);
assert(health.ok === true && health.service === "examforge-api", "API liveness is invalid.");

const readiness = await getJson(`${apiBase}/ready`);
assert(readiness.ok === true, "API is not ready.");
assert(readiness.storage === "postgres", `Expected PostgreSQL storage, received ${readiness.storage}.`);

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

const run = await getJson(`${apiBase}/api/schedule-runs`, {
  method: "POST",
  headers: { ...authenticatedHeaders, origin: webBase },
});
assert(run.run?.status === "feasible", `Expected feasible run, received ${run.run?.status}.`);
assert(run.result?.assignments?.length > 0, "Schedule run has no assignments.");
assert(run.result?.score?.hard_violation_count === 0, "Schedule run has hard violations.");

const webResponse = await fetch(webBase, { signal: AbortSignal.timeout(15_000) });
assert(webResponse.ok, `Web returned HTTP ${webResponse.status}.`);

execFileSync("docker", ["compose", "restart", "api"], { stdio: "inherit" });
await waitForReady();
const persistedRun = await getJson(`${apiBase}/api/schedule-runs/${encodeURIComponent(run.run.id)}`, {
  headers: authenticatedHeaders,
});
assert(persistedRun.run?.id === run.run.id, "Schedule run was not persisted across API restart.");

console.log(JSON.stringify({
  smoke: true,
  storage: readiness.storage,
  runId: run.run.id,
  assignments: run.result.assignments.length,
  hardViolations: run.result.score.hard_violation_count,
}, null, 2));

async function waitForReady() {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await getJson(`${apiBase}/ready`);
      if (result.ok === true && result.storage === "postgres") {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become ready after restart: ${lastError ?? "unknown error"}`);
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
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Login returned HTTP ${response.status}: ${text}`);
  }
  const setCookie = response.headers.get("set-cookie");
  assert(setCookie, "Login response did not issue a session cookie.");
  return setCookie.split(";", 1)[0];
}

async function getJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${url} returned HTTP ${response.status}: ${text}`);
  }
  return JSON.parse(text);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
