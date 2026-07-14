import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const verifierPath = join(repositoryRoot, "scripts/release/verify-release.mjs");
const creatorPath = join(repositoryRoot, "scripts/release/create-release-manifest.mjs");
const workflowPath = join(repositoryRoot, ".github/workflows/release-images.yml");
const probeImagePath = join(repositoryRoot, "scripts/release/probe-image.sh");
const pushImagePath = join(repositoryRoot, "scripts/release/push-image.sh");
const configureBuildxPath = join(repositoryRoot, "scripts/release/configure-buildx.sh");
const commitSha = "1".repeat(40);
const imageDigest = `sha256:${"2".repeat(64)}`;
const sourceUrl = "https://github.com/steven123397/ExamForge";
const imageNames = ["api", "scheduler", "web", "worker"];
const dockerfiles = {
  api: "apps/api/Dockerfile",
  scheduler: "apps/scheduler/Dockerfile",
  web: "apps/web/Dockerfile",
  worker: "apps/worker/Dockerfile",
};

describe("release manifest verifier", () => {
  it("accepts a complete digest-only manifest and verifies every attached report", () => {
    const fixture = createReleaseFixture();
    const result = verify(fixture.manifestPath, "--verify-files", "--expected-commit", commitSha);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Release manifest verification passed/);
  });

  it("rejects commit mismatch, mutable tags and an incomplete image set", () => {
    for (const mutate of [
      (manifest) => { manifest.commitSha = "3".repeat(40); },
      (manifest) => { manifest.images.api.tag = "latest"; },
      (manifest) => { delete manifest.images.worker; },
      (manifest) => { manifest.images.extra = structuredClone(manifest.images.api); },
    ]) {
      const fixture = createReleaseFixture(mutate);
      const result = verify(fixture.manifestPath, "--expected-commit", commitSha);
      assert.notEqual(result.status, 0);
    }
  });

  it("rejects failed audit/scan results, unsafe paths and report checksum tampering", () => {
    const mutations = [
      (manifest) => { manifest.dependencyAudit.vulnerabilities = 1; },
      (manifest) => { manifest.images.api.vulnerabilityScan.result = "failed"; },
      (manifest) => { manifest.images.api.sbom.path = "../sbom.json"; },
      (manifest) => { manifest.images.api.reference = "example.invalid/api@" + imageDigest; },
    ];
    for (const mutate of mutations) {
      const fixture = createReleaseFixture(mutate);
      const result = verify(fixture.manifestPath, "--verify-files");
      assert.notEqual(result.status, 0);
    }

    const fixture = createReleaseFixture();
    writeFileSync(join(fixture.directory, "images/api/sbom.spdx.json"), "tampered\n");
    const result = verify(fixture.manifestPath, "--verify-files");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum/i);
  });

  it("does not permit secret-like fields anywhere in the deployment artifact", () => {
    const fixture = createReleaseFixture((manifest) => {
      manifest.registryPassword = "must-not-appear";
    });
    const result = verify(fixture.manifestPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /secret-like field/i);
  });
});

