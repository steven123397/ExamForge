#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { dockerfiles, imageNames, parseNamedArguments } from "./release-manifest-lib.mjs";

try {
  const args = parseNamedArguments(process.argv.slice(2), [
    "output",
    "name",
    "repository",
    "tag",
    "digest",
    "commit",
    "source-url",
    "syft-version",
    "trivy-version",
  ]);
  if (!imageNames.includes(args.name)) {
    throw new Error(`unsupported image name: ${args.name}`);
  }
  const fragment = {
    name: args.name,
    repository: args.repository,
    tag: args.tag,
    digest: args.digest,
    dockerfile: dockerfiles[args.name],
    sourceRevision: args.commit,
    sourceUrl: args["source-url"],
    buildPlatform: "linux/amd64",
    sbom: {
      format: "spdx-json",
      tool: "syft",
      version: args["syft-version"],
      file: "sbom.spdx.json",
    },
    vulnerabilityScan: {
      tool: "trivy",
      version: args["trivy-version"],
      result: "passed",
      file: "trivy.json",
    },
  };
  const outputPath = resolve(args.output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(fragment, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`Image release fragment created: ${outputPath}\n`);
} catch (error) {
  process.stderr.write(`Image release fragment creation failed: ${error.message}\n`);
  process.exitCode = 1;
}
