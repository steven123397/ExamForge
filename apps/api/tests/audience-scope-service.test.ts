import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  demoScheduleInput,
  type AuthContext,
} from "@examforge/shared";
import {
  AudienceScopeError,
  AudienceScopeService,
} from "../src/services/audience-scope-service.js";
import { InMemoryPlatformRepository } from "../src/repository.js";
import { buildCompleteScheduleResult } from "./test-fixtures.js";

describe("audience scope service", () => {
  it("resolves current teacher and multi-group student audiences", async () => {
    const repository = new InMemoryPlatformRepository();
    await repository.setTeacherAudienceScope("user-teacher", "t-zhang");
    await repository.addStudentGroupAudienceScope("user-student", "g-cs-2301");
    await repository.addStudentGroupAudienceScope("user-student", "g-ai-2301");
    const service = new AudienceScopeService(repository);

    const teacher = await service.getAudience(authContext("teacher"));
    const student = await service.getAudience(authContext("student"));

    assert.equal(teacher.kind, "teacher");
    assert.equal(teacher.teacher.id, "t-zhang");
    assert.equal(student.kind, "student");
    assert.deepEqual(student.studentGroups.map((group) => group.id), [
      "g-ai-2301",
      "g-cs-2301",
    ]);
  });

  it("returns a discriminated current schedule and deduplicates overlapping groups", async () => {
    const repository = new InMemoryPlatformRepository();
    await repository.setTeacherAudienceScope("user-teacher", "t-zhang");
    await repository.addStudentGroupAudienceScope("user-student", "g-cs-2301");
    await repository.addStudentGroupAudienceScope("user-student", "g-ai-2301");
    const run = await repository.createScheduleRun(buildCompleteScheduleResult(demoScheduleInput));
    await repository.publishScheduleRun(run.run.id);
    const service = new AudienceScopeService(repository);

    const teacherSchedule = await service.getCurrentPublishedSchedule(authContext("teacher"));
    const studentSchedule = await service.getCurrentPublishedSchedule(authContext("student"));

    assert.equal(teacherSchedule?.kind, "teacher");
    assert.ok(teacherSchedule?.assignments.every((item) => (
      item.assignment.teacher_ids.includes("t-zhang")
    )));
    assert.equal(studentSchedule?.kind, "student");
    const assignmentIds = studentSchedule?.assignments.map((item) => item.assignment.exam_task_id) ?? [];
    assert.equal(new Set(assignmentIds).size, assignmentIds.length);
    assert.ok(assignmentIds.length > 1);
  });

  it("updates only the current teacher and rejects missing or mismatched scopes", async () => {
    const repository = new InMemoryPlatformRepository();
    await repository.setTeacherAudienceScope("user-teacher", "t-zhang");
    await repository.setTeacherAudienceScope("user-student", "t-li");
    const service = new AudienceScopeService(repository);

    const updated = await service.updateCurrentTeacherUnavailableSlots(
      authContext("teacher"),
      ["s-001", "s-004"],
    );
    assert.equal(updated.id, "t-zhang");
    assert.deepEqual(updated.unavailable_slot_ids, ["s-001", "s-004"]);

    await assert.rejects(
      service.getAudience(authContext("operator")),
      audienceError("audience_scope_missing"),
    );
    await assert.rejects(
      service.getAudience(authContext("student")),
      audienceError("audience_scope_invalid"),
    );
    await assert.rejects(
      service.getAudience(authContext("teacher", "user-unscoped")),
      audienceError("audience_scope_missing"),
    );
  });
});

function authContext(
  role: "admin" | "operator" | "teacher" | "student",
  userId = `user-${role}`,
): AuthContext {
  return {
    user: {
      id: userId,
      username: role,
      displayName: role,
      active: true,
      roles: [role],
    },
    session: {
      id: `session-${role}`,
      userId,
      createdAt: "2026-07-13T00:00:00.000Z",
      expiresAt: "2099-07-13T00:00:00.000Z",
    },
  };
}

function audienceError(code: "audience_scope_missing" | "audience_scope_invalid") {
  return (error: unknown) => error instanceof AudienceScopeError && error.code === code;
}
