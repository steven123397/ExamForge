import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  criticalMigrationTables,
  draftScheduledExams,
  loadMigrationFiles,
  migrationStateTableName,
  scheduleJobs,
} from "@examforge/db";
import {
  type ScheduleInput,
  type ScheduleResult,
} from "@examforge/shared";
import { createApp } from "../src/app.js";
import { InMemoryPlatformRepository } from "../src/repository.js";
import type { SchedulerClient } from "../src/scheduler-client.js";

const adminHeaders = { authorization: "Bearer examforge-admin-token" };
const operatorHeaders = { authorization: "Bearer examforge-operator-token" };
const viewerHeaders = { authorization: "Bearer examforge-viewer-token" };

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
      headers: operatorHeaders,
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

  it("authenticates users with bearer tokens instead of trusting role headers", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const loginResponse = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "operator",
        password: "operator",
      },
    });
    assert.equal(loginResponse.statusCode, 200);
    assert.equal(loginResponse.json().user.role, "operator");
    assert.ok(loginResponse.json().token);

    const authenticatedResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: {
        authorization: `Bearer ${loginResponse.json().token}`,
      },
    });
    assert.equal(authenticatedResponse.statusCode, 201);

    const missingRoleResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
    });
    assert.equal(missingRoleResponse.statusCode, 403);
    assert.equal(missingRoleResponse.json().error, "permission_denied");

    const invalidRoleResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: {
        authorization: "Bearer invalid-token",
      },
    });
    assert.equal(invalidRoleResponse.statusCode, 403);
    assert.equal(invalidRoleResponse.json().error, "permission_denied");

    const forgedRoleHeaderResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: {
        "x-examforge-role": "admin",
      },
    });
    assert.equal(forgedRoleHeaderResponse.statusCode, 403);
    assert.equal(forgedRoleHeaderResponse.json().error, "permission_denied");

    await app.close();
  });

  it("lists schedule runs, audit events, and compares two runs", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
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

    const filteredAuditResponse = await app.inject({
      method: "GET",
      url: `/api/audit-events?entityType=schedule_run&entityId=${first.run.id}&actor=system`,
    });
    assert.equal(filteredAuditResponse.statusCode, 200);
    assert.deepEqual(
      filteredAuditResponse.json().events.map((event: { entityId: string }) => event.entityId),
      [first.run.id],
    );

    const invalidAuditFilterResponse = await app.inject({
      method: "GET",
      url: "/api/audit-events?since=not-a-date",
    });
    assert.equal(invalidAuditFilterResponse.statusCode, 400);
    assert.equal(invalidAuditFilterResponse.json().error, "invalid_audit_filter");

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
      headers: operatorHeaders,
    });
    const created = createResponse.json();

    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${created.run.id}/publish`,
      headers: adminHeaders,
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
      headers: adminHeaders,
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
      headers: operatorHeaders,
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${created.run.id}/publish`,
      headers: adminHeaders,
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
        listAuditEvents: (filter) => repository.listAuditEvents(filter),
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
        suggestScheduleDraftAssignment: (id, examTaskId) => repository.suggestScheduleDraftAssignment(id, examTaskId),
        lockScheduleDraftAssignment: (id, examTaskId) => repository.lockScheduleDraftAssignment(id, examTaskId),
        unlockScheduleDraftAssignment: (id, examTaskId) => repository.unlockScheduleDraftAssignment(id, examTaskId),
        rebalanceScheduleDraft: (id) => repository.rebalanceScheduleDraft(id),
        publishScheduleDraft: (id) => repository.publishScheduleDraft(id),
        discardScheduleDraft: (id) => repository.discardScheduleDraft(id),
        createScheduleJob: () => repository.createScheduleJob(),
        listScheduleJobs: () => repository.listScheduleJobs(),
        getScheduleJob: (id) => repository.getScheduleJob(id),
        updateScheduleJob: (id, patch) => repository.updateScheduleJob(id, patch),
      },
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
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
      headers: operatorHeaders,
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
      headers: operatorHeaders,
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
      headers: operatorHeaders,
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
      headers: operatorHeaders,
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
      headers: adminHeaders,
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
      headers: operatorHeaders,
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

  it("validates room building identifiers", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const invalidResponse = await app.inject({
      method: "POST",
      url: "/api/reference-data/rooms",
      headers: operatorHeaders,
      payload: {
        id: "r-invalid-building",
        name: "楼栋错误考场",
        building_id: "Test Building",
        capacity: 40,
        room_type: "standard",
        equipment_tags: [],
      },
    });
    assert.equal(invalidResponse.statusCode, 409);
    assert.equal(invalidResponse.json().error, "reference_integrity_violation");

    const validResponse = await app.inject({
      method: "POST",
      url: "/api/reference-data/rooms",
      headers: operatorHeaders,
      payload: {
        id: "r-valid-building",
        name: "楼栋合法考场",
        building_id: "test-building",
        capacity: 40,
        room_type: "standard",
        equipment_tags: [],
      },
    });
    assert.equal(validResponse.statusCode, 201);
    assert.equal(validResponse.json().record.building_id, "test-building");

    await app.close();
  });

  it("rejects reference records that point at missing resources", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/reference-data/exam-tasks",
      headers: operatorHeaders,
      payload: {
        id: "e-missing-course",
        course_id: "c-missing",
        student_group_ids: ["g-cs-2301"],
        expected_count: 42,
        duration_minutes: 120,
        required_room_type: "standard",
        required_equipment_tags: [],
        allowed_slot_ids: ["s-001"],
        invigilator_count: 1,
      },
    });
    assert.equal(createResponse.statusCode, 409);
    assert.equal(createResponse.json().error, "reference_integrity_violation");

    const updateResponse = await app.inject({
      method: "PATCH",
      url: "/api/reference-data/exam-tasks/e-data-structures",
      headers: operatorHeaders,
      payload: {
        student_group_ids: ["g-missing"],
      },
    });
    assert.equal(updateResponse.statusCode, 409);
    assert.equal(updateResponse.json().error, "reference_integrity_violation");

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/api/reference-data/courses/c-data-structures",
      headers: adminHeaders,
    });
    assert.equal(deleteResponse.statusCode, 409);
    assert.equal(deleteResponse.json().error, "reference_integrity_violation");

    await app.close();
  });

  it("creates, adjusts, validates, and publishes a schedule draft", async () => {
    const app = createApp({ scheduler: new DraftWorkflowScheduler() });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    assert.equal(runResponse.statusCode, 201);
    const run = runResponse.json();

    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
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
      headers: operatorHeaders,
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
      headers: adminHeaders,
    });
    assert.equal(blockedPublish.statusCode, 409);
    assert.equal(blockedPublish.json().error, "schedule_draft_has_conflicts");

    const fixedAdjustment = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${createdDraft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
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
      headers: adminHeaders,
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

  it("treats empty allowed slot lists as unrestricted during draft validation", async () => {
    const repository = new InMemoryPlatformRepository();
    const referenceData = structuredClone(await repository.getReferenceData());
    referenceData.scheduleInput.exam_tasks = referenceData.scheduleInput.exam_tasks.map((task) => (
      task.id === "e-data-structures"
        ? { ...task, allowed_slot_ids: [] }
        : task
    ));
    (repository as unknown as { scheduleInput: ScheduleInput }).scheduleInput = referenceData.scheduleInput;
    const app = createApp({ scheduler: new DraftWorkflowScheduler(), repository });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    assert.equal(runResponse.statusCode, 201);
    const run = runResponse.json();

    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
    });
    assert.equal(draftResponse.statusCode, 201);
    const draft = draftResponse.json();
    assert.equal(draft.draft.status, "validated");
    assert.ok(!draft.conflicts.some((conflict: { type: string }) => conflict.type === "allowed_slot"));

    const publishResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/publish`,
      headers: adminHeaders,
    });
    assert.equal(publishResponse.statusCode, 200);
    assert.equal(publishResponse.json().batch.status, "published");

    await app.close();
  });

  it("compares a draft against source and published versions, then discards it", async () => {
    const app = createApp({ scheduler: new DraftWorkflowScheduler() });

    const baselineRunResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const baselineRun = baselineRunResponse.json();
    await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${baselineRun.run.id}/publish`,
      headers: adminHeaders,
    });

    const sourceRunResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const sourceRun = sourceRunResponse.json();
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${sourceRun.run.id}/drafts`,
      headers: operatorHeaders,
    });
    const draft = draftResponse.json();

    await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
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
      headers: operatorHeaders,
    });
    assert.equal(discardResponse.statusCode, 200);
    assert.equal(discardResponse.json().draft.status, "discarded");

    const updateAfterDiscard = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-lab-1",
      },
    });
    assert.equal(updateAfterDiscard.statusCode, 409);
    assert.equal(updateAfterDiscard.json().error, "schedule_draft_not_editable");

    const publishAfterDiscard = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/publish`,
      headers: adminHeaders,
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

  it("suggests local draft adjustments and applies a conflict-free candidate", async () => {
    const app = createApp({ scheduler: new DraftWorkflowScheduler() });

    const runResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const run = runResponse.json();
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
    });
    const draft = draftResponse.json();

    await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-101",
        time_slot_id: "s-001",
        teacher_ids: ["t-zhang"],
      },
    });

    const suggestionsResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database/suggestions`,
    });

    assert.equal(suggestionsResponse.statusCode, 200);
    const suggestions = suggestionsResponse.json();
    assert.equal(suggestions.examTaskId, "e-database");
    assert.ok(suggestions.suggestions.length > 0);
    assert.equal(suggestions.suggestions[0].hardConflictCount, 0);
    assert.equal(suggestions.suggestions[0].assignment.exam_task_id, "e-database");
    assert.ok(suggestions.suggestions[0].reasons.length > 0);

    const appliedSuggestion = suggestions.suggestions[0].assignment;
    const fixedResponse = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: appliedSuggestion.room_id,
        time_slot_id: appliedSuggestion.time_slot_id,
        teacher_ids: appliedSuggestion.teacher_ids,
      },
    });

    assert.equal(fixedResponse.statusCode, 200);
    assert.equal(fixedResponse.json().draft.status, "validated");
    assert.equal(fixedResponse.json().conflicts.length, 0);

    await app.close();
  });

  it("creates asynchronous schedule jobs and exposes progress until a run is created", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: operatorHeaders,
    });
    assert.equal(createResponse.statusCode, 202);
    const created = createResponse.json();
    assert.equal(created.job.status, "queued");
    assert.equal(created.job.progress, 0);

    await waitFor(async () => {
      const response = await app.inject({
        method: "GET",
        url: `/api/schedule-jobs/${created.job.id}`,
      });
      const payload = response.json();
      return payload.job.status === "completed" && payload.job.runId;
    });

    const jobResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-jobs/${created.job.id}`,
    });
    assert.equal(jobResponse.statusCode, 200);
    assert.equal(jobResponse.json().job.status, "completed");
    assert.equal(jobResponse.json().job.progress, 100);

    const runResponse = await app.inject({
      method: "GET",
      url: `/api/schedule-runs/${jobResponse.json().job.runId}`,
    });
    assert.equal(runResponse.statusCode, 200);

    await app.close();
  });

  it("persists asynchronous schedule jobs through app recreation", async () => {
    const repository = new InMemoryPlatformRepository();
    const firstApp = createApp({ scheduler: new FakeScheduler(), repository });

    const createResponse = await firstApp.inject({
      method: "POST",
      url: "/api/schedule-jobs",
      headers: operatorHeaders,
    });
    assert.equal(createResponse.statusCode, 202);
    const created = createResponse.json();

    await waitFor(async () => {
      const response = await firstApp.inject({
        method: "GET",
        url: `/api/schedule-jobs/${created.job.id}`,
      });
      return response.json().job.status === "completed";
    });
    await firstApp.close();

    const secondApp = createApp({ scheduler: new FakeScheduler(), repository });
    const restoredResponse = await secondApp.inject({
      method: "GET",
      url: `/api/schedule-jobs/${created.job.id}`,
    });
    assert.equal(restoredResponse.statusCode, 200);
    assert.equal(restoredResponse.json().job.status, "completed");
    assert.ok(restoredResponse.json().job.runId);

    await secondApp.close();
  });

  it("marks interrupted asynchronous schedule jobs as failed on startup", async () => {
    const repository = new InMemoryPlatformRepository();
    const queuedJob = await repository.createScheduleJob();
    const runningJob = await repository.createScheduleJob();
    await repository.updateScheduleJob(runningJob.id, {
      status: "running",
      progress: 35,
    });

    const app = createApp({ scheduler: new FakeScheduler(), repository });
    await app.ready();

    const response = await app.inject({
      method: "GET",
      url: "/api/schedule-jobs",
    });
    assert.equal(response.statusCode, 200);
    const jobs = response.json().jobs;
    const restoredQueuedJob = jobs.find((job: { id: string }) => job.id === queuedJob.id);
    const restoredRunningJob = jobs.find((job: { id: string }) => job.id === runningJob.id);
    assert.equal(restoredQueuedJob.status, "failed");
    assert.equal(restoredQueuedJob.progress, 100);
    assert.match(restoredQueuedJob.error, /interrupted/i);
    assert.equal(restoredRunningJob.status, "failed");
    assert.equal(restoredRunningJob.progress, 100);
    assert.match(restoredRunningJob.error, /interrupted/i);

    await app.close();
  });

  it("locks draft assignments and rebalances only unlocked conflicted exams", async () => {
    const app = createApp({ scheduler: new DraftWorkflowScheduler() });

    const runResponse = await app.inject({ method: "POST", url: "/api/schedule-runs", headers: operatorHeaders });
    const run = runResponse.json();
    const draftResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${run.run.id}/drafts`,
      headers: operatorHeaders,
    });
    const draft = draftResponse.json();

    const lockResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-data-structures/lock`,
      headers: operatorHeaders,
    });
    assert.equal(lockResponse.statusCode, 200);
    assert.deepEqual(lockResponse.json().lockedExamTaskIds, ["e-data-structures"]);

    const lockedUpdateResponse = await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-data-structures`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-lab-1",
      },
    });
    assert.equal(lockedUpdateResponse.statusCode, 409);
    assert.equal(lockedUpdateResponse.json().error, "schedule_draft_assignment_locked");

    await app.inject({
      method: "PATCH",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-database`,
      headers: operatorHeaders,
      payload: {
        room_id: "r-101",
        time_slot_id: "s-001",
        teacher_ids: ["t-zhang"],
      },
    });

    const rebalanceResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/rebalance`,
      headers: operatorHeaders,
    });
    assert.equal(rebalanceResponse.statusCode, 200);
    assert.equal(rebalanceResponse.json().draft.status, "validated");
    assert.equal(rebalanceResponse.json().conflicts.length, 0);
    assert.deepEqual(rebalanceResponse.json().lockedExamTaskIds, ["e-data-structures"]);

    const unlockResponse = await app.inject({
      method: "POST",
      url: `/api/schedule-drafts/${draft.draft.id}/assignments/e-data-structures/unlock`,
      headers: operatorHeaders,
    });
    assert.equal(unlockResponse.statusCode, 200);
    assert.deepEqual(unlockResponse.json().lockedExamTaskIds, []);

    await app.close();
  });

  it("exposes persistent draft assignment locks in the database schema", () => {
    assert.ok("locked" in draftScheduledExams);
  });

  it("exposes migration state, job persistence, and integrity constraints", async () => {
    assert.equal(migrationStateTableName, "schema_migrations");
    assert.ok("status" in scheduleJobs);
    assert.ok(criticalMigrationTables.includes("exam_task_student_groups"));
    assert.ok(criticalMigrationTables.includes("scheduled_exam_invigilators"));
    assert.ok(criticalMigrationTables.includes("draft_exam_invigilators"));
    assert.ok(criticalMigrationTables.includes("teacher_unavailable_slots"));

    const migrations = await loadMigrationFiles();
    const sql = migrations.map((migration) => migration.sql).join("\n");
    assert.ok(migrations.some((migration) => migration.id === "0005_auth_jobs_constraints"));
    assert.ok(migrations.some((migration) => migration.id === "0007_association_tables"));
    assert.match(sql, /CREATE TABLE IF NOT EXISTS schedule_jobs/);
    assert.match(sql, /FOREIGN KEY \(batch_id\) REFERENCES exam_batches\(id\)/);
    assert.match(sql, /UNIQUE \(run_id, room_id, time_slot_id\)/);
    assert.match(sql, /DROP CONSTRAINT IF EXISTS draft_scheduled_exams_draft_room_slot_unique/);
  });

  it("enforces roles, updates teacher unavailable slots, previews notifications, and exports CSV", async () => {
    const app = createApp({ scheduler: new FakeScheduler() });

    const forbiddenResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: viewerHeaders,
    });
    assert.equal(forbiddenResponse.statusCode, 403);
    assert.equal(forbiddenResponse.json().error, "permission_denied");

    const unavailableResponse = await app.inject({
      method: "PATCH",
      url: "/api/teachers/t-zhang/unavailable-slots",
      headers: operatorHeaders,
      payload: {
        unavailable_slot_ids: ["s-002", "s-004"],
      },
    });
    assert.equal(unavailableResponse.statusCode, 200);
    assert.deepEqual(unavailableResponse.json().teacher.unavailable_slot_ids, ["s-002", "s-004"]);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/schedule-runs",
      headers: operatorHeaders,
    });
    const created = createResponse.json();
    await app.inject({
      method: "POST",
      url: `/api/schedule-runs/${created.run.id}/publish`,
      headers: adminHeaders,
    });

    const notificationsResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule/notifications",
    });
    assert.equal(notificationsResponse.statusCode, 200);
    assert.ok(notificationsResponse.json().notifications.length > 0);
    assert.match(notificationsResponse.json().notifications[0].message, /考试安排已发布/);

    const unauthenticatedExportResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule/export.csv",
    });
    assert.equal(unauthenticatedExportResponse.statusCode, 403);

    const exportResponse = await app.inject({
      method: "GET",
      url: "/api/published-schedule/export.csv",
      headers: viewerHeaders,
    });
    assert.equal(exportResponse.statusCode, 200);
    assert.match(exportResponse.headers["content-type"] as string, /text\/csv/);
    assert.match(exportResponse.body, /course,time_slot,room,teachers/);

    const auditResponse = await app.inject({
      method: "GET",
      url: `/api/audit-events?entityType=schedule_run&entityId=${created.run.id}&actor=viewer`,
      headers: adminHeaders,
    });
    assert.equal(auditResponse.statusCode, 200);
    assert.equal(auditResponse.json().events[0].action, "published_schedule.exported");

    await app.close();
  });
});

async function waitFor(assertion: () => Promise<boolean>, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for condition.");
}
