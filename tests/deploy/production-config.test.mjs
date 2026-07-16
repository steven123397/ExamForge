import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const composePath = join(repositoryRoot, "compose.production.yml");
const exampleEnvPath = join(repositoryRoot, ".env.production.example");
const preflightPath = join(repositoryRoot, "scripts/deploy/preflight.sh");
const digest = `sha256:${"a".repeat(64)}`;
const productionEnvironment = {
  ...process.env,
  EXAMFORGE_API_IMAGE: `ccr.ccs.tencentyun.com/examforge/api@${digest}`,
  EXAMFORGE_WEB_IMAGE: `ccr.ccs.tencentyun.com/examforge/web@${digest}`,
  EXAMFORGE_WORKER_IMAGE: `ccr.ccs.tencentyun.com/examforge/worker@${digest}`,
  EXAMFORGE_SCHEDULER_IMAGE: `ccr.ccs.tencentyun.com/examforge/scheduler@${digest}`,
  EXAMFORGE_POSTGRES_IMAGE: `postgres@${digest}`,
  EXAMFORGE_REDIS_IMAGE: `redis@${digest}`,
  EXAMFORGE_PUBLIC_ORIGIN: "https://examforge.site",
  EXAMFORGE_TRUSTED_ORIGINS: "https://examforge.site",
  EXAMFORGE_DATA_DIR: "/srv/data/hot/examforge",
  EXAMFORGE_BACKUP_DIR: "/srv/data/hot/examforge/backups/postgres",
  EXAMFORGE_OFFSITE_BACKUP_DIR: "/srv/data/cos/examforge/postgres",
  EXAMFORGE_BACKUP_RETENTION_DAYS: "14",
  EXAMFORGE_MAX_BACKUP_AGE_SECONDS: "93600",
  EXAMFORGE_MIN_FREE_KIB: "5242880",
  EXAMFORGE_CERTIFICATE_WARNING_DAYS: "21",
  EXAMFORGE_TLS_CERTIFICATE_PATH: "/etc/letsencrypt/live/examforge.site/fullchain.pem",
  POSTGRES_USER: "examforge",
  POSTGRES_PASSWORD: "test-only-url-safe-postgres-password-20260714",
  POSTGRES_DB: "examforge",
  EXAMFORGE_ADMIN_PASSWORD: "test-only-admin-password-20260714",
  EXAMFORGE_OPERATOR_PASSWORD: "test-only-operator-password-20260714",
  EXAMFORGE_TEACHER_PASSWORD: "test-only-teacher-password-20260714",
  EXAMFORGE_STUDENT_PASSWORD: "test-only-student-password-20260714",
  EXAMFORGE_SESSION_COOKIE_NAME: "examforge_session",
  EXAMFORGE_SESSION_COOKIE_SECURE: "true",
  EXAMFORGE_SESSION_TTL_SECONDS: "43200",
  EXAMFORGE_API_PORT: "4000",
  EXAMFORGE_WEB_PORT: "3000",
  SCHEDULE_JOB_MAX_ATTEMPTS: "6",
  SCHEDULE_JOB_RETRY_BASE_DELAY_MS: "1000",
};

