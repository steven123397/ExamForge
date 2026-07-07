import { spawn } from "node:child_process";
import path from "node:path";
import {
  scheduleResultSchema,
  type ScheduleInput,
  type ScheduleResult,
} from "@examforge/shared";

export interface SchedulerClient {
  solve(input: ScheduleInput): Promise<ScheduleResult>;
}

export class PythonSchedulerClient implements SchedulerClient {
  constructor(
    private readonly schedulerDir = path.resolve(process.cwd(), "../scheduler"),
    private readonly executable = process.env.SCHEDULER_PYTHON ?? "uv",
  ) {}

  solve(input: ScheduleInput): Promise<ScheduleResult> {
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
          const parsed = scheduleResultSchema.parse(JSON.parse(stdout));
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });

      child.stdin.end(JSON.stringify(input));
    });
  }
}
