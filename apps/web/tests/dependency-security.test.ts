import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

interface RootPackageManifest {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  allowScripts?: Record<string, boolean>;
  overrides?: { postcss?: string };
}

interface Lockfile {
  packages?: Record<string, {
    version?: string;
    dependencies?: Record<string, string>;
  }>;
}

const rootPackage = readJson("../../../package.json") as RootPackageManifest;
const lockfile = readJson("../../../package-lock.json") as Lockfile;
const ciWorkflow = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
const nodeDockerfiles = ["api", "web", "worker"].map((app) => ({
  app,
  content: readFileSync(new URL(`../../${app}/Dockerfile`, import.meta.url), "utf8"),
}));

describe("Web dependency security", () => {
  it("pins the package manager and locks the patched PostCSS version for the sole Next chain", () => {
    const postcssOverride = rootPackage.overrides?.postcss ?? "";
    const postcssParents = Object.entries(lockfile.packages ?? {})
      .filter(([, entry]) => entry?.dependencies?.postcss)
      .map(([packagePath]) => packagePath);

    assert.equal(rootPackage.packageManager, "npm@12.0.1");
    assert.equal(postcssOverride, "8.5.19");
    assert.equal(rootPackage.dependencies?.postcss, undefined);
    assert.equal(rootPackage.devDependencies?.postcss, undefined);
    assert.deepEqual(postcssParents, ["node_modules/next"]);
    assert.equal(lockfile.packages?.["node_modules/postcss"]?.version, postcssOverride);
    assert.equal(isVersionAtLeast(postcssOverride, "8.5.10"), true);
  });

  it("installs the pinned npm release and audits moderate advisories in every CI path", () => {
    assert.match(ciWorkflow, /NPM_VERSION: "12\.0\.1"/u);
    assert.equal(
      ciWorkflow.match(/npm install --global --prefix "\$RUNNER_TEMP\/npm12" --ignore-scripts --no-fund --no-audit "npm@\$\{NPM_VERSION\}"/gu)?.length,
      3,
    );
    assert.equal(
      ciWorkflow.match(/echo "\$RUNNER_TEMP\/npm12\/bin" >> "\$GITHUB_PATH"/gu)?.length,
      3,
    );
    assert.match(ciWorkflow, /run: npm audit --audit-level=moderate/u);
  });

  it("pins reviewed install-script permissions for every Node build surface", () => {
    assert.deepEqual(rootPackage.allowScripts, {
      "esbuild@0.28.1": true,
      "msgpackr-extract@3.0.4": true,
      "sharp@0.35.0": true,
    });
    assert.equal(
      rootPackage.scripts?.["check:install-scripts"],
      "npm install-scripts ls --json | node scripts/ci/check-install-scripts.mjs",
    );
    assert.match(ciWorkflow, /run: npm run check:install-scripts/u);
    for (const { app, content } of nodeDockerfiles) {
      assert.match(content, /^FROM node:22\.22\.2-bookworm-slim AS build$/mu, app);
      assert.match(content, /^ARG NPM_VERSION=12\.0\.1$/mu, app);
      assert.match(content, /^ENV PATH="\/opt\/npm12\/bin:\$\{PATH\}"$/mu, app);
      assert.match(
        content,
        /npm install --global --prefix \/opt\/npm12 --ignore-scripts --no-fund --no-audit "npm@\$\{NPM_VERSION\}"/u,
        app,
      );
    }
  });
});

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function isVersionAtLeast(version: string, minimum: string) {
  const currentParts = version.split(".").map(Number);
  const minimumParts = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (currentParts[index] !== minimumParts[index]) {
      return currentParts[index] > minimumParts[index];
    }
  }
  return true;
}
