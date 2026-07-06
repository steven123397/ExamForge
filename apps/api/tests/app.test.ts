import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ScheduleInput,
  type ScheduleResult,
} from "@examforge/shared";
import { createApp } from "../src/app.js";
import { InMemoryPlatformRepository } from "../src/repository.js";
import type { SchedulerClient } from "../src/scheduler-client.js";

class FakeScheduler implements SchedulerClient {
  lastInput: ScheduleInput | null = null;
  calls = 0;

  async solve(input: ScheduleInput): Promise<ScheduleResult> {
    this.lastInput = input;
    this.calls += 1;
    return {
      assignments: [
        {
          exam_task_id: input.exam_tasks[0].id,
          room_id: input.rooms[0].id,
          time_slot_id: input.time_slots[0].id,
          teacher_ids: [input.teachers[0].id],
        },
      ],
      conflicts: [],
      score: {
        total_score: 90 + this.calls,
        hard_violation_count: 0,
        soft_penalty_items: [],
      },
      statistics: {
        status: "feasible",
        elapsed_ms: 18,
        exam_count: input.exam_tasks.length,
        room_count: input.rooms.length,
        slot_count: input.time_slots.length,
        attempted_assignments: 42,
      },
      report: {
        summary: {
          status: "feasible",
        },
      },
    };
  }
}

class DraftWorkflowScheduler implements SchedulerClient {
  async solve(input: ScheduleInput): Promise<ScheduleResult> {
    return {
      assignments: [
        {
          exam_task_id: "e-data-structures",
          room_id: "r-101",
          time_slot_id: "s-001",
          teacher_ids: [input.teachers[0].id],
        },
        {
          exam_task_id: "e-database",
          room_id: "r-lab-1",
          time_slot_id: "s-003",
          teacher_ids: [input.teachers[1].id],
        },
      ],
      conflicts: [],
      score: {
        total_score: 94,
        hard_violation_count: 0,
        soft_penalty_items: [],
      },
      statistics: {
        status: "feasible",
        elapsed_ms: 22,
        exam_count: input.exam_tasks.length,
        room_count: input.rooms.length,
        slot_count: input.time_slots.length,
        attempted_assignments: 12,
      },
      report: {
        summary: {
          status: "feasible",
        },
      },
    };
  }
}

