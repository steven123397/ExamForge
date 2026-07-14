import { isProductionDeployment } from "../deployment-mode.js";

const localOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];

export function getTrustedOrigins(
  env: Record<string, string | undefined> = process.env,
): Set<string> {
  const configured = env.EXAMFORGE_TRUSTED_ORIGINS;
  const productionDeployment = isProductionDeployment(env);
  if (productionDeployment && !configured?.trim()) {
    throw new Error("EXAMFORGE_TRUSTED_ORIGINS is required in production.");
  }

  const candidates = configured?.split(",") ?? localOrigins;
  const origins = candidates.map((candidate) => parseOrigin(candidate, productionDeployment));
  if (origins.length === 0) {
    throw new Error("EXAMFORGE_TRUSTED_ORIGINS must contain at least one valid origin.");
  }
  return new Set(origins);
}

function parseOrigin(value: string, productionDeployment: boolean): string {
  const candidate = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`EXAMFORGE_TRUSTED_ORIGINS must contain a valid origin: ${candidate || "<empty>"}.`);
  }
  if (
    !candidate
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || candidate !== parsed.origin
  ) {
    throw new Error(`EXAMFORGE_TRUSTED_ORIGINS must contain each exact origin: ${candidate || "<empty>"}.`);
  }
  if (productionDeployment && parsed.protocol !== "https:") {
    throw new Error("Production trusted origins must use HTTPS.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Trusted origins must use HTTP or HTTPS.");
  }
  return parsed.origin;
}