describe("release manifest creator", () => {
  it("creates byte-identical source metadata for repeated assembly of one commit", () => {
    const fixture = createReleaseFixture();
    const inputDirectory = join(fixture.directory, "images");
    for (const name of imageNames) {
      const image = fixture.manifest.images[name];
      writeJson(join(inputDirectory, name, "fragment.json"), {
        name,
        repository: image.repository,
        tag: image.tag,
        digest: image.digest,
        dockerfile: image.dockerfile,
        sourceRevision: image.sourceRevision,
        sourceUrl: image.sourceUrl,
        buildPlatform: image.buildPlatform,
        sbom: {
          format: image.sbom.format,
          tool: image.sbom.tool,
          version: image.sbom.version,
          file: "sbom.spdx.json",
        },
        vulnerabilityScan: {
          tool: image.vulnerabilityScan.tool,
          version: image.vulnerabilityScan.version,
          result: image.vulnerabilityScan.result,
          file: "trivy.json",
        },
      });
    }

    const first = join(fixture.directory, "first.json");
    const second = join(fixture.directory, "second.json");
    for (const output of [first, second]) {
      const result = createManifest(fixture.directory, output);
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(readFileSync(first, "utf8"), readFileSync(second, "utf8"));
    assert.equal(verify(first, "--verify-files").status, 0);
  });
});

describe("release workflow boundary", () => {
  it("is manual, SHA-pinned, scans before registry login and never publishes latest", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    assert.match(workflow, /^\s*workflow_dispatch:/m);
    assert.match(workflow, /confirm_publish/);
    assert.match(workflow, /TCR_REGISTRY/);
    assert.match(workflow, /TCR_NAMESPACE/);
    assert.match(workflow, /TCR_USERNAME/);
    assert.match(workflow, /secrets\.TCR_PASSWORD/);
    assert.doesNotMatch(workflow, /:[ \t]*latest\b/);

    const actionReferences = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
    assert.ok(actionReferences.length >= 5);
    for (const reference of actionReferences) {
      assert.match(reference, /@[a-f0-9]{40}$/, `${reference} must be pinned to a commit`);
    }

    const scanPosition = workflow.indexOf("扫描 HIGH/CRITICAL 漏洞");
    const loginPosition = workflow.indexOf("登录 TCR");
    const pushPosition = workflow.indexOf("推送通过门禁的镜像");
    assert.ok(scanPosition > 0 && scanPosition < loginPosition);
    assert.ok(loginPosition < pushPosition);
    assert.match(workflow, /NEXT_PUBLIC_API_BASE_URL/);
    assert.match(workflow, /linux\/amd64/);
  });

  it("keeps quality on GitHub hosting and targets release only to the dedicated runner", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    const qualityJob = extractWorkflowJob(workflow, "quality", "release");
    const releaseJob = extractWorkflowJob(workflow, "release");

    assert.match(qualityJob, /runs-on:\s*ubuntu-24\.04/);
    assert.doesNotMatch(qualityJob, /TCR_(?:REGISTRY|NAMESPACE|USERNAME|PASSWORD)/);
    assert.doesNotMatch(qualityJob, /docker\/(?:login|setup-buildx)-action|docker buildx build/);
    assert.match(releaseJob, /runs-on:\s*\[self-hosted, linux, x64, examforge-release\]/);
    assert.doesNotMatch(releaseJob, /runs-on:\s*ubuntu-/);
    assert.match(releaseJob, /timeout-minutes:\s*120/);
    assert.doesNotMatch(releaseJob, /^\s+install:\s*true/m);
  });

  it("checks out the exact release SHA before the self-hosted runner builds", () => {
    const releaseJob = extractWorkflowJob(readFileSync(workflowPath, "utf8"), "release");

    assert.match(releaseJob, /ref:\s*\$\{\{\s*github\.sha\s*\}\}/);
    assert.match(releaseJob, /persist-credentials:\s*false/);
    assert.match(releaseJob, /git rev-parse HEAD/);
    assert.match(releaseJob, /GITHUB_SHA/);
    assert.ok(releaseJob.indexOf("git rev-parse HEAD") < releaseJob.indexOf("docker buildx build"));
  });

  it("limits and records each image push with one retry and remote digest verification", () => {
    assert.ok(existsSync(pushImagePath), "push-image.sh must provide the bounded push contract");
    const pushScript = readFileSync(pushImagePath, "utf8");
    const releaseJob = extractWorkflowJob(readFileSync(workflowPath, "utf8"), "release");

    assert.match(pushScript, /EXAMFORGE_PUSH_TIMEOUT_SECONDS:-1800/);
    assert.match(pushScript, /max_attempts=2/);
    assert.match(pushScript, /timeout[\s\S]*docker push/);
    assert.match(pushScript, /docker buildx imagetools inspect/);
    assert.match(pushScript, /status=/);
    assert.match(releaseJob, /scripts\/release\/push-image\.sh/);
    assert.match(releaseJob, /push-status\.log/);
  });

  it("does not contain any production server connection or deployment command", () => {
    const workflow = readFileSync(workflowPath, "utf8");

    assert.doesNotMatch(workflow, /(?:^|\s)(?:ssh|scp|rsync)(?:\s|$)/m);
    assert.doesNotMatch(workflow, /nginx|certbot|remote compose/i);
  });

  it("binds the runner proxy only to the dedicated Buildx container", () => {
    assert.ok(existsSync(configureBuildxPath), "configure-buildx.sh must isolate the runner proxy");
    const workflow = readFileSync(workflowPath, "utf8");
    const releaseJob = extractWorkflowJob(workflow, "release");
    const configureScript = readFileSync(configureBuildxPath, "utf8");
    const fixture = createBuildxFixture();
    const result = runBuildxFixture(fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(releaseJob, /id:\s*buildx/);
    assert.match(releaseJob, /scripts\/release\/configure-buildx\.sh/);
    assert.match(releaseJob, /steps\.buildx\.outputs\.name/);
    assert.doesNotMatch(configureScript, /\.docker\/config\.json|daemon\.json/);

    const calls = readFileSync(fixture.callsPath, "utf8");
    assert.match(calls, /buildx rm examforge-release-1-1/);
    assert.match(calls, /buildx create --name examforge-release-1-1 --driver docker-container --use/);
    assert.match(calls, /--driver-opt network=host/);
    assert.match(calls, /--driver-opt env\.HTTP_PROXY=http:\/\/127\.0\.0\.1:7890/);
    assert.match(calls, /--driver-opt env\.https_proxy=http:\/\/127\.0\.0\.1:7891/);
    assert.doesNotMatch(calls, /ALL_PROXY|NO_PROXY|all_proxy|no_proxy/);
    assert.match(calls, /buildx inspect examforge-release-1-1 --bootstrap/);
    assert.match(configureScript, /buildx inspect "\$builder_name" --bootstrap >\/dev\/null/);
  });
});

