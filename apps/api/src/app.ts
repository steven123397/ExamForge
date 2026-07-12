import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  fixedAssignmentSchema,
  rescheduleContextSchema,
  referenceRecordCreateSchemas,
  referenceRecordUpdateSchemas,
  referenceResourceSchema,
  scheduledExamSchema,
  type ReferenceRecord,
  type ReferenceResource,
} from "@examforge/shared";
import {
  ReferenceIntegrityError,
  type PlatformRepository,
} from "./repository.js";
import { createPlatformRepository } from "./repository-factory.js";
import {
  PythonSchedulerClient,
  type SchedulerClient,
} from "./scheduler-client.js";
import {
  AuditFilterValidationError,
  parseAuditEventFilter,
} from "./services/audit-service.js";
import { DraftService } from "./services/draft-service.js";
import { PublicationService } from "./services/publication-service.js";
import { ScheduleRunService } from "./services/schedule-run-service.js";

export interface AppOptions {
  repository?: PlatformRepository;
  scheduler?: SchedulerClient;
}

const scheduleRequestSchema = z.object({
  fixed_assignments: z.array(fixedAssignmentSchema).default([]),
  reschedule_context: rescheduleContextSchema.nullable().default(null),
}).strict();

export function createApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });
  const repository = options.repository ?? createPlatformRepository();
  const scheduler = options.scheduler ?? new PythonSchedulerClient();
  const scheduleRunService = new ScheduleRunService(repository, scheduler);
  const draftService = new DraftService(repository);
  const publicationService = new PublicationService(repository);

  app.register(cors, {
    origin: true,
  });

  app.get("/health", async () => ({
    ok: true,
    service: "examforge-api",
  }));

  app.get("/ready", async (_request, reply) => {
    try {
      await repository.checkReadiness();
      return {
        ok: true,
        service: "examforge-api",
        storage: repository.storageMode,
      };
    } catch {
      app.log.warn("Repository readiness check failed.");
      return reply.code(503).send({
        ok: false,
        service: "examforge-api",
        storage: repository.storageMode,
        error: "dependency_unavailable",
      });
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = z.object({
      username: z.string().min(1),
      password: z.string().min(1),
    }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_login_payload",
        message: "Login payload is invalid.",
        issues: parsed.error.issues,
      });
    }

    const user = getAuthUsers().find((candidate) => (
      candidate.username === parsed.data.username
      && candidate.password === parsed.data.password
    ));
    if (!user) {
      return reply.code(401).send({
        error: "invalid_credentials",
        message: "Username or password is invalid.",
      });
    }

    return {
      token: user.token,
      user: publicAuthUser(user),
    };
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = getRequestUser(request);
    if (!user) {
      return reply.code(401).send({
        error: "not_authenticated",
        message: "A valid bearer token is required.",
      });
    }
    return { user: publicAuthUser(user) };
  });

  app.addHook("onClose", async () => {
    await repository.close?.();
  });

  app.addHook("onReady", async () => {
    await scheduleRunService.recoverInterruptedJobs();
  });

  app.get("/api/dashboard", async () => repository.getDashboard());

  app.get("/api/reference-data", async () => repository.getReferenceData());

  app.post<{ Params: { resource: string } }>(
    "/api/reference-data/:resource/import",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin", "operator"])) {
        return reply;
      }
      const resource = parseReferenceResource(request.params.resource);
      if (!resource) {
        return reply.code(404).send({
          error: "reference_resource_not_found",
          message: `Reference resource ${request.params.resource} does not exist.`,
        });
      }

      const parsed = z.object({
        records: z.array(referenceRecordCreateSchemas[resource]).min(1).max(500),
      }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_reference_import",
          message: "Reference import payload is invalid.",
          issues: parsed.error.issues,
        });
      }

      try {
        return await repository.importReferenceRecords(
          resource,
          parsed.data.records as ReferenceRecord[],
        );
      } catch (error) {
        if (sendReferenceIntegrityError(reply, error)) {
          return reply;
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { resource: string } }>(
    "/api/reference-data/:resource",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin", "operator"])) {
        return reply;
      }
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

      try {
        const record = await repository.createReferenceRecord(
          resource,
          parsed.data as ReferenceRecord,
        );
        return reply.code(201).send({ resource, record });
      } catch (error) {
        if (sendReferenceIntegrityError(reply, error)) {
          return reply;
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: { resource: string; id: string } }>(
    "/api/reference-data/:resource/:id",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin", "operator"])) {
        return reply;
      }
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

      let record: ReferenceRecord | null;
      try {
        record = await repository.updateReferenceRecord(
          resource,
          request.params.id,
          parsed.data as Partial<ReferenceRecord>,
        );
      } catch (error) {
        if (sendReferenceIntegrityError(reply, error)) {
          return reply;
        }
        throw error;
      }
      if (!record) {
        return reply.code(404).send({
          error: "reference_record_not_found",
          message: `Reference record ${request.params.id} does not exist.`,
        });
      }

      return { resource, record };
    },
  );

  app.delete<{ Params: { resource: string; id: string } }>(
    "/api/reference-data/:resource/:id",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin"])) {
        return reply;
      }
      const resource = parseReferenceResource(request.params.resource);
      if (!resource) {
        return reply.code(404).send({
          error: "reference_resource_not_found",
          message: `Reference resource ${request.params.resource} does not exist.`,
        });
      }

      let response;
      try {
        response = await repository.deleteReferenceRecord(resource, request.params.id);
      } catch (error) {
        if (sendReferenceIntegrityError(reply, error)) {
          return reply;
        }
        throw error;
      }
      if (!response) {
        return reply.code(404).send({
          error: "reference_record_not_found",
          message: `Reference record ${request.params.id} does not exist.`,
        });
      }

      return response;
    },
  );

  app.patch<{ Params: { teacherId: string } }>(
    "/api/teachers/:teacherId/unavailable-slots",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin", "operator"])) {
        return reply;
      }
      const parsed = z.object({
        unavailable_slot_ids: z.array(z.string()).max(200),
      }).safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "invalid_teacher_unavailable_slots",
          message: "Teacher unavailable slots payload is invalid.",
          issues: parsed.error.issues,
        });
      }
      const teacher = await repository.updateReferenceRecord("teachers", request.params.teacherId, {
        unavailable_slot_ids: parsed.data.unavailable_slot_ids,
      });
      if (!teacher) {
        return reply.code(404).send({
          error: "teacher_not_found",
          message: `Teacher ${request.params.teacherId} does not exist.`,
        });
      }
      return { teacher };
    },
  );

  app.post("/api/schedule-runs", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "operator"])) {
      return reply;
    }
    const parsed = parseScheduleRequest(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_schedule_request",
        message: "Schedule request payload is invalid.",
        issues: parsed.error.issues,
      });
    }
    const response = await scheduleRunService.createScheduleRun(parsed.data);
    return reply.code(201).send(response);
  });

  app.post("/api/schedule-jobs", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "operator"])) {
      return reply;
    }
    const parsed = parseScheduleRequest(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_schedule_request",
        message: "Schedule job payload is invalid.",
        issues: parsed.error.issues,
      });
    }
    const job = await scheduleRunService.createScheduleJob(parsed.data);
    return reply.code(202).send({ job });
  });

  app.get("/api/schedule-jobs", async () => scheduleRunService.listScheduleJobs());

  app.get<{ Params: { id: string } }>("/api/schedule-jobs/:id", async (request, reply) => {
    const job = await scheduleRunService.getScheduleJob(request.params.id);
    if (!job) {
      return reply.code(404).send({
        error: "schedule_job_not_found",
        message: `Schedule job ${request.params.id} does not exist.`,
      });
    }
    return { job };
  });

  app.get("/api/schedule-runs", async () => repository.listScheduleRuns());

  app.post<{ Params: { id: string } }>(
    "/api/schedule-runs/:id/drafts",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin", "operator"])) {
        return reply;
      }
      const draft = await draftService.createFromRun(request.params.id);
      if (!draft) {
        return reply.code(404).send({
          error: "schedule_run_not_found",
          message: `Schedule run ${request.params.id} does not exist.`,
        });
      }
      return reply.code(201).send(draft);
    },
  );

  app.get("/api/schedule-drafts", async () => draftService.list());

  app.get<{ Params: { id: string } }>("/api/schedule-drafts/:id", async (request, reply) => {
    const draft = await draftService.get(request.params.id);
    if (!draft) {
      return reply.code(404).send({
        error: "schedule_draft_not_found",
        message: `Schedule draft ${request.params.id} does not exist.`,
      });
    }
    return draft;
  });

  app.post<{ Params: { id: string } }>(
    "/api/schedule-drafts/:id/reschedule",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin", "operator"])) {
        return reply;
      }
      const response = await scheduleRunService.createScheduleRunFromDraft(request.params.id);
      if (!response) {
        return reply.code(404).send({
          error: "schedule_draft_not_found",
          message: `Schedule draft ${request.params.id} does not exist.`,
        });
      }
      if (response === "not_editable") {
        return reply.code(409).send({
          error: "schedule_draft_not_editable",
          message: "Schedule draft is already published or discarded.",
        });
      }
      return reply.code(201).send(response);
    },
  );

  app.patch<{ Params: { id: string; examTaskId: string } }>(
    "/api/schedule-drafts/:id/assignments/:examTaskId",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin", "operator"])) {
        return reply;
      }
      const parsed = scheduledExamSchema
        .omit({ exam_task_id: true })
        .partial()
        .strict()
        .safeParse(request.body);
      if (!parsed.success || Object.keys(parsed.data).length === 0) {
        return reply.code(400).send({
          error: "invalid_schedule_draft_assignment",
          message: "Schedule draft assignment patch is invalid.",
          issues: parsed.success ? [] : parsed.error.issues,
        });
      }

      const draft = await draftService.updateAssignment(
        request.params.id,
        request.params.examTaskId,
        parsed.data,
      );
      if (draft === "not_editable") {
        return reply.code(409).send({
          error: "schedule_draft_not_editable",
          message: "Schedule draft is already published or discarded.",
        });
      }
      if (draft === "assignment_locked") {
        return reply.code(409).send({
          error: "schedule_draft_assignment_locked",
          message: "Schedule draft assignment is locked.",
        });
      }
      if (!draft) {
        return reply.code(404).send({
          error: "schedule_draft_assignment_not_found",
          message: "Schedule draft or assignment does not exist.",
        });
      }
      return draft;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/schedule-drafts/:id/validate",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin", "operator"])) {
        return reply;
      }
      const draft = await draftService.validate(request.params.id);
      if (draft === "not_editable") {
        return reply.code(409).send({
          error: "schedule_draft_not_editable",
          message: "Schedule draft is already published or discarded.",
        });
      }
      if (!draft) {
        return reply.code(404).send({
          error: "schedule_draft_not_found",
          message: `Schedule draft ${request.params.id} does not exist.`,
        });
      }
      return draft;
    },
  );

  app.get<{ Params: { id: string } }>("/api/schedule-drafts/:id/compare", async (request, reply) => {
    const comparison = await draftService.compare(request.params.id);
    if (!comparison) {
      return reply.code(404).send({
        error: "schedule_draft_not_found",
        message: `Schedule draft ${request.params.id} or its source run does not exist.`,
      });
    }
    return comparison;
  });

  app.get<{ Params: { id: string; examTaskId: string } }>(
    "/api/schedule-drafts/:id/assignments/:examTaskId/suggestions",
    async (request, reply) => {
      const suggestions = await draftService.suggestAssignment(
        request.params.id,
        request.params.examTaskId,
      );
      if (!suggestions) {
        return reply.code(404).send({
          error: "schedule_draft_assignment_not_found",
          message: "Schedule draft or assignment does not exist.",
        });
      }
      return suggestions;
    },
  );

  app.post<{ Params: { id: string; examTaskId: string } }>(
    "/api/schedule-drafts/:id/assignments/:examTaskId/lock",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin", "operator"])) {
        return reply;
      }
      const draft = await draftService.lockAssignment(request.params.id, request.params.examTaskId);
      if (draft === "not_editable") {
        return reply.code(409).send({
          error: "schedule_draft_not_editable",
          message: "Schedule draft is already published or discarded.",
        });
      }
      if (!draft) {
        return reply.code(404).send({
          error: "schedule_draft_assignment_not_found",
          message: "Schedule draft or assignment does not exist.",
        });
      }
      return draft;
    },
  );

  app.post<{ Params: { id: string; examTaskId: string } }>(
    "/api/schedule-drafts/:id/assignments/:examTaskId/unlock",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin", "operator"])) {
        return reply;
      }
      const draft = await draftService.unlockAssignment(request.params.id, request.params.examTaskId);
      if (draft === "not_editable") {
        return reply.code(409).send({
          error: "schedule_draft_not_editable",
          message: "Schedule draft is already published or discarded.",
        });
      }
      if (!draft) {
        return reply.code(404).send({
          error: "schedule_draft_assignment_not_found",
          message: "Schedule draft or assignment does not exist.",
        });
      }
      return draft;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/schedule-drafts/:id/rebalance",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin", "operator"])) {
        return reply;
      }
      const draft = await draftService.rebalance(request.params.id);
      if (!draft) {
        return reply.code(404).send({
          error: "schedule_draft_not_found",
          message: `Schedule draft ${request.params.id} does not exist.`,
        });
      }
      if (draft === "not_editable") {
        return reply.code(409).send({
          error: "schedule_draft_not_editable",
          message: "Schedule draft is already published or discarded.",
        });
      }
      return draft;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/schedule-drafts/:id/publish",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin"])) {
        return reply;
      }
      const published = await draftService.publish(request.params.id);
      if (!published) {
        return reply.code(404).send({
          error: "schedule_draft_not_found",
          message: `Schedule draft ${request.params.id} does not exist.`,
        });
      }
      if (published === "conflict") {
        return reply.code(409).send({
          error: "schedule_draft_has_conflicts",
          message: "Schedule draft has hard conflicts and cannot be published.",
        });
      }
      if (published === "not_publishable") {
        return reply.code(409).send({
          error: "schedule_draft_not_publishable",
          message: "Schedule draft is already published or discarded.",
        });
      }
      return published;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/schedule-drafts/:id/discard",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin", "operator"])) {
        return reply;
      }
      const discarded = await draftService.discard(request.params.id);
      if (!discarded) {
        return reply.code(404).send({
          error: "schedule_draft_not_found",
          message: `Schedule draft ${request.params.id} does not exist.`,
        });
      }
      if (discarded === "not_discardable") {
        return reply.code(409).send({
          error: "schedule_draft_not_discardable",
          message: "Schedule draft is already published or discarded.",
        });
      }
      return discarded;
    },
  );

  app.get<{
    Querystring: {
      baseId?: string;
      targetId?: string;
    };
  }>("/api/schedule-runs/compare", async (request, reply) => {
    const { baseId, targetId } = request.query;
    if (!baseId || !targetId) {
      return reply.code(400).send({
        error: "invalid_schedule_run_comparison",
        message: "baseId and targetId query parameters are required.",
      });
    }

    const comparison = await repository.compareScheduleRuns(baseId, targetId);
    if (!comparison) {
      return reply.code(404).send({
        error: "schedule_run_not_found",
        message: "One or both schedule runs do not exist.",
      });
    }

    return comparison;
  });

  app.get<{ Querystring: Record<string, unknown> }>("/api/audit-events", async (request, reply) => {
    try {
      return await repository.listAuditEvents(parseAuditEventFilter(request.query));
    } catch (error) {
      if (error instanceof AuditFilterValidationError) {
        return reply.code(400).send({
          error: "invalid_audit_filter",
          message: "Audit event filter is invalid.",
          issues: error.issues,
        });
      }
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>(
    "/api/schedule-runs/:id/publish",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin"])) {
        return reply;
      }
      const published = await publicationService.publishRun(request.params.id);
      if (!published) {
        return reply.code(404).send({
          error: "schedule_run_not_found",
          message: `Schedule run ${request.params.id} does not exist.`,
        });
      }
      return published;
    },
  );

  app.get("/api/published-schedule", async (_request, reply) => {
    const published = await publicationService.getPublishedSchedule();
    if (!published) {
      return reply.code(404).send({
        error: "published_schedule_not_found",
        message: "No schedule has been published.",
      });
    }
    return published;
  });

  app.get("/api/published-schedule/export.csv", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "operator", "viewer"])) {
      return reply;
    }
    const user = getRequestUser(request);
    const exported = await publicationService.exportCsv(user?.username ?? "unknown");
    if (!exported) {
      return reply.code(404).send({
        error: "published_schedule_not_found",
        message: "No schedule has been published.",
      });
    }
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .send(exported.csv);
  });

  app.get("/api/published-schedule/notifications", async (_request, reply) => {
    const notifications = await publicationService.getNotifications();
    if (!notifications) {
      return reply.code(404).send({
        error: "published_schedule_not_found",
        message: "No schedule has been published.",
      });
    }
    return notifications;
  });

  app.get<{ Params: { teacherId: string } }>(
    "/api/published-schedule/teachers/:teacherId",
    async (request, reply) => {
      const result = await publicationService.getAudience("teacher", request.params.teacherId);
      if (result.status === "not_published") {
        return reply.code(404).send({
          error: "published_schedule_not_found",
          message: "No schedule has been published.",
        });
      }
      if (result.status === "viewer_not_found") {
        return reply.code(404).send({
          error: "published_schedule_viewer_not_found",
          message: `Teacher ${request.params.teacherId} does not exist.`,
        });
      }
      return result.response;
    },
  );

  app.get<{ Params: { studentGroupId: string } }>(
    "/api/published-schedule/student-groups/:studentGroupId",
    async (request, reply) => {
      const result = await publicationService.getAudience(
        "student_group",
        request.params.studentGroupId,
      );
      if (result.status === "not_published") {
        return reply.code(404).send({
          error: "published_schedule_not_found",
          message: "No schedule has been published.",
        });
      }
      if (result.status === "viewer_not_found") {
        return reply.code(404).send({
          error: "published_schedule_viewer_not_found",
          message: `Student group ${request.params.studentGroupId} does not exist.`,
        });
      }
      return result.response;
    },
  );

  app.post("/api/published-schedule/rollback", async (request, reply) => {
    if (!requireRole(request, reply, ["admin"])) {
      return reply;
    }
    return publicationService.rollback();
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

function parseScheduleRequest(body: unknown) {
  return scheduleRequestSchema.safeParse(body ?? {});
}

type ExamForgeRole = "admin" | "operator" | "viewer";

interface AuthUser {
  id: string;
  username: string;
  password: string;
  displayName: string;
  role: ExamForgeRole;
  token: string;
}

function getAuthUsers(): AuthUser[] {
  return [
    {
      id: "user-admin",
      username: "admin",
      password: process.env.EXAMFORGE_ADMIN_PASSWORD ?? "admin",
      displayName: "系统管理员",
      role: "admin",
      token: process.env.EXAMFORGE_ADMIN_TOKEN ?? "examforge-admin-token",
    },
    {
      id: "user-operator",
      username: "operator",
      password: process.env.EXAMFORGE_OPERATOR_PASSWORD ?? "operator",
      displayName: "排考教务员",
      role: "operator",
      token: process.env.EXAMFORGE_OPERATOR_TOKEN ?? "examforge-operator-token",
    },
    {
      id: "user-viewer",
      username: "viewer",
      password: process.env.EXAMFORGE_VIEWER_PASSWORD ?? "viewer",
      displayName: "只读观察员",
      role: "viewer",
      token: process.env.EXAMFORGE_VIEWER_TOKEN ?? "examforge-viewer-token",
    },
  ];
}

function publicAuthUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

function getRequestUser(request: FastifyRequest): AuthUser | null {
  const raw = request.headers.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const token = match[1];
  return getAuthUsers().find((user) => user.token === token) ?? null;
}

function requireRole(
  request: FastifyRequest,
  reply: FastifyReply,
  allowed: ExamForgeRole[],
) {
  const user = getRequestUser(request);
  if (user && allowed.includes(user.role)) {
    return true;
  }
  reply.code(403).send({
    error: "permission_denied",
    message: user
      ? `Role ${user.role} is not allowed to perform this operation.`
      : "A valid bearer token is required to perform this operation.",
  });
  return false;
}

function sendReferenceIntegrityError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof ReferenceIntegrityError)) {
    return false;
  }
  reply.code(409).send({
    error: "reference_integrity_violation",
    message: "Reference data violates cross-resource integrity rules.",
    issues: error.issues,
  });
  return true;
}

function parseReferenceResource(value: string): ReferenceResource | null {
  const parsed = referenceResourceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
