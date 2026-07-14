import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve, sep } from "node:path";

export const imageNames = ["api", "scheduler", "web", "worker"];
export const dockerfiles = {
  api: "apps/api/Dockerfile",
  scheduler: "apps/scheduler/Dockerfile",
  web: "apps/web/Dockerfile",
  worker: "apps/worker/Dockerfile",
};

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const checksumPattern = /^sha256:[a-f0-9]{64}$/;
const repositoryPattern = /^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._-]+\/[a-z0-9._-]+$/;
const secretFieldPattern = /(password|secret|token|credential|private.?key)/i;

export function validateReleaseManifest(manifest, options = {}) {
  assertPlainObject(manifest, "manifest");
  rejectSecretFields(manifest);
  assertExactKeys(manifest, [
    "schemaVersion",
    "commitSha",
    "createdAt",
    "sourceUrl",
    "publicOrigin",
    "buildPlatform",
    "dependencyAudit",
    "images",
  ], "manifest");

  assert(manifest.schemaVersion === 1, "manifest.schemaVersion must equal 1");
  assertMatch(manifest.commitSha, commitPattern, "manifest.commitSha must be a full Git SHA");
  assertIsoDate(manifest.createdAt, "manifest.createdAt");
  assertSourceUrl(manifest.sourceUrl);
  assertHttpsOrigin(manifest.publicOrigin);
  assert(manifest.buildPlatform === "linux/amd64", "manifest.buildPlatform must equal linux/amd64");
  if (options.expectedCommit !== undefined) {
    assertMatch(options.expectedCommit, commitPattern, "--expected-commit must be a full Git SHA");
    assert(
      manifest.commitSha === options.expectedCommit,
      `manifest commit ${manifest.commitSha} does not match expected commit ${options.expectedCommit}`,
    );
  }

  validateAudit(manifest.dependencyAudit);
  assertPlainObject(manifest.images, "manifest.images");
  assertExactKeys(manifest.images, imageNames, "manifest.images");

  let repositoryPrefix;
  for (const name of imageNames) {
    const image = manifest.images[name];
    validateImage(name, image, manifest);
    const currentPrefix = image.repository.slice(0, -(name.length + 1));
    repositoryPrefix ??= currentPrefix;
    assert(
      repositoryPrefix === currentPrefix,
      "all images must use the same registry and namespace",
    );
  }

  if (options.verifyFiles) {
    const baseDirectory = dirname(resolve(options.manifestPath));
    const auditPath = verifyReport(
      baseDirectory,
      manifest.dependencyAudit.path,
      manifest.dependencyAudit.sha256,
    );
    validateAttachedAudit(auditPath);
    for (const name of imageNames) {
      const sbomPath = verifyReport(
        baseDirectory,
        manifest.images[name].sbom.path,
        manifest.images[name].sbom.sha256,
      );
      const scanPath = verifyReport(
        baseDirectory,
        manifest.images[name].vulnerabilityScan.path,
        manifest.images[name].vulnerabilityScan.sha256,
      );
      validateAttachedSbom(sbomPath, name);
      validateAttachedScan(scanPath, name);
    }
  }
}

export function sha256File(path) {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

export function parseNamedArguments(argv, requiredNames) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    assert(flag?.startsWith("--") && value !== undefined, `invalid argument near ${flag ?? "end"}`);
    const name = flag.slice(2);
    assert(requiredNames.includes(name), `unknown argument: ${flag}`);
    assert(values[name] === undefined, `argument provided more than once: ${flag}`);
    values[name] = value;
  }
  for (const name of requiredNames) {
    assert(values[name] !== undefined && values[name] !== "", `--${name} is required`);
  }
  return values;
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertPlainObject(value, name) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
}

export function assertExactKeys(value, expectedKeys, name) {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  assert(
    JSON.stringify(actualKeys) === JSON.stringify(expected),
    `${name} must contain exactly: ${expected.join(", ")}`,
  );
}

function validateAudit(audit) {
  assertPlainObject(audit, "manifest.dependencyAudit");
  assertExactKeys(audit, [
    "tool",
    "version",
    "level",
    "productionOnly",
    "result",
    "vulnerabilities",
    "path",
    "sha256",
  ], "manifest.dependencyAudit");
  assert(audit.tool === "npm", "dependency audit tool must be npm");
  assertMatch(audit.version, /^12\.[0-9]+\.[0-9]+$/, "dependency audit must use npm 12");
  assert(audit.level === "moderate", "dependency audit level must be moderate");
  assert(audit.productionOnly === true, "dependency audit must cover production dependencies only");
  assert(audit.result === "passed", "dependency audit result must be passed");
  assert(audit.vulnerabilities === 0, "dependency audit must report zero vulnerabilities");
  assert(audit.path === "audit/npm-audit.json", "dependency audit path is invalid");
  assertMatch(audit.sha256, checksumPattern, "dependency audit checksum is invalid");
}

function validateImage(name, image, manifest) {
  const path = `manifest.images.${name}`;
  assertPlainObject(image, path);
  assertExactKeys(image, [
    "repository",
    "tag",
    "digest",
    "reference",
    "dockerfile",
    "sourceRevision",
    "sourceUrl",
    "buildPlatform",
    "sbom",
    "vulnerabilityScan",
  ], path);
  assertMatch(image.repository, repositoryPattern, `${path}.repository is invalid`);
  assert(image.repository.endsWith(`/${name}`), `${path}.repository must end with /${name}`);
  assert(image.tag === manifest.commitSha, `${path}.tag must equal manifest.commitSha`);
  assertMatch(image.digest, digestPattern, `${path}.digest must be immutable`);
  assert(image.reference === `${image.repository}@${image.digest}`, `${path}.reference is inconsistent`);
  assert(image.dockerfile === dockerfiles[name], `${path}.dockerfile is invalid`);
  assert(image.sourceRevision === manifest.commitSha, `${path}.sourceRevision is inconsistent`);
  assert(image.sourceUrl === manifest.sourceUrl, `${path}.sourceUrl is inconsistent`);
  assert(image.buildPlatform === manifest.buildPlatform, `${path}.buildPlatform is inconsistent`);
  validateSbom(name, image.sbom);
  validateScan(name, image.vulnerabilityScan);
}