describe("release image runtime boundary", () => {
  it("installs only the selected production workspace for API and Worker", () => {
    for (const [name, workspace] of [["api", "@examforge/api"], ["worker", "@examforge/worker"]]) {
      const dockerfile = readFileSync(join(repositoryRoot, `apps/${name}/Dockerfile`), "utf8");

      assert.match(dockerfile, /FROM build AS production-dependencies/);
      assert.match(
        dockerfile,
        new RegExp(`npm ci --omit=dev --workspace ${workspace.replace("/", "\\/")} --include-workspace-root=false`),
      );
      assert.match(dockerfile, /COPY --from=production-dependencies[^\n]*\/app\/node_modules[^\n]*\/app\/node_modules/);
      assert.doesNotMatch(dockerfile, /COPY --from=build[^\n]*\/app\/node_modules/);
      assert.doesNotMatch(dockerfile, /npm prune --omit=dev --workspaces/);
    }
  });

  it("enforces the 700 MB limit and excludes unrelated workspace tooling", () => {
    const probeScript = readFileSync(probeImagePath, "utf8");

    assert.match(probeScript, /max_node_image_size_bytes=700000000/);
    assert.match(probeScript, /docker image ls --format '\{\{\.Size\}\}'/);
    assert.match(probeScript, /numfmt --from=si/);
    assert.doesNotMatch(probeScript, /docker image inspect --format '\{\{\.Size\}\}'/);
    for (const excludedPackage of ["next", "typescript", "tsx", "@playwright"]) {
      assert.match(probeScript, new RegExp(excludedPackage.replace("@", "@?")));
    }
  });
});

describe("bounded registry push helper", () => {
  it("retries one failed push and returns the remotely inspected digest", () => {
    const fixture = createPushFixture(2);
    const result = runPushFixture(fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(fixture.attemptPath, "utf8"), "2\n");
    assert.equal(readFileSync(fixture.digestPath, "utf8"), `${imageDigest}\n`);
    const status = readFileSync(fixture.statusPath, "utf8");
    assert.match(status, /attempt=1 status=failed reason=push_failed/);
    assert.match(status, /attempt=1 status=retrying reason=push_failed/);
    assert.match(status, /attempt=2 status=succeeded reason=remote_digest_verified/);
  });

  it("stops after the second failed push and does not write a digest", () => {
    const fixture = createPushFixture(3);
    const result = runPushFixture(fixture);

    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(fixture.attemptPath, "utf8"), "2\n");
    assert.equal(existsSync(fixture.digestPath), false);
    const status = readFileSync(fixture.statusPath, "utf8");
    assert.equal((status.match(/status=failed/g) ?? []).length, 2);
    assert.equal((status.match(/status=retrying/g) ?? []).length, 1);
  });
});

function createReleaseFixture(mutate) {
  const directory = mkdtempSync(join(tmpdir(), "examforge-release-"));
  const auditPath = "audit/npm-audit.json";
  const auditContent = JSON.stringify({ metadata: { vulnerabilities: { total: 0 } } }, null, 2) + "\n";
  writeFile(join(directory, auditPath), auditContent);

  const manifest = {
    schemaVersion: 1,
    commitSha,
    createdAt: "2026-07-14T00:00:00.000Z",
    sourceUrl,
    publicOrigin: "https://examforge.site",
    buildPlatform: "linux/amd64",
    dependencyAudit: {
      tool: "npm",
      version: "12.0.1",
      level: "moderate",
      productionOnly: true,
      result: "passed",
      vulnerabilities: 0,
      path: auditPath,
      sha256: sha256(auditContent),
    },
    images: {},
  };

  for (const name of imageNames) {
    const sbomPath = `images/${name}/sbom.spdx.json`;
    const scanPath = `images/${name}/trivy.json`;
    const sbomContent = JSON.stringify({ spdxVersion: "SPDX-2.3", name }, null, 2) + "\n";
    const scanContent = JSON.stringify({ Results: [], image: name }, null, 2) + "\n";
    writeFile(join(directory, sbomPath), sbomContent);
    writeFile(join(directory, scanPath), scanContent);
    const repository = `ccr.ccs.tencentyun.com/examforge/${name}`;
    manifest.images[name] = {
      repository,
      tag: commitSha,
      digest: imageDigest,
      reference: `${repository}@${imageDigest}`,
      dockerfile: dockerfiles[name],
      sourceRevision: commitSha,
      sourceUrl,
      buildPlatform: "linux/amd64",
      sbom: {
        format: "spdx-json",
        tool: "syft",
        version: "1.44.0",
        path: sbomPath,
        sha256: sha256(sbomContent),
      },
      vulnerabilityScan: {
        tool: "trivy",
        version: "0.70.0",
        result: "passed",
        path: scanPath,
        sha256: sha256(scanContent),
      },
    };
  }

  mutate?.(manifest);
  const manifestPath = join(directory, "release-manifest.json");
  writeJson(manifestPath, manifest);
  return { directory, manifest, manifestPath };
}