describe("ExamForge API", () => {
  it("returns dashboard data", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.batch.name, "2026 春季期末考试");
    assert.equal(body.metrics.examTaskCount, 6);
    await app.close();
  });

  it("creates and reads a schedule run", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });

    assert.equal(createResponse.statusCode, 201);
    const created = createResponse.json();
    assert.equal(created.run.status, "feasible");
    assert.equal(created.result.score.total_score, 91);

    const readResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/${created.run.id}`,
    });

    assert.equal(readResponse.statusCode, 200);
    assert.equal(readResponse.json().run.id, created.run.id);
    await app.close();
  });

  it("lists schedule runs, audit events, and compares two runs", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });
    const first = firstResponse.json();
    const second = secondResponse.json();

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/schedule-runs",
    });
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(
      listResponse.json().runs.map((run: { id: string }) => run.id),
      [second.run.id, first.run.id],
    );

    const auditResponse = await app.inject({
      method: "GET",
      url: "/api/audit-events",
    });
    assert.equal(auditResponse.statusCode, 200);
    assert.equal(auditResponse.json().events.length, 2);
    assert.equal(auditResponse.json().events[0].action, "schedule_run.created");

    const compareResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/compare?baseId=${first.run.id}&targetId=${second.run.id}`,
    });
    assert.equal(compareResponse.statusCode, 200);
    assert.equal(compareResponse.json().baseRun.id, first.run.id);
    assert.equal(compareResponse.json().targetRun.id, second.run.id);
    assert.equal(compareResponse.json().deltas.score, 1);

    await app.close();
  });

  it("publishes and rolls back a schedule run", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });
    const created = createResponse.json();

    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${created.run.id}/publish`,
    });
    assert.equal(publishResponse.statusCode, 200);
    assert.equal(publishResponse.json().batch.status, "published");
    assert.equal(publishResponse.json().run.id, created.run.id);

    const publishedResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule",
    });
    assert.equal(publishedResponse.statusCode, 200);
    assert.equal(publishedResponse.json().run.id, created.run.id);

    const rollbackResponse = await app.inject({
      method: "POST",
      url: "/api/published-schedule/rollback",
    });
    assert.equal(rollbackResponse.statusCode, 200);
    assert.equal(rollbackResponse.json().batch.status, "ready");

    const afterRollbackResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule",
    });
    assert.equal(afterRollbackResponse.statusCode, 404);

    await app.close();
  });

  it("queries published schedules by teacher and student group", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });
    const referenceResponse = await app.inject({
      method: "GET",
      url: "/api/reference-data",
    });
    const referenceData = referenceResponse.json();
    const teacher = referenceData.scheduleInput.teachers[0];
    const studentGroup = referenceData.scheduleInput.student_groups[0];

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${created.run.id}/publish`,
    });

    const teacherResponse = await app.inject({
      method: "GET",
      url: `/api/published-schedule/teachers/${teacher.id}`,
    });
    assert.equal(teacherResponse.statusCode, 200);
    assert.equal(teacherResponse.json().viewer.id, teacher.id);
    assert.equal(teacherResponse.json().assignments.length, 1);
    assert.equal(teacherResponse.json().assignments[0].teachers[0].id, teacher.id);

    const studentResponse = await app.inject({
      method: "GET",
      url: `/api/published-schedule/student-groups/${studentGroup.id}`,
    });
    assert.equal(studentResponse.statusCode, 200);
    assert.equal(studentResponse.json().viewer.id, studentGroup.id);
    assert.equal(studentResponse.json().assignments.length, 1);
    assert.equal(studentResponse.json().assignments[0].studentGroups[0].id, studentGroup.id);

    await app.close();
  });

  it("uses reference data from the configured repository when creating a schedule run", async () => {
    const scheduler = new FakeScheduler();
    const repository = new InMemoryPlatformRepository();
    const referenceData = structuredClone(await repository.getReferenceData());
    referenceData.scheduleInput.exam_tasks = [referenceData.scheduleInput.exam_tasks[0]];

    const app = createApp({
      scheduler,
      repository: {
        ...repository,
        getDashboard: () => repository.getDashboard(),
        getReferenceData: async () => referenceData,
        createReferenceRecord: (resource, record) => repository.createReferenceRecord(resource, record),
        updateReferenceRecord: (resource, id, patch) => repository.updateReferenceRecord(resource, id, patch),
        importReferenceRecords: (resource, records) => repository.importReferenceRecords(resource, records),
        deleteReferenceRecord: (resource, id) => repository.deleteReferenceRecord(resource, id),
        createScheduleRun: (result) => repository.createScheduleRun(result),
        listScheduleRuns: () => repository.listScheduleRuns(),
        getScheduleRun: (id) => repository.getScheduleRun(id),
        compareScheduleRuns: (baseId, targetId) => repository.compareScheduleRuns(baseId, targetId),
        listAuditEvents: () => repository.listAuditEvents(),
        publishScheduleRun: (id) => repository.publishScheduleRun(id),
        getPublishedSchedule: () => repository.getPublishedSchedule(),
        rollbackPublishedSchedule: () => repository.rollbackPublishedSchedule(),
        createScheduleDraftFromRun: (id) => repository.createScheduleDraftFromRun(id),
        listScheduleDrafts: () => repository.listScheduleDrafts(),
        getScheduleDraft: (id) => repository.getScheduleDraft(id),
        updateScheduleDraftAssignment: (id, examTaskId, patch) => (
          repository.updateScheduleDraftAssignment(id, examTaskId, patch)
        ),
        validateScheduleDraft: (id) => repository.validateScheduleDraft(id),
        compareScheduleDraft: (id) => repository.compareScheduleDraft(id),
        publishScheduleDraft: (id) => repository.publishScheduleDraft(id),
        discardScheduleDraft: (id) => repository.discardScheduleDraft(id),
      },
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });

    assert.equal(createResponse.statusCode, 201);
    assert.equal(scheduler.lastInput?.exam_tasks.length, 1);
    await app.close();
  });

  it("creates and updates reference data records", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/reference-data/courses",
      payload: {
        id: "c-linear-algebra",
        name: "线性代数",
        department_id: "math",
        exam_type: "written",
      },
    });

    assert.equal(createResponse.statusCode, 201);
    assert.equal(createResponse.json().record.name, "线性代数");

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/api/reference-data/courses/c-linear-algebra",
      payload: {
        name: "线性代数 A",
        exam_type: "oral",
      },
    });

    assert.equal(updateResponse.statusCode, 200);
    assert.equal(updateResponse.json().record.name, "线性代数 A");
    assert.equal(updateResponse.json().record.exam_type, "oral");

    const referenceResponse = await app.inject({
      method: "GET",
      url: "/api/reference-data",
    });
    const courses = referenceResponse.json().scheduleInput.courses;
    assert.ok(courses.some((course: { id: string; name: string }) => (
      course.id === "c-linear-algebra" && course.name === "线性代数 A"
    )));

    await app.close();
  });

  it("imports and deletes reference data records", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const importResponse = await app.inject({
      method: "POST",
      url: "/api/reference-data/time-slots/import",
      payload: {
        records: [
          {
            id: "slot-import-a",
            date: "2026-06-21",
            start_time: "08:30",
            end_time: "10:30",
            period_index: 20,
          },
          {
            id: "slot-import-b",
            date: "2026-06-21",
            start_time: "14:00",
            end_time: "16:00",
            period_index: 21,
          },
        ],
      },
    });
    assert.equal(importResponse.statusCode, 200);
    assert.equal(importResponse.json().records.length, 2);

    const upsertResponse = await app.inject({
      method: "POST",
      url: "/api/reference-data/time-slots/import",
      payload: {
        records: [
          {
            id: "slot-import-a",
            date: "2026-06-22",
            start_time: "09:00",
            end_time: "11:00",
            period_index: 22,
          },
        ],
      },
    });
    assert.equal(upsertResponse.statusCode, 200);
    assert.equal(upsertResponse.json().records[0].date, "2026-06-22");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/reference-data/time-slots/slot-import-b",
    });
    assert.equal(deleteResponse.statusCode, 200);
    assert.equal(deleteResponse.json().deleted.id, "slot-import-b");

    const referenceResponse = await app.inject({
      method: "GET",
      url: "/api/reference-data",
    });
    const slots = referenceResponse.json().scheduleInput.time_slots;
    assert.ok(slots.some((slot: { id: string; date: string }) => (
      slot.id === "slot-import-a" && slot.date === "2026-06-22"
    )));
    assert.ok(!slots.some((slot: { id: string }) => slot.id === "slot-import-b"));

    await app.close();
  });

  it("rejects invalid reference data payloads", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const response = await app.inject({
      method: "POST",
      url: "/api/reference-data/rooms",
      payload: {
        id: "r-invalid",
        name: "容量错误考场",
        building_id: "test",
        capacity: -1,
        room_type: "standard",
        equipment_tags: [],
      },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "invalid_reference_data");

    await app.close();
  });

  it("creates, adjusts, validates, and publishes a schedule draft", async () => {
    const app = createApp({ scheduler: new DraftWorkflowScheduler() });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });
    assert.equal(runResponse.statusCode, 201);
    const run = runResponse.json();

    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
    });
    assert.equal(draftResponse.statusCode, 201);
    const createdDraft = draftResponse.json();
    assert.equal(createdDraft.draft.sourceRunId, run.run.id);
    assert.equal(createdDraft.draft.status, "validated");
    assert.equal(createdDraft.assignments.length, 2);
    assert.equal(createdDraft.conflicts.length, 0);

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/schedule-drafts",
    });
    assert.equal(listResponse.statusCode, 200);
    assert.deepEqual(
      listResponse.json().drafts.map((draft: { id: string }) => draft.id),
      [createdDraft.draft.id],
    );

    const conflictingAdjustment = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${createdDraft.draft.id}/assignments/e-database`,
      payload: {
        room_id: "r-101",
        time_slot_id: "s-001",
        teacher_ids: ["t-zhang"],
      },
    });
    assert.equal(conflictingAdjustment.statusCode, 200);
    const blockedDraft = conflictingAdjustment.json();
    assert.equal(blockedDraft.draft.status, "blocked");
    assert.ok(blockedDraft.conflicts.some((conflict: { type: string }) => (
      conflict.type === "room_time_unique"
    )));
    assert.ok(blockedDraft.conflicts.some((conflict: { type: string }) => (
      conflict.type === "teacher_time_unique"
    )));
    assert.equal(blockedDraft.changeEvents.length, 1);

    const blockedPublish = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${createdDraft.draft.id}/publish`,
    });
    assert.equal(blockedPublish.statusCode, 409);
    assert.equal(blockedPublish.json().error, "schedule_draft_has_conflicts");

    const fixedAdjustment = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${createdDraft.draft.id}/assignments/e-database`,
      payload: {
        room_id: "r-lab-2",
        time_slot_id: "s-005",
        teacher_ids: ["t-li"],
      },
    });
    assert.equal(fixedAdjustment.statusCode, 200);
    const fixedDraft = fixedAdjustment.json();
    assert.equal(fixedDraft.draft.status, "validated");
    assert.equal(fixedDraft.conflicts.length, 0);
    assert.equal(fixedDraft.changeEvents.length, 2);

    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${createdDraft.draft.id}/publish`,
    });
    assert.equal(publishResponse.statusCode, 200);
    assert.equal(publishResponse.json().batch.status, "published");
    assert.equal(publishResponse.json().result.assignments.length, 2);
    assert.equal(publishResponse.json().result.assignments[1].room_id, "r-lab-2");

    const publishedResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule",
    });
    assert.equal(publishedResponse.statusCode, 200);
    assert.equal(publishedResponse.json().run.id, publishResponse.json().run.id);

    await app.close();
  });

  it("compares a draft against source and published versions, then discards it", async () => {
    const app = createApp({ scheduler: new DraftWorkflowScheduler() });

    const baselineRunResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });
    const baselineRun = baselineRunResponse.json();
    await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${baselineRun.run.id}/publish`,
    });

    const sourceRunResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });
    const sourceRun = sourceRunResponse.json();
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${sourceRun.run.id}/drafts`,
    });
    const draft = draftResponse.json();

    await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      payload: {
        room_id: "r-lab-2",
        time_slot_id: "s-005",
        teacher_ids: ["t-li"],
      },
    });

    const compareResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-drafts/${draft.draft.id}/compare`,
    });
    assert.equal(compareResponse.statusCode, 200);
    const comparison = compareResponse.json();
    assert.equal(comparison.source.run.id, sourceRun.run.id);
    assert.equal(comparison.source.assignmentChanges.changed.length, 1);
    assert.equal(comparison.published.run.id, baselineRun.run.id);
    assert.equal(comparison.published.assignmentChanges.changed.length, 1);
    assert.equal(comparison.summary.changedFromSource, 1);
    assert.equal(comparison.summary.changedFromPublished, 1);

    const discardResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/discard`,
    });
    assert.equal(discardResponse.statusCode, 200);
    assert.equal(discardResponse.json().draft.status, "discarded");

    const updateAfterDiscard = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      payload: {
        room_id: "r-lab-1",
      },
    });
    assert.equal(updateAfterDiscard.statusCode, 409);
    assert.equal(updateAfterDiscard.json().error, "schedule_draft_not_editable");

    const publishAfterDiscard = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/publish`,
    });
    assert.equal(publishAfterDiscard.statusCode, 409);
    assert.equal(publishAfterDiscard.json().error, "schedule_draft_not_publishable");

    const auditResponse = await app.inject({
      method: "GET",
      url: "/api/audit-events",
    });
    assert.equal(auditResponse.statusCode, 200);
    assert.ok(auditResponse.json().events.some((event: { action: string }) => (
      event.action === "schedule_draft.discarded"
    )));

    await app.close();
  });
});
