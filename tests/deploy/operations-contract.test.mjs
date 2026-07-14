import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const paths = {
  backup: join(repositoryRoot, "scripts/deploy/backup-postgres.sh"),
  restore: join(repositoryRoot, "scripts/deploy/restore-postgres.sh"),
  health: join(repositoryRoot, "scripts/deploy/health-check.sh"),
  healthService: join(repositoryRoot, "deploy/systemd/examforge-health.service"),
  healthTimer: join(repositoryRoot, "deploy/systemd/examforge-health.timer"),
  nginxLogrotate: join(repositoryRoot, "deploy/logrotate/examforge-nginx"),
};

describe("production operations contract", () => {
  it("ships executable backup, restore and health scripts with strict shell syntax", () => {
    for (const [name, path] of Object.entries({
      backup: paths.backup,
      restore: paths.restore,
      health: paths.health,
    })) {
      assert.ok(existsSync(path), `${name} script must exist`);
      assert.ok((statSync(path).mode & 0o111) !== 0, `${name} script must be executable`);
      execFileSync("bash", ["-n", path], { cwd: repositoryRoot });
    }
  });

  it("makes a backup atomic across local and offsite storage", () => {
    const source = readFileSync(paths.backup, "utf8");
    assert.match(source, /pg_dump/);
    assert.match(source, /--format=custom/);
    assert.match(source, /schema_migrations/);
    assert.match(source, /sha256sum/);
    assert.match(source, /EXAMFORGE_OFFSITE_BACKUP_DIR/);
    assert.match(source, /backup_offsite_copy_failed/);
    assert.match(source, /EXAMFORGE_BACKUP_RETENTION_DAYS/);
    assert.match(source, /\.staging-/);
  });

  it("restores only into a server-marked disposable database and validates business facts", () => {
    const source = readFileSync(paths.restore, "utf8");
    assert.match(source, /--confirm-disposable/);
    assert.match(source, /examforge\.disposable=true/);
    assert.match(source, /pg_restore/);
    assert.match(source, /migration-check\.js/);
    assert.match(source, /user_teacher_scopes/);
    assert.match(source, /user_student_group_scopes/);
    assert.match(source, /published_run_id/);
    assert.match(source, /schedule_job_events/);
    assert.match(source, /audit_events/);
    assert.match(source, /restore_summary_mismatch/);
  });

  it("installs a hardened recurring health check and bounded nginx logs", () => {
    for (const path of [paths.healthService, paths.healthTimer, paths.nginxLogrotate]) {
      assert.ok(existsSync(path), `${path} must exist`);
    }
    const service = readFileSync(paths.healthService, "utf8");
    assert.match(service, /^User=examforge$/m);
    assert.match(service, /^NoNewPrivileges=true$/m);
    assert.match(service, /^ProtectSystem=strict$/m);
    assert.match(service, /health-check\.sh/);

    const timer = readFileSync(paths.healthTimer, "utf8");
    assert.match(timer, /^OnUnitActiveSec=5min$/m);
    assert.match(timer, /^Persistent=true$/m);

    const logrotate = readFileSync(paths.nginxLogrotate, "utf8");
    assert.match(logrotate, /examforge\.access\.log/);
    assert.match(logrotate, /examforge\.error\.log/);
    assert.match(logrotate, /rotate 14/);
    assert.match(logrotate, /compress/);
    assert.match(logrotate, /nginx/);
  });
});
