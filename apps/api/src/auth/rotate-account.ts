import { pathToFileURL } from "node:url";
import { createDbClient } from "@examforge/db";
import { PostgresPlatformRepository } from "../postgres-repository.js";
import { AccountRotationService } from "./account-rotation-service.js";

export interface AccountRotationArguments {
  username: string;
  confirmUsername: string;
  actor: string;
}

const allowedArguments = new Set(["username", "confirm-username", "actor"]);

export function parseAccountRotationArguments(argv: string[]): AccountRotationArguments {
  if (argv.length % 2 !== 0) {
    throw new Error("Account rotation arguments must be flag/value pairs.");
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--")) {
      throw new Error(`Unsupported argument: ${flag ?? "end"}.`);
    }
    const name = flag.slice(2);
    if (!allowedArguments.has(name)) {
      throw new Error(`Unsupported argument: ${flag}.`);
    }
    if (values.has(name) || !value?.trim()) {
      throw new Error(`${flag} must be provided exactly once with a non-empty value.`);
    }
    values.set(name, value.trim());
  }

  const username = requiredArgument(values, "username");
  const confirmUsername = requiredArgument(values, "confirm-username");
  const actor = requiredArgument(values, "actor");
  if (username !== confirmUsername) {
    throw new Error("Account confirmation does not match --username.");
  }
  return { username, confirmUsername, actor };
}

export function readRotationPassword(input: string) {
  const password = input.endsWith("\r\n")
    ? input.slice(0, -2)
    : input.endsWith("\n") ? input.slice(0, -1) : input;
  if (!password) {
    throw new Error("Rotation password is required on standard input.");
  }
  if (password.includes("\0")) {
    throw new Error("Rotation password contains an unsupported control character.");
  }
  return password;
}

async function main() {
  if (process.stdin.isTTY) {
    throw new Error("Rotation password must be piped through standard input.");
  }
  const args = parseAccountRotationArguments(process.argv.slice(2));
  const password = readRotationPassword(await readStandardInput());
  const client = createDbClient();
  try {
    const result = await new AccountRotationService(
      new PostgresPlatformRepository(client),
    ).rotate({
      username: args.username,
      password,
      actor: args.actor,
    });
    if (result.status === "not_found") {
      throw new Error("Target account was not found.");
    }
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      username: args.username,
      credentialVersion: result.credentialVersion,
      revokedSessionCount: result.revokedSessionCount,
    })}\n`);
  } finally {
    await client.close();
  }
}

function requiredArgument(values: Map<string, string>, name: string) {
  const value = values.get(name);
  if (!value) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

async function readStandardInput() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    process.stderr.write(`Account rotation failed: ${message}\n`);
    process.exitCode = 1;
  });
}
