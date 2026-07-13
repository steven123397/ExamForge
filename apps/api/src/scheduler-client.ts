import { spawn } from "node:child_process";
import path from "node:path";
import {
  HttpSchedulerClient,
  SchedulerClientError,
  type HttpSchedulerClientOptions,
  type SchedulerClient,
  type SchedulerErrorCategory,
  type SchedulerSolveOptions,
} from "@examforge/scheduling-application";
import {
  scheduleResultSchema,
  type ScheduleInput,
  type ScheduleResult,
} from "@examforge/shared";

export {
  HttpSchedulerClient,
  SchedulerClientError,
};
export type {
  HttpSchedulerClientOptions,
  SchedulerClient,
  SchedulerErrorCategory,
  SchedulerSolveOptions,
};

export class PythonSchedulerClient implements SchedulerClient {
  constructor(
    private readonly schedulerDir = path.resolve(process.cwd(), "../scheduler"),
    private readonly executable = process.env.SCHEDULER_PYTHON ?? "uv",
  ) {}

  solve(input: ScheduleInput, options: SchedulerSolveOptions = {}): Promise<ScheduleResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.executable,
        ["run", "--python", "3.12", "--extra", "dev", "python", "-m", "examforge_scheduler.cli", "solve"],
        {
          cwd: this.schedulerDir,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        reject(new Error(
          `failed to start scheduler process "${this.executable}" in ${this.schedulerDir}: ${error.message}`,
          { cause: error },
        ));
      });
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`scheduler exited with ${code}: ${stderr || stdout}`));
          return;
        }
        try {
          const result = scheduleResultSchema.parse(JSON.parse(stdout));
          options.onMetadata?.({ schedulerVersion: "0.1.0" });
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      child.stdin.end(JSON.stringify(input));
    });
  }
}

export function createSchedulerClient(
  env: Record<string, string | undefined> = process.env,
): SchedulerClient {
  const transport = env.SCHEDULER_TRANSPORT ?? "cli";
  if (transport === "cli") {
    return new PythonSchedulerClient(
      env.SCHEDULER_DIR,
      env.SCHEDULER_PYTHON,
    );
  }
  if (transport === "http") {
    if (!env.SCHEDULER_BASE_URL) {
      throw new Error("SCHEDULER_BASE_URL is required for the HTTP scheduler transport.");
    }
    const timeoutMs = env.SCHEDULER_HTTP_TIMEOUT_MS === undefined
      ? undefined
      : Number(env.SCHEDULER_HTTP_TIMEOUT_MS);
    return new HttpSchedulerClient({
      baseUrl: env.SCHEDULER_BASE_URL,
      timeoutMs,
    });
  }
  throw new Error(`Unsupported scheduler transport: ${transport}`);
}
