#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assert,
  parseNamedArguments,
  validateReleaseManifest,
} from "../release/release-manifest-lib.mjs";

const imageVariables = {
  api: "EXAMFORGE_API_IMAGE",
  scheduler: "EXAMFORGE_SCHEDULER_IMAGE",
  web: "EXAMFORGE_WEB_IMAGE",
  worker: "EXAMFORGE_WORKER_IMAGE",
};

try {
  const args = parseNamedArguments(process.argv.slice(2), [
    "env-file",
    "manifest",
    "output",
  ]);
  const envPath = resolve(args["env-file"]);
  const manifestPath = resolve(args.manifest);
  const outputPath = resolve(args.output);
  assert(outputPath !== envPath, "output must not overwrite the source environment file");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  validateReleaseManifest(manifest);
  const source = readFileSync(envPath, "utf8");
  const lines = source.split(/\r?\n/);
  const values = new Map();
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    assert(match, "environment file contains an unsupported line");
    assert(!values.has(match[1]), `environment variable is duplicated: ${match[1]}`);
    values.set(match[1], match[2]);
  }
  assert(values.get("EXAMFORGE_PUBLIC_ORIGIN") === manifest.publicOrigin,
    "release public origin does not match EXAMFORGE_PUBLIC_ORIGIN");

  const replacements = new Map(Object.entries(imageVariables).map(([name, variable]) => {
    assert(values.has(variable), `${variable} is missing from the environment file`);
    return [variable, manifest.images[name].reference];
  }));
  const output = lines.map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!match || !replacements.has(match[1])) return line;
    return `${match[1]}=${replacements.get(match[1])}`;
  }).join("\n");
  writeFileSync(outputPath, output, { flag: "wx", mode: 0o600 });
  process.stdout.write(`Release environment created: ${outputPath}\n`);
} catch (error) {
  process.stderr.write(`Release environment creation failed: ${error.message}\n`);
  process.exitCode = 1;
}
