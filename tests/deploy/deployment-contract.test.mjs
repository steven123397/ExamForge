import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const paths = {
  applyEnvironment: join(repositoryRoot, "scripts/deploy/apply-release-env.mjs"),
  bootstrap: join(repositoryRoot, "scripts/deploy/bootstrap-demo.sh"),
  ciWorkflow: join(repositoryRoot, ".github/workflows/ci.yml"),
  releaseWorkflow: join(repositoryRoot, ".github/workflows/release-images.yml"),
  deploy: join(repositoryRoot, "scripts/deploy/deploy.sh"),
  rollback: join(repositoryRoot, "scripts/deploy/rollback.sh"),
  onlineSmoke: join(repositoryRoot, "scripts/deploy/online-smoke.mjs"),
  onlineSmokeRunner: join(repositoryRoot, "scripts/deploy/run-online-smoke.sh"),
  releaseManifestLibrary: join(repositoryRoot, "scripts/release/release-manifest-lib.mjs"),
  apiDockerfile: join(repositoryRoot, "apps/api/Dockerfile"),
};
const commitSha = "a".repeat(40);

describe("production deployment contract", () => {
  it("ships explicit deploy, rollback, bootstrap and online smoke entrypoints", () => {
    for (const [name, path] of Object.entries(paths)) {
      assert.ok(existsSync(path), `${name} entrypoint must exist`);
      if (path.endsWith(".sh")) {
        assert.ok((statSync(path).mode & 0o111) !== 0, `${name} must be executable`);
      }
    }
  });

  it("runs production online smoke with the released Node 22 runtime without a Docker socket helper", () => {
    const runner = readFileSync(paths.onlineSmokeRunner, "utf8");
    const apiDockerfile = readFileSync(paths.apiDockerfile, "utf8");

    assert.match(apiDockerfile, /^FROM node:22\.22\.2-bookworm-slim AS runtime$/m);
    assert.match(runner, /operations_load_env_file "\$env_file"/);
    assert.match(runner, /EXAMFORGE_API_IMAGE/);
    assert.match(runner, /docker image inspect "\$EXAMFORGE_API_IMAGE"/);
    assert.match(runner, /docker create --pull=never/);
    assert.match(runner, /\/usr\/local\/bin\/node/);
    assert.match(runner, /--env-file="\$runtime_env"/);
    assert.match(runner, /ONLINE_API_BASE_URL=http:\/\/127\.0\.0\.1:/);
    assert.match(runner, /ONLINE_WEB_BASE_URL=http:\/\/127\.0\.0\.1:/);
    assert.match(runner, /ONLINE_COMPOSE_FILE=%s/);
    assert.match(runner, /ONLINE_COMPOSE_ENV_FILE=%s/);
    assert.match(runner, /ONLINE_RUN_FAULT_DRILLS/);
    assert.match(runner, /--skip-fault-drills/);
    assert.match(runner, /chmod 600 "\$runtime_env"/);
    assert.match(runner, /trap cleanup EXIT/);
    assert.doesNotMatch(runner, /docker run/);
    assert.doesNotMatch(runner, /\/var\/run\/docker\.sock/);
    assert.doesNotMatch(runner, /--privileged/);
  });

  it("deploys only a verified release and preserves current/previous state", () => {
    const source = readFileSync(paths.deploy, "utf8");
    assert.match(source, /verify-release\.mjs/);
    assert.match(source, /apply-release-env\.mjs/);
    assert.match(source, /compose.*pull/s);
    assert.match(source, /compose.*run.*migrate/s);
    assert.match(source, /health-check\.sh.*--only.*runtime/s);
    assert.match(source, /current/);
    assert.match(source, /previous/);
    assert.match(source, /deployment_failed_rollback/);
    assert.doesNotMatch(source, /docker compose[^\n]*build/);
  });

  it("keeps the host-side release verifier compatible with the server parser", () => {
    const source = readFileSync(paths.releaseManifestLibrary, "utf8");
    const deploySource = readFileSync(paths.deploy, "utf8");

    assert.doesNotMatch(source, /\?\?/);
    assert.doesNotMatch(source, /\?\./);
    assert.doesNotMatch(deploySource, /require\(["']node:/);
  });

  it("rolls back through the previous verified manifest", () => {
    const source = readFileSync(paths.rollback, "utf8");
    assert.match(source, /previous\/release-manifest\.json/);
    assert.match(source, /deploy\.sh/);
    assert.match(source, /rollback_previous_missing/);
  });

  it("keeps bootstrap explicit and online smoke covers roles, workflows and faults", () => {
    const bootstrap = readFileSync(paths.bootstrap, "utf8");
    assert.match(bootstrap, /--confirm-empty-database/);
    assert.match(bootstrap, /exam_batches/);
    assert.match(bootstrap, /seed\.js/);
    assert.match(bootstrap, /audit_events/);

    const smoke = readFileSync(paths.onlineSmoke, "utf8");
    for (const role of ["admin", "operator", "teacher", "student"]) {
      assert.match(smoke, new RegExp(`login\\(\"${role}\"`));
    }
    for (const endpoint of [
      "/api/me/audience",
      "/api/schedule-jobs",
      "/events",
      "/api/constraint-profiles",
      "/drafts",
      "/publish",
      "/api/audit-events",
      "/api/me/published-schedule",
    ]) {
      assert.ok(smoke.includes(endpoint), `online smoke must cover ${endpoint}`);
    }
    for (const service of ["api", "redis", "publisher", "worker", "scheduler"]) {
      assert.ok(smoke.includes(`\"${service}\"`), `online smoke must drill ${service}`);
    }
    assert.match(smoke, /last-event-id/);
    assert.match(smoke, /sseReconnect/);
    assert.doesNotMatch(smoke, /console\.(log|error).*password/i);
  });

  it("rebuilds local production test images from the current checkout", () => {
    const localProduction = readFileSync(
      join(repositoryRoot, "tests/deploy/local-production.test.sh"),
      "utf8",
    );
    assert.doesNotMatch(
      localProduction,
      /if docker image inspect "\$tag" >\/dev\/null 2>&1; then/,
      "local production validation must not reuse a fixed tag from an older checkout",
    );
    assert.match(localProduction, /docker "\$\{arguments\[@\]\}"/);
  });

  it("accepts OCI image indexes when recording local release digests", () => {
    const localProduction = readFileSync(
      join(repositoryRoot, "tests/deploy/local-production.test.sh"),
      "utf8",
    );
    assert.match(localProduction, /application\/vnd\.docker\.distribution\.manifest\.list\.v2\+json/);
    assert.match(localProduction, /application\/vnd\.oci\.image\.index\.v1\+json/);
  });

  it("isolates local production smoke from an inherited Compose project", () => {
    const localProduction = readFileSync(
      join(repositoryRoot, "tests/deploy/local-production.test.sh"),
      "utf8",
    );
    const overrides = localProduction.match(
      /COMPOSE_PROJECT_NAME="\$project_name" \\\n+"\$repository_root\/scripts\/deploy\/run-online-smoke\.sh"/g,
    ) ?? [];
    assert.equal(overrides.length, 3);
    assert.equal((localProduction.match(/--skip-fault-drills/g) ?? []).length, 2);
  });

  it("runs CI for branch pushes without applying branch range checks to tags", () => {
    const ciWorkflow = readFileSync(paths.ciWorkflow, "utf8");
    assert.match(ciWorkflow, /^  push:\n    branches:\n      - "\*\*"$/m);
  });

  it("keeps the quality audit artifact reachable when only the release job is rerun", () => {
    const workflow = readFileSync(paths.releaseWorkflow, "utf8");
    const artifactReferences = workflow.match(
      /name: release-audit-\$\{\{ github\.run_id \}\}(?:\r?\n|$)/g,
    ) ?? [];
    const qualityAuditUpload = workflow.match(
      /- name: 上传生产依赖审计[\s\S]*?(?=\n\n  release:)/,
    )?.[0] ?? "";

    assert.equal(artifactReferences.length, 3);
    assert.match(qualityAuditUpload, /overwrite: true/);
    assert.doesNotMatch(
      workflow,
      /name: release-audit-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
    );
  });
});

describe("release environment assembler", () => {
  it("preserves secrets while replacing only immutable application image references", () => {
    const fixture = createFixture();
    const result = spawnSync("node", [
      paths.applyEnvironment,
      "--env-file",
      fixture.envPath,
      "--manifest",
      fixture.manifestPath,
      "--output",
      fixture.outputPath,
    ], { cwd: repositoryRoot, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const output = readFileSync(fixture.outputPath, "utf8");
    assert.match(output, /^POSTGRES_PASSWORD=preserve-this-secret$/m);
    assert.match(output, new RegExp(`^EXAMFORGE_API_IMAGE=127\\.0\\.0\\.1:5000/examforge/api@sha256:${"1".repeat(64)}$`, "m"));
    assert.match(output, new RegExp(`^EXAMFORGE_WEB_IMAGE=127\\.0\\.0\\.1:5000/examforge/web@sha256:${"3".repeat(64)}$`, "m"));
    assert.doesNotMatch(output, /old-[a-z]+@sha256/);
    assert.equal(statSync(fixture.outputPath).mode & 0o777, 0o600);
  });

  it("rejects a release built for a different public origin", () => {
    const fixture = createFixture();
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
    manifest.publicOrigin = "https://other.example.com";
    writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest)}\n`);
    const result = spawnSync("node", [
      paths.applyEnvironment,
      "--env-file",
      fixture.envPath,
      "--manifest",
      fixture.manifestPath,
      "--output",
      fixture.outputPath,
    ], { cwd: repositoryRoot, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /public origin/i);
    assert.ok(!existsSync(fixture.outputPath));
  });
});

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "examforge-deploy-"));
  const envPath = join(directory, ".env.production");
  const manifestPath = join(directory, "release-manifest.json");
  const outputPath = join(directory, ".env.next");
  const oldDigest = "f".repeat(64);
  writeFileSync(envPath, [
    "EXAMFORGE_PUBLIC_ORIGIN=https://examforge.site",
    `EXAMFORGE_API_IMAGE=registry.example.com/examforge/old-api@sha256:${oldDigest}`,
    `EXAMFORGE_WEB_IMAGE=registry.example.com/examforge/old-web@sha256:${oldDigest}`,
    `EXAMFORGE_WORKER_IMAGE=registry.example.com/examforge/old-worker@sha256:${oldDigest}`,
    `EXAMFORGE_SCHEDULER_IMAGE=registry.example.com/examforge/old-scheduler@sha256:${oldDigest}`,
    "POSTGRES_PASSWORD=preserve-this-secret",
    "",
  ].join("\n"), { mode: 0o600 });
  chmodSync(envPath, 0o600);
  writeFileSync(manifestPath, `${JSON.stringify(createManifest(), null, 2)}\n`);
  return { directory, envPath, manifestPath, outputPath };
}

function createManifest() {
  const images = {};
  const definitions = [
    ["api", "1", "apps/api/Dockerfile"],
    ["scheduler", "2", "apps/scheduler/Dockerfile"],
    ["web", "3", "apps/web/Dockerfile"],
    ["worker", "4", "apps/worker/Dockerfile"],
  ];
  for (const [name, digit, dockerfile] of definitions) {
    const digest = `sha256:${digit.repeat(64)}`;
    const repository = `127.0.0.1:5000/examforge/${name}`;
    images[name] = {
      repository,
      tag: commitSha,
      digest,
      reference: `${repository}@${digest}`,
      dockerfile,
      sourceRevision: commitSha,
      sourceUrl: "https://github.com/example/ExamForge",
      buildPlatform: "linux/amd64",
      sbom: {
        format: "spdx-json",
        tool: "syft",
        version: "1.44.0",
        path: `images/${name}/sbom.spdx.json`,
        sha256: `sha256:${"a".repeat(64)}`,
      },
      vulnerabilityScan: {
        tool: "trivy",
        version: "0.72.0",
        result: "passed",
        path: `images/${name}/trivy.json`,
        sha256: `sha256:${"b".repeat(64)}`,
      },
    };
  }
  return {
    schemaVersion: 1,
    commitSha,
    createdAt: "2026-07-14T00:00:00.000Z",
    sourceUrl: "https://github.com/example/ExamForge",
    publicOrigin: "https://examforge.site",
    buildPlatform: "linux/amd64",
    dependencyAudit: {
      tool: "npm",
      version: "12.0.1",
      level: "moderate",
      productionOnly: true,
      result: "passed",
      vulnerabilities: 0,
      path: "audit/npm-audit.json",
      sha256: `sha256:${"c".repeat(64)}`,
    },
    images,
  };
}
