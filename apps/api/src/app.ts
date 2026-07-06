import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  referenceRecordCreateSchemas,
  referenceRecordUpdateSchemas,
  referenceResourceSchema,
  type ReferenceRecord,
  type ReferenceResource,
} from "@examforge/shared";
import type { PlatformRepository } from "./repository.js";
import { createPlatformRepository } from "./repository-factory.js";
import {
  PythonSchedulerClient,
  type SchedulerClient,
} from "./scheduler-client.js";

export interface AppOptions {
  repository?: PlatformRepository;
  scheduler?: SchedulerClient;
}

export function createApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });
  const repository = options.repository ?? createPlatformRepository();
  const scheduler = options.scheduler ?? new PythonSchedulerClient();

  app.register(cors, {
    origin: true,
  });

  app.get("/health", async () => ({
    ok: true,
    service: "examforge-api",
  }));

  app.addHook("onClose", async () => {
    await repository.close?.();
  });

  app.get("/api/dashboard", async () => repository.getDashboard());

  app.get("/api/reference-data", async () => repository.getReferenceData());

  app.post<{ Params: { resource: string } }>(
    "/api/reference-data/:resource",
    async (request, reply) => {
      const resource = parseReferenceResource(request.params.resource);
      if (!resource) {
        return reply.code(404).send({
          error: "reference_resource_not_found",
          message: `Reference resource ${request.params.resource} does not exist.`,
        });
      }

      const parsed = referenceRecordCreateSchemas[resource].safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_reference_data",
          message: "Reference data payload is invalid.",
          issues: parsed.error.issues,
        });
      }

      const record = await repository.createReferenceRecord(
        resource,
        parsed.data as ReferenceRecord,
      );
      return reply.code(201).send({ resource, record });
    },
  );

  app.patch<{ Params: { resource: string; id: string } }>(
    "/api/reference-data/:resource/:id",
    async (request, reply) => {
      const resource = parseReferenceResource(request.params.resource);
      if (!resource) {
        return reply.code(404).send({
          error: "reference_resource_not_found",
          message: `Reference resource ${request.params.resource} does not exist.`,
        });
      }

      const parsed = referenceRecordUpdateSchemas[resource].safeParse(request.body);
      if (!parsed.success || Object.keys(parsed.data).length === 0) {
        return reply.code(400).send({
          error: "invalid_reference_data",
          message: "Reference data patch is invalid.",
          issues: parsed.success ? [] : parsed.error.issues,
        });
      }

      const record = await repository.updateReferenceRecord(
        resource,
        request.params.id,
        parsed.data as Partial<ReferenceRecord>,
      );
      if (!record) {
        return reply.code(404).send({
          error: "reference_record_not_found",
          message: `Reference record ${request.params.id} does not exist.`,
        });
      }

      return { resource, record };
    },
  );

  app.post("/api/schedule-runs", async (_request, reply) => {
    const referenceData = await repository.getReferenceData();
    const result = await scheduler.solve(referenceData.scheduleInput);
    const response = await repository.createScheduleRun(result);
    return reply.code(201).send(response);
  });

  app.get<{ Params: { id: string } }>("/api/schedule-runs/:id", async (request, reply) => {
    const response = await repository.getScheduleRun(request.params.id);
    if (!response) {
      return reply.code(404).send({
        error: "schedule_run_not_found",
        message: `Schedule run ${request.params.id} does not exist.`,
      });
    }
    return response;
  });

  return app;
}

function parseReferenceResource(value: string): ReferenceResource | null {
  const parsed = referenceResourceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
