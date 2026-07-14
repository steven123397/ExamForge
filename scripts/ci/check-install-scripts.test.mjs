import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./check-install-scripts.mjs", import.meta.url));

test("accepts an empty pending install-script report", () => {
  const result = runCheck({ allowScripts: [] });

  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /install-script approvals are complete/i);
});

test("rejects every unreviewed install script with its pinned version", () => {
  const result = runCheck({
    allowScripts: [
      { name: "sharp", changes: [{ key: "sharp@0.34.5", change: "pending" }] },
      { name: "esbuild", changes: [{ key: "esbuild@0.28.1", change: "pending" }] },
    ],
  });

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /esbuild@0\.28\.1/u);
  assert.match(result.output, /sharp@0\.34\.5/u);
});

function runCheck(report) {
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    input: JSON.stringify(report),
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}
