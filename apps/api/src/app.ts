import cors from "@fastify/cors";
import Fastify from "fastify";
import { z } from "zod";
import {
  referenceRecordCreateSchemas,
  referenceRecordUpdateSchemas,
  referenceResourceSchema,
  scheduledExamSchema,
  type PublishedScheduleAudienceResponse,
  type PublishedScheduleResponse,
  type ReferenceDataResponse,
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
    "/api/reference-data/:resource/import",
    async (request, reply) => {
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

      return repository.importReferenceRecords(
        resource,
        parsed.data.records as ReferenceRecord[],
      );
    },
  );

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

  app.delete<{ Params: { resource: string; id: string } }>(
    "/api/reference-data/:resource/:id",
    async (request, reply) => {
      const resource = parseReferenceResource(request.params.resource);
      if (!resource) {
        return reply.code(404).send({
          error: "reference_resource_not_found",
          message: `Reference resource ${request.params.resource} does not exist.`,
        });
      }

      const response = await repository.deleteReferenceRecord(resource, request.params.id);
      if (!response) {
        return reply.code(404).send({
          error: "reference_record_not_found",
          message: `Reference record ${request.params.id} does not exist.`,
        });
      }

      return response;
    },
  );

  app.post("/api/schedule-runs", async (_request, reply) => {
    const referenceData = await repository.getReferenceData();
    const result = await scheduler.solve(referenceData.scheduleInput);
    const response = await repository.createScheduleRun(result);
    return reply.code(201).send(response);
  });

  app.get("/api/schedule-runs", async () => repository.listScheduleRuns());

  app.post<{ Params: { id: string } }>(
    "/api/schedule-runs/:id/drafts",
    async (request, reply) => {
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

  app.post<{ Params: { id: string } }>(
    "/api/schedule-drafts/:id/publish",
    async (request, reply) => {
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

  app.post("/api/published-schedule/rollback", async () => (
    repository.rollbackPublishedSchedule()
  ));

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
