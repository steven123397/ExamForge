import { getSessionCookieConfig } from "./auth/session-cookie.js";
import { getTrustedOrigins } from "./auth/trusted-origins.js";
import { isProductionDeployment } from "./deployment-mode.js";

const passwordVariables = [
  "EXAMFORGE_ADMIN_PASSWORD",
  "EXAMFORGE_OPERATOR_PASSWORD",
  "EXAMFORGE_TEACHER_PASSWORD",
  "EXAMFORGE_STUDENT_PASSWORD",
] as const;

export function validateApiProductionEnvironment(
  env: Record<string, string | undefined> = process.env,
) {
  if (!isProductionDeployment(env)) {
    return;
  }

  requiredUrl(env.DATABASE_URL, "DATABASE_URL", ["postgres:", "postgresql:"]);
  requiredUrl(env.REDIS_URL, "REDIS_URL", ["redis:", "rediss:"]);
  if (env.SCHEDULER_TRANSPORT !== "http") {
    throw new Error("SCHEDULER_TRANSPORT must be http in production.");
  }
  requiredUrl(env.SCHEDULER_BASE_URL, "SCHEDULER_BASE_URL", ["http:", "https:"]);
  getSessionCookieConfig(env);
  getTrustedOrigins(env);

  for (const variable of passwordVariables) {
    requireStrongPassword(env[variable], variable);
  }
}

function requiredUrl(value: string | undefined, name: string, protocols: string[]) {
  if (!value?.trim()) {
    throw new Error(`${name} is required in production.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} uses an unsupported protocol.`);
  }
}

function requireStrongPassword(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`${name} is required in production.`);
  }
  if (value.length < 20) {
    throw new Error(`${name} must contain at least 20 characters.`);
  }
  if (/(?:change[-_ ]?me|replace|example|placeholder|<[^>]+>)/i.test(value)) {
    throw new Error(`${name} must not contain a placeholder value.`);
  }
}
