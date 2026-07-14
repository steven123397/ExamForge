#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateReleaseManifest } from "./release-manifest-lib.mjs";

try {
  const { manifestPath, expectedCommit, verifyFiles } = parseArguments(process.argv.slice(2));
  const absolutePath = resolve(manifestPath);
  const manifest = JSON.parse(readFileSync(absolutePath, "utf8"));
  validateReleaseManifest(manifest, {
    expectedCommit,
    verifyFiles,
    manifestPath: absolutePath,
  });
  process.stdout.write(`Release manifest verification passed: ${absolutePath}\n`);
} catch (error) {
  process.stderr.write(`Release manifest verification failed: ${error.message}\n`);
  process.exitCode = 1;
}

function parseArguments(argv) {
  let manifestPath;
  let expectedCommit;
  let verifyFiles = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--verify-files") {
      verifyFiles = true;
      continue;
    }
    if (argument === "--expected-commit") {
      expectedCommit = argv[index + 1];
      index += 1;
      if (!expectedCommit) {
        throw new Error("--expected-commit requires a value");
      }
      continue;
    }
    if (!argument.startsWith("--") && manifestPath === undefined) {
      manifestPath = argument;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (!manifestPath) {
    throw new Error("usage: verify-release.mjs <manifest> [--expected-commit SHA] [--verify-files]");
  }
  return { manifestPath, expectedCommit, verifyFiles };
}
