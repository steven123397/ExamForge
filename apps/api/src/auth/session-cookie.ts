export interface SessionCookieConfig {
  name: string;
  secure: boolean;
  maxAgeSeconds: number;
}

export function getSessionCookieConfig(): SessionCookieConfig {
  const secureOverride = process.env.EXAMFORGE_SESSION_COOKIE_SECURE;
  return {
    name: process.env.EXAMFORGE_SESSION_COOKIE_NAME ?? "examforge_session",
    secure: secureOverride === "true"
      ? true
      : secureOverride === "false"
        ? false
        : process.env.NODE_ENV === "production",
    maxAgeSeconds: Number(process.env.EXAMFORGE_SESSION_TTL_SECONDS ?? 43_200),
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