function verify(manifestPath, ...args) {
  return spawnSync(process.execPath, [verifierPath, manifestPath, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function createManifest(directory, outputPath) {
  return spawnSync(process.execPath, [
    creatorPath,
    "--input", join(directory, "images"),
    "--audit", join(directory, "audit/npm-audit.json"),
    "--output", outputPath,
    "--commit", commitSha,
    "--created-at", "2026-07-14T00:00:00.000Z",
    "--source-url", sourceUrl,
    "--public-origin", "https://examforge.site",
    "--npm-version", "12.0.1",
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writeJson(path, value) {
  writeFile(path, JSON.stringify(value, null, 2) + "\n");
}

function sha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function extractWorkflowJob(workflow, name, nextName) {
  const start = workflow.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1, `workflow job ${name} must exist`);
  const end = nextName ? workflow.indexOf(`  ${nextName}:\n`, start + 1) : workflow.length;
  assert.notEqual(end, -1, `workflow job ${nextName} must exist`);
  return workflow.slice(start, end);
}

function createPushFixture(succeedOnAttempt) {
  const directory = mkdtempSync(join(tmpdir(), "examforge-push-"));
  const binDirectory = join(directory, "bin");
  const dockerPath = join(binDirectory, "docker");
  const attemptPath = join(directory, "attempts");
  const digestPath = join(directory, "digest.txt");
  const statusPath = join(directory, "push-status.log");
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(dockerPath, `#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == "push" ]]; then
  attempt=0
  [[ ! -f "$FAKE_DOCKER_ATTEMPT_PATH" ]] || attempt=$(< "$FAKE_DOCKER_ATTEMPT_PATH")
  attempt=$((attempt + 1))
  printf '%s\\n' "$attempt" > "$FAKE_DOCKER_ATTEMPT_PATH"
  printf 'fake push attempt %s\\n' "$attempt"
  ((attempt >= FAKE_DOCKER_SUCCEED_ON_ATTEMPT))
  exit
fi
if [[ "$1 $2 $3" == "buildx imagetools inspect" ]]; then
  printf '{"digest":"${imageDigest}"}\\n'
  exit 0
fi
exit 2
`);
  chmodSync(dockerPath, 0o755);
  return { directory, binDirectory, attemptPath, digestPath, statusPath, succeedOnAttempt };
}

function runPushFixture(fixture) {
  return spawnSync("bash", [
    pushImagePath,
    `ccr.ccs.tencentyun.com/examforge/api:${commitSha}`,
    "api",
    fixture.digestPath,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.binDirectory}:${process.env.PATH}`,
      EXAMFORGE_PUSH_RETRY_DELAY_SECONDS: "0",
      EXAMFORGE_PUSH_STATUS_FILE: fixture.statusPath,
      EXAMFORGE_PUSH_LOG_DIR: join(fixture.directory, "logs"),
      FAKE_DOCKER_ATTEMPT_PATH: fixture.attemptPath,
      FAKE_DOCKER_SUCCEED_ON_ATTEMPT: String(fixture.succeedOnAttempt),
    },
  });
}

function createBuildxFixture() {
  const directory = mkdtempSync(join(tmpdir(), "examforge-buildx-"));
  const binDirectory = join(directory, "bin");
  const dockerPath = join(binDirectory, "docker");
  const callsPath = join(directory, "docker-calls.log");
  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(dockerPath, `#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_CALLS_PATH"
`);
  chmodSync(dockerPath, 0o755);
  return { binDirectory, callsPath };
}

function runBuildxFixture(fixture) {
  return spawnSync("bash", [configureBuildxPath, "examforge-release-1-1"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.binDirectory}:${process.env.PATH}`,
      FAKE_DOCKER_CALLS_PATH: fixture.callsPath,
      HTTP_PROXY: "http://127.0.0.1:7890",
      HTTPS_PROXY: "http://127.0.0.1:7891",
      ALL_PROXY: "socks5://127.0.0.1:7892",
      NO_PROXY: "localhost,127.0.0.1",
      http_proxy: "http://127.0.0.1:7890",
      https_proxy: "http://127.0.0.1:7891",
      all_proxy: "socks5://127.0.0.1:7892",
      no_proxy: "localhost,127.0.0.1",
    },
  });
}
