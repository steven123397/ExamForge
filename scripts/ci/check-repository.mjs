import { spawnSync } from "node:child_process";

const conventionalCommitPattern = /^(feat|fix|docs|style|refactor|perf|test|chore|ci|revert|build)(\([^()\r\n]+\))?!?: .+$/u;
const forbiddenSegments = new Set([
  ".codegraph",
  ".next",
  ".pytest_cache",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

export function isValidCommitSubject(subject) {
  if (/^Merge\b/u.test(subject)) {
    return true;
  }
  return [...subject].length <= 120 && conventionalCommitPattern.test(subject);
}

export function isForbiddenTrackedPath(filePath) {
  return filePath.endsWith(".pyc")
    || filePath.split("/").some((segment) => forbiddenSegments.has(segment));
}

export function checkRepository(options = {}) {
  const repository = options.repository ?? process.cwd();
  const head = resolveCommit(repository, options.head ?? "HEAD", "head");
  const range = resolveRange(repository, options.base, head);
  const errors = [];

  const trackedPaths = git(repository, ["ls-files", "-z"]).stdout
    .split("\0")
    .filter(Boolean);
  const forbiddenPaths = trackedPaths.filter(isForbiddenTrackedPath);
  if (forbiddenPaths.length > 0) {
    errors.push(
      "Forbidden tracked path(s):\n"
      + forbiddenPaths.map((filePath) => `  - ${filePath}`).join("\n"),
    );
  }

  const commits = git(repository, ["log", "--format=%H%x1f%s%x1e", range.commitRange])
    .stdout
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, subject] = record.split("\x1f");
      return { hash, subject };
    });
  const invalidCommits = commits.filter(({ subject }) => !isValidCommitSubject(subject));
  if (invalidCommits.length > 0) {
    errors.push(
      "Invalid commit message(s):\n"
      + invalidCommits
        .map(({ hash, subject }) => `  - ${hash.slice(0, 12)} ${subject}`)
        .join("\n"),
    );
  }

  collectWhitespaceErrors(repository, range.diffRange, errors);
  collectWhitespaceErrors(repository, null, errors);
  collectWhitespaceErrors(repository, null, errors, true);

  if (errors.length > 0) {
    throw new Error(errors.join("\n\n"));
  }

  return range.description;
}

function resolveRange(repository, baseOption, head) {
  if (baseOption === undefined) {
    const parent = git(repository, ["rev-parse", "--verify", `${head}^`], true);
    if (parent.status === 0) {
      const base = parent.stdout.trim();
      return {
        commitRange: `${base}..${head}`,
        diffRange: `${base}..${head}`,
        description: `${base.slice(0, 12)}..${head.slice(0, 12)}`,
      };
    }
    return firstPushRange(repository, head);
  }

  if (/^0+$/u.test(baseOption)) {
    return firstPushRange(repository, head);
  }

  const base = resolveCommit(repository, baseOption, "base");
  const mergeBase = git(repository, ["merge-base", base, head]).stdout.trim();
  return {
    commitRange: `${mergeBase}..${head}`,
    diffRange: `${mergeBase}..${head}`,
    description: `${mergeBase.slice(0, 12)}..${head.slice(0, 12)}`,
  };
}

function firstPushRange(repository, head) {
  const emptyTree = git(repository, ["hash-object", "-t", "tree", "/dev/null"]).stdout.trim();
  return {
    commitRange: head,
    diffRange: `${emptyTree}..${head}`,
    description: `empty-tree..${head.slice(0, 12)}`,
  };
}

function resolveCommit(repository, revision, label) {
  const result = git(repository, ["rev-parse", "--verify", `${revision}^{commit}`], true);
  if (result.status !== 0) {
    throw new Error(`Unable to resolve ${label} revision "${revision}".`);
  }
  return result.stdout.trim();
}

function collectWhitespaceErrors(repository, range, errors, cached = false) {
  const args = ["diff"];
  if (cached) {
    args.push("--cached");
  }
  args.push("--check");
  if (range !== null) {
    args.push(range);
  }
  const result = git(repository, args, true);
  if (result.status !== 0) {
    const target = cached ? "staged changes" : range ?? "working tree";
    errors.push(`Whitespace error(s) in ${target}:\n${result.stdout}${result.stderr}`.trimEnd());
  }
}

function git(repository, args, allowFailure = false) {
  const result = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`.trimEnd());
  }
  return result;
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--repository", "--base", "--head"].includes(argument)) {
      throw new Error(`Unknown argument "${argument}".`);
    }
    const value = argv[index + 1];
    if (!value) {
      throw new Error(`Missing value for "${argument}".`);
    }
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const range = checkRepository(parseArguments(process.argv.slice(2)));
    console.log(`Repository checks passed for ${range}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
