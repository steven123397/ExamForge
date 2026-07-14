import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
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
