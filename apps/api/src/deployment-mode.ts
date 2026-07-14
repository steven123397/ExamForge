export type DeploymentMode = "development" | "demo" | "production";

export function getDeploymentMode(
  env: Record<string, string | undefined> = process.env,
): DeploymentMode {
  const configured = env.EXAMFORGE_DEPLOYMENT_MODE;
  if (configured === "demo" || configured === "production") {
    return configured;
  }
  if (configured !== undefined && configured !== "development") {
    throw new Error("EXAMFORGE_DEPLOYMENT_MODE must be development, demo or production.");
  }
  return env.NODE_ENV === "production" ? "production" : "development";
}

export function isProductionDeployment(
  env: Record<string, string | undefined> = process.env,
) {
  return getDeploymentMode(env) === "production";
}
