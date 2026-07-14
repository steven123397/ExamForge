import { isProductionDeployment } from "../deployment-mode.js";

export interface SessionCookieConfig {
  name: string;
  secure: boolean;
  maxAgeSeconds: number;
}

const cookieNamePattern = /^[A-Za-z0-9_-]{1,64}$/;
const minimumTtlSeconds = 300;
const maximumTtlSeconds = 604_800;

export function getSessionCookieConfig(
  env: Record<string, string | undefined> = process.env,
): SessionCookieConfig {
  const name = env.EXAMFORGE_SESSION_COOKIE_NAME ?? "examforge_session";
  if (!cookieNamePattern.test(name)) {
    throw new Error("EXAMFORGE_SESSION_COOKIE_NAME must be a valid cookie name.");
  }

  const secureOverride = env.EXAMFORGE_SESSION_COOKIE_SECURE;
  if (secureOverride !== undefined && secureOverride !== "true" && secureOverride !== "false") {
    throw new Error("EXAMFORGE_SESSION_COOKIE_SECURE must be true or false.");
  }
  const productionDeployment = isProductionDeployment(env);
  if (productionDeployment && secureOverride === "false") {
    throw new Error("Secure cookies cannot be disabled in production.");
  }

  const maxAgeSeconds = Number(env.EXAMFORGE_SESSION_TTL_SECONDS ?? 43_200);
  if (
    !Number.isInteger(maxAgeSeconds)
    || maxAgeSeconds < minimumTtlSeconds
    || maxAgeSeconds > maximumTtlSeconds
  ) {
    throw new Error(
      `Session TTL must be an integer between ${minimumTtlSeconds} and ${maximumTtlSeconds} seconds.`,
    );
  }

  return {
    name,
    secure: secureOverride === "true"
      ? true
      : secureOverride === "false"
        ? false
        : productionDeployment,
    maxAgeSeconds,
  };
}

export function readSessionCookie(header: string | undefined, name: string): string | null {
  for (const item of header?.split(";") ?? []) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== name) {
      continue;
    }
    return decodeURIComponent(item.slice(separator + 1).trim());
  }
  return null;
}

export function serializeSessionCookie(
  token: string,
  config: SessionCookieConfig,
  expiresAt: string,
) {
  return [
    `${config.name}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    config.secure ? "Secure" : null,
    `Max-Age=${config.maxAgeSeconds}`,
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].filter(Boolean).join("; ");
}

export function serializeExpiredSessionCookie(config: SessionCookieConfig) {
  return [
    `${config.name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    config.secure ? "Secure" : null,
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ].filter(Boolean).join("; ");
}
