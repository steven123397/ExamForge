export interface ScheduleJobRetryPolicy {
  maxAttempts: number;
  retryBaseDelayMs: number;
}

export const DEFAULT_SCHEDULE_JOB_RETRY_POLICY = Object.freeze({
  maxAttempts: 6,
  retryBaseDelayMs: 1_000,
}) satisfies Readonly<ScheduleJobRetryPolicy>;

export const MIN_SCHEDULE_JOB_ATTEMPTS = 2;
export const MAX_SCHEDULE_JOB_ATTEMPTS = 10;
export const MAX_SCHEDULE_JOB_RETRY_DELAY_MS = 30_000;

export function validateScheduleJobRetryPolicy(
  policy: ScheduleJobRetryPolicy,
): ScheduleJobRetryPolicy {
  const maxAttempts = boundedInteger(
    policy.maxAttempts,
    "SCHEDULE_JOB_MAX_ATTEMPTS",
    MIN_SCHEDULE_JOB_ATTEMPTS,
    MAX_SCHEDULE_JOB_ATTEMPTS,
  );
  const retryBaseDelayMs = boundedInteger(
    policy.retryBaseDelayMs,
    "SCHEDULE_JOB_RETRY_BASE_DELAY_MS",
    1,
    MAX_SCHEDULE_JOB_RETRY_DELAY_MS,
  );
  const finalRetryDelayMs = retryBaseDelayMs * 2 ** (maxAttempts - 2);
  if (finalRetryDelayMs > MAX_SCHEDULE_JOB_RETRY_DELAY_MS) {
    throw new Error(
      `Schedule job final retry delay must not exceed ${MAX_SCHEDULE_JOB_RETRY_DELAY_MS} ms.`,
    );
  }
  return { maxAttempts, retryBaseDelayMs };
}

function boundedInteger(value: number, name: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}
