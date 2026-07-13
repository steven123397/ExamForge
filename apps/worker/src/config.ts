export interface WorkerConfig {
  role: "publisher" | "worker";
  databaseUrl: string;
  redisUrl: string;
  schedulerBaseUrl: string;
  schedulerTimeoutMs: number;
  healthHost: string;
  healthPort: number;
  outboxBatchSize: number;
  outboxPollIntervalMs: number;
  cancellationPollIntervalMs: number;
  lockDurationMs: number;
  stalledIntervalMs: number;
}

export function loadWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig {
  const role = processRole(env.WORKER_ROLE);
  fixedConcurrency(env.WORKER_CONCURRENCY ?? "1");
  return {
    role,
    databaseUrl: requiredUrl(env.DATABASE_URL, "DATABASE_URL", ["postgres:", "postgresql:"]),
    redisUrl: requiredUrl(env.REDIS_URL, "REDIS_URL", ["redis:", "rediss:"]),
    schedulerBaseUrl: requiredUrl(
      env.SCHEDULER_BASE_URL,
      "SCHEDULER_BASE_URL",
      ["http:", "https:"],
    ),
    schedulerTimeoutMs: positiveInteger(
      env.SCHEDULER_HTTP_TIMEOUT_MS ?? "35000",
      "SCHEDULER_HTTP_TIMEOUT_MS",
    ),
    healthHost: env.WORKER_HEALTH_HOST?.trim() || "0.0.0.0",
    healthPort: positiveInteger(env.WORKER_HEALTH_PORT ?? "4010", "WORKER_HEALTH_PORT"),
    outboxBatchSize: positiveInteger(env.OUTBOX_BATCH_SIZE ?? "25", "OUTBOX_BATCH_SIZE"),
    outboxPollIntervalMs: positiveInteger(
      env.OUTBOX_POLL_INTERVAL_MS ?? "500",
      "OUTBOX_POLL_INTERVAL_MS",
    ),
    cancellationPollIntervalMs: positiveInteger(
      env.WORKER_CANCELLATION_POLL_INTERVAL_MS ?? "250",
      "WORKER_CANCELLATION_POLL_INTERVAL_MS",
    ),
    lockDurationMs: positiveInteger(
      env.WORKER_LOCK_DURATION_MS ?? "30000",
      "WORKER_LOCK_DURATION_MS",
    ),
    stalledIntervalMs: positiveInteger(
      env.WORKER_STALLED_INTERVAL_MS ?? "30000",
      "WORKER_STALLED_INTERVAL_MS",
    ),
  };
}

function processRole(value: string | undefined): "publisher" | "worker" {
  const role = value?.trim() || "worker";
  if (role !== "publisher" && role !== "worker") {
    throw new Error("WORKER_ROLE must be publisher or worker.");
  }
  return role;
}

function fixedConcurrency(value: string) {
  if (value.trim() !== "1") {
    throw new Error("WORKER_CONCURRENCY is fixed at 1.");
  }
}

function requiredUrl(
  value: string | undefined,
  name: string,
  protocols: string[],
) {
  if (!value?.trim()) {
    throw new Error(`${name} is required.`);
  }
  const parsed = new URL(value);
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} uses an unsupported protocol.`);
  }
  return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "" : "/");
}

function positiveInteger(value: string, name: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
