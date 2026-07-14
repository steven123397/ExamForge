import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const healthCheckPath = join(repositoryRoot, "scripts/deploy/health-check.sh");
const secretValue = "health-test-secret-must-not-appear";

describe("production health fault categories", () => {
  it("rejects an expired backup without exposing environment secrets", () => {
    const fixture = createFixture();
    const dumpPath = join(fixture.backupDir, "examforge-test.dump");
    const summaryPath = join(fixture.backupDir, "examforge-test.summary");
    const metaPath = join(fixture.backupDir, "examforge-test.meta");
    writeFileSync(dumpPath, "test-backup\n");
    writeFileSync(summaryPath, "schema_migration_count=15\n");
    const dumpSha = sha256(dumpPath);
    const summarySha = sha256(summaryPath);
    writeFileSync(metaPath, [
      "schema_version=1",
      "backup_id=examforge-test",
      "database=examforge",
      "created_at=2026-01-01T00:00:00Z",
      "format=postgresql-custom",
      "migration_version=0014_user_audience_scopes",
      "dump_file=examforge-test.dump",
      `sha256=${dumpSha}`,
      "size_bytes=12",
      "summary_file=examforge-test.summary",
      `summary_sha256=${summarySha}`,
      "offsite_status=copied",
      "retention_days=14",
      "",
    ].join("\n"));

    const result = runHealth(fixture, [
      "--only",
      "backup",
      "--now-epoch",
      "1784073600",
      "--max-backup-age-seconds",
      "3600",
    ]);
    assertFailure(result, /category=backup_stale component=postgres_backup/);
  });

  it("rejects a breached disk threshold", () => {
    const fixture = createFixture();
    const result = runHealth(fixture, [
      "--only",
      "disk",
      "--min-free-kib",
      "999999999999",
    ]);
    assertFailure(result, /category=disk_space_low component=data_disk/);
  });

  it("rejects a certificate inside the warning window", () => {
    const fixture = createFixture();
    execFileSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=examforge.site",
      "-keyout",
      join(fixture.directory, "tls.key"),
      "-out",
      fixture.certificatePath,
    ], { stdio: "ignore" });
    const result = runHealth(fixture, [
      "--only",
      "certificate",
      "--certificate-warning-days",
      "30",
    ]);
    assertFailure(result, /category=certificate_expiring component=tls/);
  });

  it("reports API readiness failure without printing credentials", () => {
    const fixture = createFixture();
    const binDir = join(fixture.directory, "bin");
    mkdirSync(binDir);
    const dockerStub = join(binDir, "docker");
    const curlStub = join(binDir, "curl");
    writeFileSync(dockerStub, `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "\${1:-}" == "compose" && " $* " == *" ps -q "* ]]; then
  printf 'fixture-%s\\n' "\${!#}"
  exit 0
fi
if [[ "\${1:-}" == "compose" && " $* " == *" exec -T "* ]]; then
  exit 0
fi
if [[ "\${1:-}" == "inspect" && " $* " == *"State.Status"* ]]; then
  printf 'running\\n'
  exit 0
fi
if [[ "\${1:-}" == "inspect" ]]; then
  printf 'healthy\\n'
  exit 0
fi
exit 1
`);
    writeFileSync(curlStub, "#!/usr/bin/env bash\nexit 22\n");
    chmodSync(dockerStub, 0o755);
    chmodSync(curlStub, 0o755);

    const result = runHealth(fixture, ["--only", "runtime"], {
      PATH: `${binDir}:${process.env.PATH}`,
    });
    assertFailure(result, /category=readiness_failed component=api/);
  });
});

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "examforge-health-"));
  const dataDir = join(directory, "data");
  const backupDir = join(directory, "backups");
  const offsiteDir = join(directory, "offsite");
  mkdirSync(dataDir);
  mkdirSync(backupDir);
  mkdirSync(offsiteDir);
  const certificatePath = join(directory, "fullchain.pem");
  const envPath = join(directory, ".env.production");
  writeFileSync(envPath, [
    "COMPOSE_PROJECT_NAME=examforge-health-test",
    "EXAMFORGE_PUBLIC_ORIGIN=https://examforge.site",
    `EXAMFORGE_DATA_DIR=${dataDir}`,
    `EXAMFORGE_BACKUP_DIR=${backupDir}`,
    `EXAMFORGE_OFFSITE_BACKUP_DIR=${offsiteDir}`,
    `EXAMFORGE_TLS_CERTIFICATE_PATH=${certificatePath}`,
    "EXAMFORGE_API_PORT=4000",
    "POSTGRES_USER=examforge",
    `POSTGRES_PASSWORD=${secretValue}`,
    "POSTGRES_DB=examforge",
    "",
  ].join("\n"), { mode: 0o600 });
  return {
    directory,
    dataDir,
    backupDir,
    offsiteDir,
    certificatePath,
    envPath,
  };
}

function runHealth(fixture, args, extraEnvironment = {}) {
  return spawnSync("bash", [
    healthCheckPath,
    "--env-file",
    fixture.envPath,
    "--compose-file",
    join(repositoryRoot, "compose.production.yml"),
    ...args,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...extraEnvironment },
  });
}

function assertFailure(result, pattern) {
  const output = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0, output);
  assert.match(output, pattern);
  assert.doesNotMatch(output, new RegExp(secretValue));
}

function sha256(path) {
  return execFileSync("sha256sum", [path], { encoding: "utf8" }).split(/\s+/)[0];
}