function validateSbom(name, sbom) {
  const path = `manifest.images.${name}.sbom`;
  assertPlainObject(sbom, path);
  assertExactKeys(sbom, ["format", "tool", "version", "path", "sha256"], path);
  assert(sbom.format === "spdx-json", `${path}.format must be spdx-json`);
  assert(sbom.tool === "syft", `${path}.tool must be syft`);
  assertMatch(sbom.version, /^[0-9]+\.[0-9]+\.[0-9]+$/, `${path}.version is invalid`);
  assert(sbom.path === `images/${name}/sbom.spdx.json`, `${path}.path is invalid`);
  assertSafeRelativePath(sbom.path, `${path}.path`);
  assertMatch(sbom.sha256, checksumPattern, `${path}.sha256 is invalid`);
}

function validateScan(name, scan) {
  const path = `manifest.images.${name}.vulnerabilityScan`;
  assertPlainObject(scan, path);
  assertExactKeys(scan, ["tool", "version", "result", "path", "sha256"], path);
  assert(scan.tool === "trivy", `${path}.tool must be trivy`);
  assertMatch(scan.version, /^[0-9]+\.[0-9]+\.[0-9]+$/, `${path}.version is invalid`);
  assert(scan.result === "passed", `${path}.result must be passed`);
  assert(scan.path === `images/${name}/trivy.json`, `${path}.path is invalid`);
  assertSafeRelativePath(scan.path, `${path}.path`);
  assertMatch(scan.sha256, checksumPattern, `${path}.sha256 is invalid`);
}

function verifyReport(baseDirectory, relativePath, expectedChecksum) {
  assertSafeRelativePath(relativePath, "report path");
  const absolutePath = resolve(baseDirectory, relativePath);
  assert(
    absolutePath.startsWith(`${baseDirectory}${sep}`),
    `report path escapes the release bundle: ${relativePath}`,
  );
  assert(existsSync(absolutePath), `release report is missing: ${relativePath}`);
  assert(statSync(absolutePath).isFile(), `release report is not a file: ${relativePath}`);
  const actualChecksum = sha256File(absolutePath);
  assert(
    actualChecksum === expectedChecksum,
    `report checksum mismatch for ${relativePath}`,
  );
  return absolutePath;
}

function validateAttachedAudit(path) {
  const report = parseJsonReport(path, "npm audit");
  assert(
    report?.metadata?.vulnerabilities?.total === 0,
    "attached npm audit report must contain zero vulnerabilities",
  );
}

function validateAttachedSbom(path, imageName) {
  const report = parseJsonReport(path, `${imageName} SBOM`);
  assert(report.spdxVersion === "SPDX-2.3", `${imageName} SBOM must use SPDX 2.3`);
}

function validateAttachedScan(path, imageName) {
  const report = parseJsonReport(path, `${imageName} Trivy scan`);
  assert(Array.isArray(report.Results), `${imageName} Trivy scan must contain Results`);
  const findings = report.Results.flatMap((result) => result.Vulnerabilities ?? []);
  const blocking = findings.filter((finding) => (
    finding.Severity === "HIGH" || finding.Severity === "CRITICAL"
  ));
  assert(blocking.length === 0, `${imageName} Trivy scan contains HIGH/CRITICAL vulnerabilities`);
}

function parseJsonReport(path, name) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`attached ${name} report is not valid JSON`);
  }
}

function rejectSecretFields(value, path = "manifest") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretFields(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    assert(!secretFieldPattern.test(key), `secret-like field is forbidden: ${path}.${key}`);
    rejectSecretFields(child, `${path}.${key}`);
  }
}

function assertSafeRelativePath(value, name) {
  assert(typeof value === "string" && value.length > 0, `${name} must be a string`);
  assert(!isAbsolute(value), `${name} must be relative`);
  assert(!value.split("/").some((part) => part === "" || part === "." || part === ".."), `${name} is unsafe`);
  assert(!value.includes("\\"), `${name} must use POSIX separators`);
}

function assertSourceUrl(value) {
  assertMatch(value, /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "manifest.sourceUrl is invalid");
}

function assertHttpsOrigin(value) {
  assert(typeof value === "string", "manifest.publicOrigin must be a string");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("manifest.publicOrigin must be an exact HTTPS origin");
  }
  assert(url.protocol === "https:", "manifest.publicOrigin must use HTTPS");
  assert(url.pathname === "/" && !url.search && !url.hash, "manifest.publicOrigin must be an exact origin");
  assert(value === url.origin, "manifest.publicOrigin must not include a trailing slash");
}

function assertIsoDate(value, name) {
  assert(typeof value === "string", `${name} must be a string`);
  const timestamp = Date.parse(value);
  assert(Number.isFinite(timestamp), `${name} must be an ISO timestamp`);
  assert(new Date(timestamp).toISOString() === value, `${name} must use normalized UTC ISO format`);
}

function assertMatch(value, pattern, message) {
  assert(typeof value === "string" && pattern.test(value), message);
}
