#!/usr/bin/env node

import { readFileSync } from "node:fs";

try {
  const path = process.argv[2];
  if (!path) throw new Error("usage: summarize-resource-samples.mjs <samples.tsv>");
  const samples = new Map();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    const separator = line.indexOf("\t");
    if (separator < 1) throw new Error("resource sample line is invalid");
    const sampleId = line.slice(0, separator);
    const value = JSON.parse(line.slice(separator + 1));
    const sample = samples.get(sampleId) ?? { cpuPercent: 0, memoryBytes: 0 };
    sample.cpuPercent += Number.parseFloat(String(value.CPUPerc).replace("%", "")) || 0;
    sample.memoryBytes += parseBytes(String(value.MemUsage).split("/")[0].trim());
    samples.set(sampleId, sample);
  }
  if (samples.size === 0) throw new Error("resource samples are empty");
  const peak = [...samples.values()].reduce((current, sample) => ({
    cpuPercent: Math.max(current.cpuPercent, sample.cpuPercent),
    memoryBytes: Math.max(current.memoryBytes, sample.memoryBytes),
  }), { cpuPercent: 0, memoryBytes: 0 });
  process.stdout.write(`${JSON.stringify({
    sampleCount: samples.size,
    peakCpuPercent: Number(peak.cpuPercent.toFixed(2)),
    peakMemoryBytes: peak.memoryBytes,
  })}\n`);
} catch (error) {
  process.stderr.write(`Resource sample summary failed: ${error.message}\n`);
  process.exitCode = 1;
}

function parseBytes(value) {
  const match = /^([0-9.]+)([KMGT]?i?B)$/.exec(value);
  if (!match) throw new Error(`unsupported memory value: ${value}`);
  const factors = {
    B: 1,
    kB: 1_000,
    KB: 1_000,
    KiB: 1_024,
    MB: 1_000_000,
    MiB: 1_048_576,
    GB: 1_000_000_000,
    GiB: 1_073_741_824,
    TB: 1_000_000_000_000,
    TiB: 1_099_511_627_776,
  };
  const factor = factors[match[2]];
  if (!factor) throw new Error(`unsupported memory unit: ${match[2]}`);
  return Math.round(Number(match[1]) * factor);
}
