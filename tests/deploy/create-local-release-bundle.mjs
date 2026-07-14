#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  dockerfiles,
  imageNames,
  parseNamedArguments,
  sha256File,
  validateReleaseManifest,
} from "../../scripts/release/release-manifest-lib.mjs";

try {
  const args = parseNamedArguments(process.argv.slice(2), [
    "output",
    "commit",
    "created-at",
    "api-reference",
    "scheduler-reference",
    "web-reference",
    "worker-reference",
  ]);
  const outputDirectory = resolve(args.output);
  mkdirSync(join(outputDirectory, "audit"), { recursive: true });
  mkdirSync(join(outputDirectory, "images"), { recursive: true });
  const auditPath = join(outputDirectory, "audit/npm-audit.json");
  writeFileSync(auditPath, `${JSON.stringify({
    metadata: { vulnerabilities: { total: 0 } },
  })}\n`);

  const images = {};
  for (const name of imageNames) {
    const reference = args[`${name}-reference`];
    const separator = reference.lastIndexOf("@sha256:");
    if (separator < 1) throw new Error(`${name} reference must contain an immutable digest`);
    const repository = reference.slice(0, separator);
    const digest = reference.slice(separator + 1);
    const imageDirectory = join(outputDirectory, "images", name);
    mkdirSync(imageDirectory, { recursive: true });
    const sbomPath = join(imageDirectory, "sbom.spdx.json");
    const scanPath = join(imageDirectory, "trivy.json");
    writeFileSync(sbomPath, `${JSON.stringify({ spdxVersion: "SPDX-2.3" })}\n`);
    writeFileSync(scanPath, `${JSON.stringify({ Results: [] })}\n`);
    images[name] = {
      repository,
      tag: args.commit,
      digest,
      reference,
      dockerfile: dockerfiles[name],
      sourceRevision: args.commit,
      sourceUrl: "https://github.com/steven123397/ExamForge",
      buildPlatform: "linux/amd64",
      sbom: {
        format: "spdx-json",
        tool: "syft",
        version: "1.44.0",
        path: `images/${name}/sbom.spdx.json`,
        sha256: sha256File(sbomPath),
      },
      vulnerabilityScan: {
        tool: "trivy",
        version: "0.72.0",
        result: "passed",
        path: `images/${name}/trivy.json`,
        sha256: sha256File(scanPath),
      },
    };
  }
  const manifestPath = join(outputDirectory, "release-manifest.json");
  const manifest = {
    schemaVersion: 1,
    commitSha: args.commit,
    createdAt: args["created-at"],
    sourceUrl: "https://github.com/steven123397/ExamForge",
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
      sha256: sha256File(auditPath),
    },
    images,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  validateReleaseManifest(manifest, { verifyFiles: true, manifestPath });
  process.stdout.write(`${manifestPath}\n`);
} catch (error) {
  process.stderr.write(`Local release bundle creation failed: ${error.message}\n`);
  process.exitCode = 1;
}
