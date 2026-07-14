#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  assert,
  assertExactKeys,
  assertPlainObject,
  dockerfiles,
  imageNames,
  parseNamedArguments,
  sha256File,
  validateReleaseManifest,
} from "./release-manifest-lib.mjs";

try {
  const args = parseNamedArguments(process.argv.slice(2), [
    "input",
    "audit",
    "output",
    "commit",
    "created-at",
    "source-url",
    "public-origin",
    "npm-version",
  ]);
  const outputPath = resolve(args.output);
  const bundleDirectory = dirname(outputPath);
  const inputDirectory = resolve(args.input);
  const auditPath = resolve(args.audit);
  assert(inputDirectory === join(bundleDirectory, "images"), "--input must be the bundle images directory");
  assert(auditPath === join(bundleDirectory, "audit/npm-audit.json"), "--audit must be the bundle audit report");

  const directories = readdirSync(inputDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assertExactKeys(Object.fromEntries(directories.map((name) => [name, true])), imageNames, "image fragment directories");

  const audit = JSON.parse(readFileSync(auditPath, "utf8"));
  const vulnerabilityTotal = audit?.metadata?.vulnerabilities?.total;
  assert(vulnerabilityTotal === 0, "npm production audit report must contain zero vulnerabilities");

  const manifest = {
    schemaVersion: 1,
    commitSha: args.commit,
    createdAt: args["created-at"],
    sourceUrl: args["source-url"],
    publicOrigin: args["public-origin"],
    buildPlatform: "linux/amd64",
    dependencyAudit: {
      tool: "npm",
      version: args["npm-version"],
      level: "moderate",
      productionOnly: true,
      result: "passed",
      vulnerabilities: vulnerabilityTotal,
      path: relative(bundleDirectory, auditPath).replaceAll("\\", "/"),
      sha256: sha256File(auditPath),
    },
    images: {},
  };

  for (const name of imageNames) {
    const imageDirectory = join(inputDirectory, name);
    const fragment = JSON.parse(readFileSync(join(imageDirectory, "fragment.json"), "utf8"));
    validateFragment(name, fragment);
    const sbomPath = join(imageDirectory, fragment.sbom.file);
    const scanPath = join(imageDirectory, fragment.vulnerabilityScan.file);
    manifest.images[name] = {
      repository: fragment.repository,
      tag: fragment.tag,
      digest: fragment.digest,
      reference: `${fragment.repository}@${fragment.digest}`,
      dockerfile: fragment.dockerfile,
      sourceRevision: fragment.sourceRevision,
      sourceUrl: fragment.sourceUrl,
      buildPlatform: fragment.buildPlatform,
      sbom: {
        format: fragment.sbom.format,
        tool: fragment.sbom.tool,
        version: fragment.sbom.version,
        path: relative(bundleDirectory, sbomPath).replaceAll("\\", "/"),
        sha256: sha256File(sbomPath),
      },
      vulnerabilityScan: {
        tool: fragment.vulnerabilityScan.tool,
        version: fragment.vulnerabilityScan.version,
        result: fragment.vulnerabilityScan.result,
        path: relative(bundleDirectory, scanPath).replaceAll("\\", "/"),
        sha256: sha256File(scanPath),
      },
    };
  }

  validateReleaseManifest(manifest, {
    expectedCommit: args.commit,
    verifyFiles: true,
    manifestPath: outputPath,
  });
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`Release manifest created: ${outputPath}\n`);
} catch (error) {
  process.stderr.write(`Release manifest creation failed: ${error.message}\n`);
  process.exitCode = 1;
}

function validateFragment(name, fragment) {
  assertPlainObject(fragment, `${name} fragment`);
  assertExactKeys(fragment, [
    "name",
    "repository",
    "tag",
    "digest",
    "dockerfile",
    "sourceRevision",
    "sourceUrl",
    "buildPlatform",
    "sbom",
    "vulnerabilityScan",
  ], `${name} fragment`);
  assert(fragment.name === name, `${name} fragment has the wrong image name`);
  assert(fragment.dockerfile === dockerfiles[name], `${name} fragment has the wrong Dockerfile`);
  assertPlainObject(fragment.sbom, `${name} fragment SBOM`);
  assertExactKeys(fragment.sbom, ["format", "tool", "version", "file"], `${name} fragment SBOM`);
  assert(fragment.sbom.file === "sbom.spdx.json", `${name} fragment has an invalid SBOM filename`);
  assertPlainObject(fragment.vulnerabilityScan, `${name} fragment scan`);
  assertExactKeys(
    fragment.vulnerabilityScan,
    ["tool", "version", "result", "file"],
    `${name} fragment scan`,
  );
  assert(fragment.vulnerabilityScan.file === "trivy.json", `${name} fragment has an invalid scan filename`);
}
