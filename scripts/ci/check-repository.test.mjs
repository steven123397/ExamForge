import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";

const scriptPath = fileURLToPath(new URL("./check-repository.mjs", import.meta.url));
const repositories = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("accepts a valid commit range", () => {
  const repository = createRepository();
  const base = commitFile(repository, "README.md", "base\n", "chore: 初始化仓库");
  const head = commitFile(repository, "src/app.js", "export {};\n", "feat(核心): 添加入口");

  const result = runCheck(repository, base, head);

  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /repository checks passed/i);
});

test("reports forbidden tracked artifacts with their paths", () => {
  const repository = createRepository();
  const base = commitFile(repository, "README.md", "base\n", "chore: 初始化仓库");
  const head = commitFile(repository, "dist/output.js", "generated\n", "build: 生成产物");

  const result = runCheck(repository, base, head);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /forbidden tracked path/i);
  assert.match(result.output, /dist\/output\.js/);
});

test("reports invalid Chinese Conventional Commit subjects", () => {
  const repository = createRepository();
  const base = commitFile(repository, "README.md", "base\n", "chore: 初始化仓库");
  const head = commitFile(repository, "src/app.js", "export {};\n", "updated files");

  const result = runCheck(repository, base, head);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /invalid commit message/i);
  assert.match(result.output, /updated files/);
});

test("checks every commit in a multi-commit range", () => {
  const repository = createRepository();
  const base = commitFile(repository, "README.md", "base\n", "chore: 初始化仓库");
  commitFile(repository, "src/first.js", "export const first = 1;\n", "bad middle commit");
  const head = commitFile(repository, "src/second.js", "export const second = 2;\n", "test(CI): 添加检查");

  const result = runCheck(repository, base, head);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /bad middle commit/);
});

test("reports whitespace errors from the changed range", () => {
  const repository = createRepository();
  const base = commitFile(repository, "README.md", "base\n", "chore: 初始化仓库");
  const head = commitFile(repository, "bad.txt", "trailing whitespace \n", "test(CI): 添加空白用例");

  const result = runCheck(repository, base, head);

  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /whitespace error/i);
  assert.match(result.output, /bad\.txt/);
});

test("falls back to the empty tree for a first push", () => {
  const repository = createRepository();
  commitFile(repository, "README.md", "base\n", "chore: 初始化仓库");
  const head = commitFile(repository, "src/app.js", "export {};\n", "feat(核心): 添加入口");

  const result = runCheck(repository, "0".repeat(40), head);

  assert.equal(result.status, 0, result.output);
});

test("allows Git merge commit subjects", () => {
  const repository = createRepository();
  const base = commitFile(repository, "README.md", "base\n", "chore: 初始化仓库");
  git(repository, "switch", "-q", "-c", "feature");
  commitFile(repository, "feature.txt", "feature\n", "feat(核心): 添加功能");
  git(repository, "switch", "-q", "main");
  commitFile(repository, "main.txt", "main\n", "docs: 更新说明");
  git(repository, "merge", "-q", "--no-ff", "feature", "-m", "Merge branch 'feature'");
  const head = git(repository, "rev-parse", "HEAD").stdout.trim();

  const result = runCheck(repository, base, head);

  assert.equal(result.status, 0, result.output);
});

function createRepository() {
  const repository = mkdtempSync(path.join(tmpdir(), "examforge-ci-test-"));
  repositories.push(repository);
  git(repository, "init", "-q", "--initial-branch=main");
  git(repository, "config", "user.name", "ExamForge CI Test");
  git(repository, "config", "user.email", "ci-test@example.invalid");
  return repository;
}

function commitFile(repository, relativePath, content, message) {
  const absolutePath = path.join(repository, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
  git(repository, "add", relativePath);
  git(repository, "commit", "-q", "-m", message);
  return git(repository, "rev-parse", "HEAD").stdout.trim();
}

function runCheck(repository, base, head) {
  const result = spawnSync(
    process.execPath,
    [scriptPath, "--repository", repository, "--base", base, "--head", head],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

function git(repository, ...args) {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result;
}
