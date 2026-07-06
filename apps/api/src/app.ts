import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  referenceRecordCreateSchemas,
  referenceRecordUpdateSchemas,
  referenceResourceSchema,
  scheduledExamSchema,
  type PublishedScheduleNotificationsResponse,
  type PublishedScheduleAudienceResponse,
  type PublishedScheduleResponse,
  type ReferenceDataResponse,
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
    const referenceData = await repository.getReferenceData();
    const result = await scheduler.solve(referenceData.scheduleInput);
    const response = await repository.createScheduleRun(result);
    return reply.code(201).send(response);
  });

  app.post("/api/schedule-jobs", async (request, reply) => {
    if (!requireRole(request, reply, ["admin", "operator"])) {
      return reply;
    }
    const job = await repository.createScheduleJob();
    setTimeout(() => {
      void runScheduleJob(job.id);
    }, 0);
    return reply.code(202).send({ job });
  });

  app.get("/api/schedule-jobs", async () => repository.listScheduleJobs());

  app.get<{ Params: { id: string } }>("/api/schedule-jobs/:id", async (request, reply) => {
    const job = await repository.getScheduleJob(request.params.id);
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
      const draft = await repository.createScheduleDraftFromRun(request.params.id);
      if (!draft) {
        return reply.code(404).send({
          error: "schedule_run_not_found",
          message: `Schedule run ${request.params.id} does not exist.`,
        });
      }
      return reply.code(201).send(draft);
    },
  );

  app.get("/api/schedule-drafts", async () => repository.listScheduleDrafts());

  app.get<{ Params: { id: string } }>("/api/schedule-drafts/:id", async (request, reply) => {
    const draft = await repository.getScheduleDraft(request.params.id);
    if (!draft) {
      return reply.code(404).send({
        error: "schedule_draft_not_found",
        message: `Schedule draft ${request.params.id} does not exist.`,
      });
    }
    return draft;
  });

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

      const draft = await repository.updateScheduleDraftAssignment(
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
      const draft = await repository.validateScheduleDraft(request.params.id);
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
    const comparison = await repository.compareScheduleDraft(request.params.id);
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
      const suggestions = await repository.suggestScheduleDraftAssignment(
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
      const draft = await repository.lockScheduleDraftAssignment(request.params.id, request.params.examTaskId);
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
      const draft = await repository.unlockScheduleDraftAssignment(request.params.id, request.params.examTaskId);
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
      const draft = await repository.rebalanceScheduleDraft(request.params.id);
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
      const published = await repository.publishScheduleDraft(request.params.id);
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
      const discarded = await repository.discardScheduleDraft(request.params.id);
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

  app.get("/api/audit-events", async () => repository.listAuditEvents());

  app.post<{ Params: { id: string } }>(
    "/api/schedule-runs/:id/publish",
    async (request, reply) => {
      if (!requireRole(request, reply, ["admin"])) {
        return reply;
      }
      const published = await repository.publishScheduleRun(request.params.id);
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
    const published = await repository.getPublishedSchedule();
    if (!published) {
      return reply.code(404).send({
        error: "published_schedule_not_found",
        message: "No schedule has been published.",
      });
    }
    return published;
  });

  app.get("/api/published-schedule/export.csv", async (_request, reply) => {
    const [referenceData, published] = await Promise.all([
      repository.getReferenceData(),
      repository.getPublishedSchedule(),
    ]);
    if (!published) {
      return reply.code(404).send({
        error: "published_schedule_not_found",
        message: "No schedule has been published.",
      });
    }
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .send(buildPublishedScheduleCsv(referenceData, published));
  });

  app.get("/api/published-schedule/notifications", async (_request, reply) => {
    const [referenceData, published] = await Promise.all([
      repository.getReferenceData(),
      repository.getPublishedSchedule(),
    ]);
    if (!published) {
      return reply.code(404).send({
        error: "published_schedule_not_found",
        message: "No schedule has been published.",
      });
    }
    return buildPublishedScheduleNotifications(referenceData, published);
  });

  app.get<{ Params: { teacherId: string } }>(
    "/api/published-schedule/teachers/:teacherId",
    async (request, reply) => {
      const [referenceData, published] = await Promise.all([
        repository.getReferenceData(),
        repository.getPublishedSchedule(),
      ]);
      if (!published) {
        return reply.code(404).send({
          error: "published_schedule_not_found",
          message: "No schedule has been published.",
        });
      }

      const response = buildPublishedScheduleAudience(
        referenceData,
        published,
        "teacher",
        request.params.teacherId,
      );
      if (!response) {
        return reply.code(404).send({
          error: "published_schedule_viewer_not_found",
          message: `Teacher ${request.params.teacherId} does not exist.`,
        });
      }

      return response;
    },
  );

  app.get<{ Params: { studentGroupId: string } }>(
    "/api/published-schedule/student-groups/:studentGroupId",
    async (request, reply) => {
      const [referenceData, published] = await Promise.all([
        repository.getReferenceData(),
        repository.getPublishedSchedule(),
      ]);
      if (!published) {
        return reply.code(404).send({
          error: "published_schedule_not_found",
          message: "No schedule has been published.",
        });
      }

      const response = buildPublishedScheduleAudience(
        referenceData,
        published,
        "student_group",
        request.params.studentGroupId,
      );
      if (!response) {
        return reply.code(404).send({
          error: "published_schedule_viewer_not_found",
          message: `Student group ${request.params.studentGroupId} does not exist.`,
        });
      }

      return response;
    },
  );

  app.post("/api/published-schedule/rollback", async (request, reply) => {
    if (!requireRole(request, reply, ["admin"])) {
      return reply;
    }
    return repository.rollbackPublishedSchedule();
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

  async function runScheduleJob(id: string) {
    const current = await repository.getScheduleJob(id);
    if (!current) {
      return;
    }
    await repository.updateScheduleJob(id, {
      status: "running",
      progress: 35,
    });
    try {
      const referenceData = await repository.getReferenceData();
      const result = await scheduler.solve(referenceData.scheduleInput);
      const response = await repository.createScheduleRun(result);
      await repository.updateScheduleJob(id, {
        status: "completed",
        progress: 100,
        runId: response.run.id,
      });
    } catch (error) {
      await repository.updateScheduleJob(id, {
        status: "failed",
        progress: 100,
        error: error instanceof Error ? error.message : "Schedule job failed.",
      });
    }
  }
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

function buildPublishedScheduleAudience(
  referenceData: ReferenceDataResponse,
  published: PublishedScheduleResponse,
  viewerType: "teacher" | "student_group",
  viewerId: string,
): PublishedScheduleAudienceResponse | null {
  const { scheduleInput } = referenceData;
  const teachers = new Map(scheduleInput.teachers.map((teacher) => [teacher.id, teacher]));
  const groups = new Map(scheduleInput.student_groups.map((group) => [group.id, group]));
  const courses = new Map(scheduleInput.courses.map((course) => [course.id, course]));
  const rooms = new Map(scheduleInput.rooms.map((room) => [room.id, room]));
  const slots = new Map(scheduleInput.time_slots.map((slot) => [slot.id, slot]));
  const tasks = new Map(scheduleInput.exam_tasks.map((task) => [task.id, task]));

  const viewer = viewerType === "teacher"
    ? teachers.get(viewerId)
    : groups.get(viewerId);
  if (!viewer) {
    return null;
  }

  const assignments = published.result.assignments
    .filter((assignment) => {
      const task = tasks.get(assignment.exam_task_id);
      return viewerType === "teacher"
        ? assignment.teacher_ids.includes(viewerId)
        : task?.student_group_ids.includes(viewerId);
    })
    .map((assignment) => {
      const task = tasks.get(assignment.exam_task_id) ?? null;
      return {
        assignment,
        examTask: task,
        course: task ? courses.get(task.course_id) ?? null : null,
        studentGroups: task
          ? task.student_group_ids.map((id) => groups.get(id)).filter((item) => item !== undefined)
          : [],
        room: rooms.get(assignment.room_id) ?? null,
        timeSlot: slots.get(assignment.time_slot_id) ?? null,
        teachers: assignment.teacher_ids.map((id) => teachers.get(id)).filter((item) => item !== undefined),
      };
    });

  return {
    batch: published.batch,
    run: published.run,
    viewer: {
      type: viewerType,
      id: viewer.id,
      name: viewer.name,
    },
    assignments,
  };
}

function buildPublishedScheduleNotifications(
  referenceData: ReferenceDataResponse,
  published: PublishedScheduleResponse,
): PublishedScheduleNotificationsResponse {
  const groups = new Map(referenceData.scheduleInput.student_groups.map((group) => [group.id, group]));
  const tasks = new Map(referenceData.scheduleInput.exam_tasks.map((task) => [task.id, task]));
  const counts = new Map<string, number>();
  for (const assignment of published.result.assignments) {
    const task = tasks.get(assignment.exam_task_id);
    for (const groupId of task?.student_group_ids ?? []) {
      counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
    }
  }
  return {
    batch: published.batch,
    run: published.run,
    notifications: [...counts.entries()].map(([studentGroupId, assignmentCount]) => {
      const group = groups.get(studentGroupId);
      return {
        id: `notice-${published.run.id}-${studentGroupId}`,
        studentGroupId,
        studentGroupName: group?.name ?? studentGroupId,
        assignmentCount,
        message: `${group?.name ?? studentGroupId} 的 ${assignmentCount} 场考试安排已发布，请及时查看最新考试时间和考场。`,
      };
    }),
  };
}

function buildPublishedScheduleCsv(
  referenceData: ReferenceDataResponse,
  published: PublishedScheduleResponse,
) {
  const courses = new Map(referenceData.scheduleInput.courses.map((course) => [course.id, course]));
  const rooms = new Map(referenceData.scheduleInput.rooms.map((room) => [room.id, room]));
  const slots = new Map(referenceData.scheduleInput.time_slots.map((slot) => [slot.id, slot]));
  const teachers = new Map(referenceData.scheduleInput.teachers.map((teacher) => [teacher.id, teacher]));
  const tasks = new Map(referenceData.scheduleInput.exam_tasks.map((task) => [task.id, task]));
  const rows = [["course", "time_slot", "room", "teachers"]];
  for (const assignment of published.result.assignments) {
    const task = tasks.get(assignment.exam_task_id);
    const slot = slots.get(assignment.time_slot_id);
    rows.push([
      csvCell(task ? courses.get(task.course_id)?.name ?? task.course_id : assignment.exam_task_id),
      csvCell(slot ? `${slot.date} ${slot.start_time}-${slot.end_time}` : assignment.time_slot_id),
      csvCell(rooms.get(assignment.room_id)?.name ?? assignment.room_id),
      csvCell(assignment.teacher_ids.map((id) => teachers.get(id)?.name ?? id).join("、")),
    ]);
  }
  return rows.map((row) => row.join(",")).join("\n");
}

function csvCell(value: string) {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
