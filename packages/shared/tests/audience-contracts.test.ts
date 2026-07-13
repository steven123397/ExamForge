import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  audienceScopeErrorCodeSchema,
  audienceScopeSchema,
  currentPublishedScheduleSchema,
} from "../src/index.js";

const teacher = {
  id: "t-zhang",
  name: "张教授",
  department_id: "cs",
  unavailable_slot_ids: ["s-002"],
};

const studentGroups = [
  {
    id: "g-cs-2301",
    name: "计算机 2301",
    size: 42,
    department_id: "cs",
  },
  {
    id: "g-ai-2301",
    name: "人工智能 2301",
    size: 36,
    department_id: "cs",
  },
];

const batch = {
  id: "batch-2026-spring-final",
  name: "2026 春季期末考试",
  status: "published" as const,
  startDate: "2026-06-29",
  endDate: "2026-07-03",
};

const run = {
  id: "run-published",
  status: "feasible" as const,
  createdAt: "2026-07-13T08:00:00.000Z",
  elapsedMs: 120,
  score: 96,
  conflictCount: 0,
  assignmentCount: 1,
};

describe("current audience contracts", () => {
  it("accepts one teacher scope and multiple student-group scopes", () => {
    const teacherScope = audienceScopeSchema.parse({
      kind: "teacher",
      teacher,
    });
    const studentScope = audienceScopeSchema.parse({
      kind: "student",
      studentGroups,
    });

    assert.equal(teacherScope.kind, "teacher");
    assert.equal(teacherScope.teacher.id, "t-zhang");
    assert.equal(studentScope.kind, "student");
    assert.deepEqual(studentScope.studentGroups.map((group) => group.id), [
      "g-cs-2301",
      "g-ai-2301",
    ]);
    assert.throws(() => audienceScopeSchema.parse({
      kind: "teacher",
      teacher,
      studentGroups,
    }));
    assert.throws(() => audienceScopeSchema.parse({
      kind: "student",
      studentGroups: [studentGroups[0], studentGroups[0]],
    }));
  });

  it("freezes stable missing and invalid scope error codes", () => {
    assert.equal(audienceScopeErrorCodeSchema.parse("audience_scope_missing"), "audience_scope_missing");
    assert.equal(audienceScopeErrorCodeSchema.parse("audience_scope_invalid"), "audience_scope_invalid");
    assert.throws(() => audienceScopeErrorCodeSchema.parse("teacher_not_found"));
  });

  it("keeps current teacher and student schedules as a discriminated union", () => {
    const teacherSchedule = currentPublishedScheduleSchema.parse({
      kind: "teacher",
      audience: { kind: "teacher", teacher },
      batch,
      run,
      assignments: [],
    });
    const studentSchedule = currentPublishedScheduleSchema.parse({
      kind: "student",
      audience: { kind: "student", studentGroups },
      batch,
      run,
      assignments: [],
    });

    assert.equal(teacherSchedule.kind, "teacher");
    assert.equal(teacherSchedule.audience.kind, "teacher");
    assert.equal(studentSchedule.kind, "student");
    assert.equal(studentSchedule.audience.kind, "student");
    assert.throws(() => currentPublishedScheduleSchema.parse({
      ...teacherSchedule,
      audience: { kind: "student", studentGroups },
    }));
  });
});
