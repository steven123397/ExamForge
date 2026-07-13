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
  loginRequestSchema,
  type AuthContext,
  type ReferenceRecord,
  type ReferenceResource,
  type UserRole,
} from "@examforge/shared";
import {
  ReferenceIntegrityError,
  ScheduleJobIdempotencyConflictError,
  type PlatformRepository,
} from "./repository.js";
import { createPlatformRepository } from "./repository-factory.js";
import {
  createSchedulerClient,
  SchedulerClientError,
  type SchedulerClient,
} from "./scheduler-client.js";
import {
  AuditFilterValidationError,
  parseAuditEventFilter,
} from "./services/audit-service.js";
import { DraftService } from "./services/draft-service.js";
import { PublicationService } from "./services/publication-service.js";
import { ScheduleRunService } from "./services/schedule-run-service.js";
import { AuthService } from "./auth/auth-service.js";
import { initializeConfiguredAuthUsers } from "./auth/bootstrap.js";
import { runWithAuthContext } from "./auth/request-context.js";
import {
  getSessionCookieConfig,
  readSessionCookie,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from "./auth/session-cookie.js";

export interface AppOptions {
  repository?: PlatformRepository;
  scheduler?: SchedulerClient;
}

const scheduleRequestSchema = z.object({
  fixed_assignments: z.array(fixedAssignmentSchema).default([]),
  reschedule_context: rescheduleContextSchema.nullable().default(null),
}).strict();

const anonymousReadRoutes = new Set([
  "/health",
  "/ready",
  "/api/auth/login",
  "/api/published-schedule",
  "/api/published-schedule/notifications",
  "/api/published-schedule/teachers/:teacherId",
  "/api/published-schedule/student-groups/:studentGroupId",
]);

const requestAuthContexts = new WeakMap<FastifyRequest, AuthContext>();

export function createApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });
  const repository = options.repository ?? createPlatformRepository();
  const scheduler = options.scheduler ?? createSchedulerClient();
  const scheduleRunService = new ScheduleRunService(repository, scheduler);
  const draftService = new DraftService(repository);
  const publicationService = new PublicationService(repository);
  const cookieConfig = getSessionCookieConfig();
  const authService = new AuthService(repository, cookieConfig.maxAgeSeconds * 1000);
  const trustedOrigins = getTrustedOrigins();

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SchedulerClientError) {
      return reply.code(schedulerHttpStatus(error)).send({
        error: error.code,
        message: error.message,
        category: error.category,
        retryable: error.retryable,
        requestId: error.requestId,
      });
    }
    if (isDatabaseIntegrityError(error)) {
      return reply.code(409).send({
        error: "data_integrity_violation",
        message: "The request conflicts with persisted data integrity constraints.",
      });
    }
    return reply.send(error);
  });

  app.register(cors, {
    origin: [...trustedOrigins],
    credentials: true,
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.method === "OPTIONS") {
      return;
    }
    if (isMutation(request.method) && !isTrustedOrigin(request.headers.origin, trustedOrigins)) {
      return reply.code(403).send({
        error: "untrusted_origin",
        message: "The request origin is not trusted.",
      });
    }
    const cookieHeader = Array.isArray(request.headers.cookie)
      ? request.headers.cookie[0]
      : request.headers.cookie;
    const context = await authService.authenticate(
      readSessionCookie(cookieHeader, cookieConfig.name),
    );
    if (context) {
      requestAuthContexts.set(request, context);
    }
    if (!anonymousReadRoutes.has(request.routeOptions.url ?? "") && !context) {
      return reply.code(401).send({
        error: "not_authenticated",
        message: "A valid server session is required.",
      });
    }
  });

  app.addHook("preHandler", (request, _reply, done) => {
    const context = getRequestAuthContext(request);
    if (context) {
      runWithAuthContext(context, done);
    } else {
      done();
    }
  });

  app.get("/health", async () => ({
    ok: true,
    service: "examforge-api",
  }));

  app.get("/ready", async (_request, reply) => {
    try {
      await repository.checkReadiness();
      await scheduler.checkReadiness?.();
      return {
        ok: true,
        service: "examforge-api",
        storage: repository.storageMode,
      };
    } catch {
      app.log.warn("API dependency readiness check failed.");
      return reply.code(503).send({
        ok: false,
        service: "examforge-api",
        storage: repository.storageMode,
        error: "dependency_unavailable",
      });
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_login_payload",
        message: "Login payload is invalid.",
        issues: parsed.error.issues,
      });
    }

    const result = await authService.login(parsed.data.username, parsed.data.password, {
      userAgent: request.headers["user-agent"] ?? null,
      ipAddress: request.ip,
    });
    if (result.status === "invalid_credentials") {
      return reply.code(401).send({
        error: "invalid_credentials",
        message: "Username or password is invalid.",
      });
    }
    if (result.status === "disabled") {
      return reply.code(403).send({
        error: "account_disabled",
        message: "This account is disabled.",
      });
    }
    return reply
      .header("set-cookie", serializeSessionCookie(
        result.token,
        cookieConfig,
        result.context.session.expiresAt,
      ))
      .send(result.context);
  });

  app.get("/api/auth/me", async (request, reply) => {
    return getRequestAuthContext(request);
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const context = getRequestAuthContext(request);
    if (context) {
      await authService.logout(context.session.id);
    }
    return reply
      .header("set-cookie", serializeExpiredSessionCookie(cookieConfig))
      .code(204)
      .send();
  });

  app.addHook("onClose", async () => {
    await repository.close?.();
  });

  app.addHook("onReady", async () => {
    await initializeConfiguredAuthUsers(repository);
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
      let teacher: ReferenceRecord | null;
      try {
        teacher = await repository.updateReferenceRecord("teachers", request.params.teacherId, {
          unavailable_slot_ids: parsed.data.unavailable_slot_ids,
        });
      } catch (error) {
        if (sendReferenceIntegrityError(reply, error)) {
          return reply;
        }
        throw error;
      }
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
    let job;
    try {
      job = await scheduleRunService.createScheduleJob(parsed.data, {
        idempotencyKey: request.headers["idempotency-key"] as string | undefined,
        traceId: request.id,
      });
    } catch (error) {
      if (error instanceof ScheduleJobIdempotencyConflictError) {
        return reply.code(409).send({
          error: "schedule_job_idempotency_conflict",
          message: "The idempotency key was already used for a different schedule request.",
        });
      }
      throw error;
    }
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
      if (published === "not_publishable") {
        return reply.code(409).send({
          error: "schedule_run_not_publishable",
          message: "Only complete, feasible schedule runs without hard conflicts can be published.",
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
    if (!requireRole(request, reply, ["admin", "operator", "teacher", "student"])) {
      return reply;
    }
    const context = getRequestAuthContext(request);
    const exported = await publicationService.exportCsv(context?.user.username ?? "unknown");
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

function getRequestAuthContext(request: FastifyRequest) {
  return requestAuthContexts.get(request) ?? null;
}

function requireRole(
  request: FastifyRequest,
  reply: FastifyReply,
  allowed: UserRole[],
) {
  const context = getRequestAuthContext(request);
  if (context && context.user.roles.some((role) => allowed.includes(role))) {
    return true;
  }
  reply.code(403).send({
    error: "permission_denied",
    message: context
      ? "The authenticated user does not have a required role."
      : "A valid server session is required to perform this operation.",
  });
  return false;
}

function getTrustedOrigins() {
  const configured = process.env.EXAMFORGE_TRUSTED_ORIGINS
    ?? "http://localhost:3000,http://127.0.0.1:3000";
  return new Set(configured.split(",").map((origin) => origin.trim()).filter(Boolean));
}

function isMutation(method: string) {
  return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
}

function isTrustedOrigin(origin: string | undefined, trustedOrigins: Set<string>) {
  return typeof origin === "string" && trustedOrigins.has(origin);
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

function isDatabaseIntegrityError(error: unknown): boolean {
  const integrityCodes = new Set(["23502", "23503", "23505", "23514"]);
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && integrityCodes.has(candidate.code)) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function schedulerHttpStatus(error: SchedulerClientError) {
  switch (error.category) {
    case "validation":
      return 422;
    case "timeout":
      return 504;
    case "unavailable":
      return 503;
    case "cancelled":
      return 409;
    case "protocol":
    case "internal":
      return 502;
  }
}

function parseReferenceResource(value: string): ReferenceResource | null {
  const parsed = referenceResourceSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
