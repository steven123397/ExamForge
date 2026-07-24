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
  backupService: join(repositoryRoot, "deploy/systemd/examforge-backup.service"),
  backupTimer: join(repositoryRoot, "deploy/systemd/examforge-backup.timer"),
  healthService: join(repositoryRoot, "deploy/systemd/examforge-health.service"),
  healthTimer: join(repositoryRoot, "deploy/systemd/examforge-health.timer"),
  nginxSiteTemplate: join(repositoryRoot, "deploy/nginx/examforge.conf.template"),
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

  it("runs hardened recurring operations from the stable deployment directory", () => {
    for (const path of [
      paths.backupService,
      paths.backupTimer,
      paths.healthService,
      paths.healthTimer,
      paths.nginxLogrotate,
    ]) {
      assert.ok(existsSync(path), `${path} must exist`);
    }
    for (const [name, path] of Object.entries({
      backup: paths.backupService,
      health: paths.healthService,
    })) {
      const service = readFileSync(path, "utf8");
      assert.match(service, /^User=examforge$/m);
      assert.match(service, /^NoNewPrivileges=true$/m);
      assert.match(service, /^ProtectSystem=strict$/m);
      assert.match(service, /^WorkingDirectory=\/srv\/apps\/examforge$/m);
      assert.match(service, new RegExp(`^ExecStart=/srv/apps/examforge/scripts/deploy/${name === "backup" ? "backup-postgres" : "health-check"}\\.sh `, "m"));
      assert.doesNotMatch(service, /\/srv\/apps\/examforge\/current\//);
    }

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

  it("ships an isolated nginx site template for the production domain", () => {
    assert.ok(existsSync(paths.nginxSiteTemplate), "ExamForge nginx site template must exist");
    const template = readFileSync(paths.nginxSiteTemplate, "utf8");

    assert.match(
      template,
      /server \{\n\s+listen 80;\n\s+server_name examforge\.site www\.examforge\.site;[\s\S]*?return 301 https:\/\/examforge\.site\$request_uri;/,
    );
    assert.match(
      template,
      /server \{\n\s+listen 443 ssl http2;\n\s+server_name examforge\.site;/,
    );
    assert.match(
      template,
      /server \{\n\s+listen 443 ssl http2;\n\s+server_name www\.examforge\.site;[\s\S]*?return 301 https:\/\/examforge\.site\$request_uri;/,
    );
    const wwwHttpsServer = template.match(
      /server \{\n\s+listen 443 ssl http2;\n\s+server_name www\.examforge\.site;[\s\S]*?\n\}/,
    )?.[0];
    assert.ok(wwwHttpsServer, "www HTTPS server must exist");
    assert.doesNotMatch(wwwHttpsServer, /proxy_pass/);
    assert.match(template, /listen\s+443\s+ssl\s+http2;/);
    assert.match(template, /ssl_certificate\s+\/etc\/letsencrypt\/live\/examforge\.site\/fullchain\.pem;/);
    assert.match(template, /ssl_certificate_key\s+\/etc\/letsencrypt\/live\/examforge\.site\/privkey\.pem;/);
    assert.match(template, /access_log\s+\/var\/log\/nginx\/examforge\.access\.log/);
    assert.match(template, /error_log\s+\/var\/log\/nginx\/examforge\.error\.log/);
    assert.match(template, /location\s+\/api\//);
    assert.match(template, /location\s+~\s+\^\/api\/schedule-jobs\/\[\^\/\]\+\/events\$/);
    assert.match(template, /proxy_buffering\s+off;/);
    assert.match(template, /proxy_read_timeout\s+3600s;/);
    assert.match(template, /proxy_pass\s+http:\/\/127\.0\.0\.1:4000;/);
    assert.match(template, /proxy_pass\s+http:\/\/127\.0\.0\.1:3000;/);
    assert.match(template, /proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;/);
    assert.match(template, /proxy_set_header\s+X-Forwarded-Proto\s+https;/);
    assert.match(template, /add_header\s+X-Frame-Options\s+"DENY"\s+always;/);
    assert.match(template, /add_header\s+X-Content-Type-Options\s+"nosniff"\s+always;/);
    assert.doesNotMatch(template, /default_server/);
    assert.doesNotMatch(template, /sites-enabled\/default/);
  });
});
