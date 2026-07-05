import cors from "@fastify/cors";
import Fastify from "fastify";
import { demoScheduleInput } from "@examforge/shared";
import {
  InMemoryPlatformRepository,
  type PlatformRepository,
} from "./repository.js";
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
  const repository = options.repository ?? new InMemoryPlatformRepository();
  const scheduler = options.scheduler ?? new PythonSchedulerClient();

  app.register(cors, {
    origin: true,
  });

  app.get("/health", async () => ({
    ok: true,
    service: "examforge-api",
  }));

  app.get("/api/dashboard", async () => repository.getDashboard());

  app.get("/api/reference-data", async () => repository.getReferenceData());

  app.post("/api/schedule-runs", async (_request, reply) => {
    const result = await scheduler.solve(demoScheduleInput);
    const response = repository.createScheduleRun(result);
    return reply.code(201).send(response);
  });

  app.get<{ Params: { id: string } }>("/api/schedule-runs/:id", async (request, reply) => {
    const response = repository.getScheduleRun(request.params.id);
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