describe("production Compose configuration", () => {
  it("is independent, digest-only and exposes only loopback Web/API ports", () => {
    assert.ok(existsSync(composePath), "compose.production.yml must exist");
    const config = renderCompose();
    const expectedServices = [
      "api",
      "migrate",
      "postgres",
      "publisher",
      "redis",
      "scheduler",
      "web",
      "worker",
    ];
    assert.deepEqual(Object.keys(config.services).sort(), expectedServices);
    assert.ok(!("seed" in config.services), "production must not seed automatically");

    for (const [name, service] of Object.entries(config.services)) {
      assert.match(service.image, /@sha256:[a-f0-9]{64}$/i, `${name} must use a digest`);
      assert.ok(!("build" in service), `${name} must not build source on the server`);
      assert.equal(service.pull_policy, "always", `${name} must always verify its digest image`);
    }

    for (const name of ["postgres", "redis", "migrate", "scheduler", "publisher", "worker"]) {
      assert.equal(config.services[name].ports, undefined, `${name} must not publish host ports`);
    }
    for (const name of ["api", "web"]) {
      assert.equal(config.services[name].ports.length, 1);
      assert.equal(config.services[name].ports[0].host_ip, "127.0.0.1");
    }
    assert.equal(config.networks.backend.internal, true);
  });

  it("applies production identity, filesystem, resource, health and log boundaries", () => {
    const config = renderCompose();
    assert.equal(config.services.api.environment.NODE_ENV, "production");
    assert.equal(config.services.api.environment.EXAMFORGE_SESSION_COOKIE_SECURE, "true");
    assert.equal(
      config.services.api.environment.EXAMFORGE_TRUSTED_ORIGINS,
      "https://examforge.site",
    );
    assert.match(config.services.api.environment.DATABASE_URL, /^postgres:\/\//);

    for (const [name, service] of Object.entries(config.services)) {
      assert.notEqual(service.user, undefined, `${name} must declare a non-root user`);
      assert.ok(!String(service.user).startsWith("0"), `${name} must not run as root`);
      assert.equal(service.read_only, true, `${name} must have a read-only root filesystem`);
      assert.equal(service.init, true, `${name} must use an init process`);
      assert.ok(service.pids_limit > 0, `${name} must limit processes`);
      assert.ok(service.mem_limit > 0, `${name} must limit memory`);
      assert.ok(service.cpus > 0, `${name} must limit CPU`);
      assert.ok(service.healthcheck || name === "migrate", `${name} must expose health state`);
      assert.equal(service.logging.driver, "json-file");
      assert.equal(service.logging.options["max-size"], "10m");
      assert.equal(service.logging.options["max-file"], "3");
      assert.ok(service.stop_grace_period, `${name} must define graceful stop timing`);
    }

    assert.ok(config.services.postgres.volumes.some((volume) => (
      volume.type === "bind" && volume.source === "/srv/data/hot/examforge/postgres"
    )));
    assert.ok(config.services.redis.volumes.some((volume) => (
      volume.type === "bind" && volume.source === "/srv/data/hot/examforge/redis"
    )));
    assert.equal(config.services.postgres.user, "70:70");
    assert.equal(config.services.redis.user, "999:1000");
    assert.equal(config.services.api.depends_on.migrate.condition, "service_completed_successfully");
    for (const name of ["publisher", "worker"]) {
      assert.equal(config.services[name].environment.SCHEDULE_JOB_MAX_ATTEMPTS, "6");
      assert.equal(config.services[name].environment.SCHEDULE_JOB_RETRY_BASE_DELAY_MS, "1000");
    }
  });
});

describe("production environment and preflight", () => {
  it("documents every required variable without usable credentials", () => {
    assert.ok(existsSync(exampleEnvPath), ".env.production.example must exist");
    const example = readFileSync(exampleEnvPath, "utf8");
    for (const name of [
      "EXAMFORGE_API_IMAGE",
      "EXAMFORGE_WEB_IMAGE",
      "EXAMFORGE_WORKER_IMAGE",
      "EXAMFORGE_SCHEDULER_IMAGE",
      "EXAMFORGE_PUBLIC_ORIGIN",
      "EXAMFORGE_DATA_DIR",
      "EXAMFORGE_BACKUP_DIR",
      "EXAMFORGE_OFFSITE_BACKUP_DIR",
      "EXAMFORGE_BACKUP_RETENTION_DAYS",
      "EXAMFORGE_MAX_BACKUP_AGE_SECONDS",
      "EXAMFORGE_MIN_FREE_KIB",
      "EXAMFORGE_CERTIFICATE_WARNING_DAYS",
      "EXAMFORGE_TLS_CERTIFICATE_PATH",
      "POSTGRES_PASSWORD",
      "EXAMFORGE_ADMIN_PASSWORD",
      "EXAMFORGE_OPERATOR_PASSWORD",
      "EXAMFORGE_TEACHER_PASSWORD",
      "EXAMFORGE_STUDENT_PASSWORD",
      "SCHEDULE_JOB_MAX_ATTEMPTS",
      "SCHEDULE_JOB_RETRY_BASE_DELAY_MS",
    ]) {
      assert.match(example, new RegExp(`^${name}=`, "m"), `${name} must be documented`);
    }
    assert.doesNotMatch(example, /100036497464|test-only|examforge-local-only/);
  });

  it("rejects permissive environment files before any runtime checks", () => {
    assert.ok(existsSync(preflightPath), "preflight.sh must exist");
    const directory = mkdtempSync(join(tmpdir(), "examforge-preflight-"));
    const envPath = join(directory, ".env.production");
    copyFileSync(exampleEnvPath, envPath);
    chmodSync(envPath, 0o644);

    const result = spawnSync("bash", [
      preflightPath,
      "--env-file",
      envPath,
      "--validate-env-only",
    ], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /mode 600/);
  });

  it("rejects placeholders and accepts a complete owner-only environment file", () => {
    const directory = mkdtempSync(join(tmpdir(), "examforge-preflight-"));
    const envPath = join(directory, ".env.production");
    copyFileSync(exampleEnvPath, envPath);
    chmodSync(envPath, 0o600);

    const placeholderResult = runPreflight(envPath);
    assert.notEqual(placeholderResult.status, 0);
    assert.match(`${placeholderResult.stdout}${placeholderResult.stderr}`, /immutable sha256 digest/);

    const names = [
      "EXAMFORGE_API_IMAGE",
      "EXAMFORGE_WEB_IMAGE",
      "EXAMFORGE_WORKER_IMAGE",
      "EXAMFORGE_SCHEDULER_IMAGE",
      "EXAMFORGE_POSTGRES_IMAGE",
      "EXAMFORGE_REDIS_IMAGE",
      "EXAMFORGE_PUBLIC_ORIGIN",
      "EXAMFORGE_TRUSTED_ORIGINS",
      "EXAMFORGE_API_PORT",
      "EXAMFORGE_WEB_PORT",
      "EXAMFORGE_DATA_DIR",
      "EXAMFORGE_BACKUP_DIR",
      "EXAMFORGE_OFFSITE_BACKUP_DIR",
      "EXAMFORGE_BACKUP_RETENTION_DAYS",
      "EXAMFORGE_MAX_BACKUP_AGE_SECONDS",
      "EXAMFORGE_MIN_FREE_KIB",
      "EXAMFORGE_CERTIFICATE_WARNING_DAYS",
      "EXAMFORGE_TLS_CERTIFICATE_PATH",
      "POSTGRES_USER",
      "POSTGRES_PASSWORD",
      "POSTGRES_DB",
      "EXAMFORGE_ADMIN_PASSWORD",
      "EXAMFORGE_OPERATOR_PASSWORD",
      "EXAMFORGE_TEACHER_PASSWORD",
      "EXAMFORGE_STUDENT_PASSWORD",
      "EXAMFORGE_SESSION_COOKIE_SECURE",
      "EXAMFORGE_SESSION_TTL_SECONDS",
      "SCHEDULE_JOB_MAX_ATTEMPTS",
      "SCHEDULE_JOB_RETRY_BASE_DELAY_MS",
    ];
    writeFileSync(
      envPath,
      `${names.map((name) => `${name}=${productionEnvironment[name]}`).join("\n")}\n`,
      { mode: 0o600 },
    );

    const validResult = runPreflight(envPath);
    assert.equal(validResult.status, 0, validResult.stderr);
    assert.match(validResult.stdout, /validation passed/);

    const invalidEnvironment = {
      ...productionEnvironment,
      SCHEDULE_JOB_RETRY_BASE_DELAY_MS: "2000",
    };
    writeFileSync(
      envPath,
      `${names.map((name) => `${name}=${invalidEnvironment[name]}`).join("\n")}\n`,
      { mode: 0o600 },
    );
    const invalidResult = runPreflight(envPath);
    assert.notEqual(invalidResult.status, 0);
    assert.match(
      `${invalidResult.stdout}${invalidResult.stderr}`,
      /final retry delay must not exceed 30000 ms/,
    );

    const excessiveAttemptsEnvironment = {
      ...productionEnvironment,
      SCHEDULE_JOB_MAX_ATTEMPTS: "11",
      SCHEDULE_JOB_RETRY_BASE_DELAY_MS: "1",
    };
    writeFileSync(
      envPath,
      `${names.map((name) => `${name}=${excessiveAttemptsEnvironment[name]}`).join("\n")}\n`,
      { mode: 0o600 },
    );
    const excessiveAttemptsResult = runPreflight(envPath);
    assert.notEqual(excessiveAttemptsResult.status, 0);
    assert.match(
      `${excessiveAttemptsResult.stdout}${excessiveAttemptsResult.stderr}`,
      /SCHEDULE_JOB_MAX_ATTEMPTS must be an integer between 2 and 10/,
    );
  });
});

function renderCompose() {
  const output = execFileSync("docker", [
    "compose",
    "-f",
    composePath,
    "config",
    "--format",
    "json",
  ], {
    cwd: repositoryRoot,
    env: productionEnvironment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function runPreflight(envPath) {
  return spawnSync("bash", [
    preflightPath,
    "--env-file",
    envPath,
    "--validate-env-only",
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}
