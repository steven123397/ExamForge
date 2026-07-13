import type { ScheduleInput, ScheduleJobRequestSnapshot } from "@examforge/shared";
import { createHash, randomUUID } from "node:crypto";
import type {
  CreateScheduleJobResult,
  ScheduleJobSubmissionRepository,
} from "./contracts.js";

export interface SubmitScheduleJobCommand {
  batchId: string;
  input: ScheduleInput;
  idempotencyKey?: string;
  traceId?: string;
  constraintProfileVersionId?: string;
  submittedBy?: string;
  submittedByUserId?: string;
}

export class JobSubmissionService {
  constructor(private readonly repository: ScheduleJobSubmissionRepository) {}

  submit(command: SubmitScheduleJobCommand): Promise<CreateScheduleJobResult> {
    const requestSnapshot: ScheduleJobRequestSnapshot = {
      version: 1,
      input: structuredClone(command.input),
    };
    const requestDigest = createHash("sha256")
      .update(JSON.stringify(requestSnapshot))
      .digest("hex");
    return this.repository.createScheduleJob({
      batchId: command.batchId,
      idempotencyKey: command.idempotencyKey ?? `job-request-${randomUUID()}`,
      requestDigest,
      requestSnapshot,
      constraintProfileVersionId: command.constraintProfileVersionId,
      submittedBy: command.submittedBy,
      submittedByUserId: command.submittedByUserId,
      traceId: command.traceId ?? `trace-${randomUUID()}`,
    });
  }
}
