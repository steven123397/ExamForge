import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  demoBatch,
  demoScheduleInput,
  type PublishedScheduleResponse,
  type ReferenceDataResponse,
} from "@examforge/shared";
import {
  buildPublishedScheduleAudience,
  buildPublishedScheduleCsv,
  buildPublishedScheduleNotifications,
} from "../src/services/published-schedule-service.js";

describe("published schedule service", () => {
  it("builds teacher and student group audience views", () => {
    const referenceData = buildReferenceData();
    const published = buildPublishedSchedule();

    const teacherView = buildPublishedScheduleAudience(
      referenceData,
      published,
      "teacher",
      "t-zhang",
    );
    assert.equal(teacherView?.viewer.name, "张教授");
    assert.equal(teacherView?.assignments.length, 1);
    assert.equal(teacherView?.assignments[0].course?.name, "数据结构");

    const studentView = buildPublishedScheduleAudience(
      referenceData,
      published,
      "student_group",
      "g-cs-2302",
    );
    assert.equal(studentView?.viewer.name, "计算机 2302");
    assert.equal(studentView?.assignments.length, 1);
    assert.equal(studentView?.assignments[0].room?.id, "r-lab-1");

    assert.equal(
      buildPublishedScheduleAudience(referenceData, published, "teacher", "missing"),
      null,
    );
  });

  it("builds notification counts per student group", () => {
    const notifications = buildPublishedScheduleNotifications(
      buildReferenceData(),
      buildPublishedSchedule(),
    );

    assert.deepEqual(
      notifications.notifications.map((notice) => [
        notice.studentGroupId,
        notice.assignmentCount,
      ]),
      [
        ["g-cs-2301", 1],
        ["g-cs-2302", 1],
      ],
    );
    assert.ok(notifications.notifications[0].message.includes("考试安排已发布"));
  });

  it("exports CSV with stable headers and escaped cells", () => {
    const referenceData = buildReferenceData();
    referenceData.scheduleInput.courses = referenceData.scheduleInput.courses.map((course) => (
      course.id === "c-database"
        ? { ...course, name: "数据库,系统" }
        : course
    ));
    referenceData.scheduleInput.teachers = referenceData.scheduleInput.teachers.map((teacher) => (
      teacher.id === "t-li"
        ? { ...teacher, name: "李\n老师" }
        : teacher
    ));

    const csv = buildPublishedScheduleCsv(referenceData, buildPublishedSchedule());

    assert.equal(
      csv,
      [
        "course,time_slot,room,teachers",
        "\"数据结构\",\"2026-07-10 09:00-11:00\",\"明德楼 101\",\"张教授\"",
        "\"数据库,系统\",\"2026-07-11 09:00-11:00\",\"实验中心 A301\",\"李\n老师\"",
      ].join("\n"),
    );
  });
});

function buildReferenceData(): ReferenceDataResponse {
  return {
    batch: demoBatch,
    scheduleInput: structuredClone(demoScheduleInput),
  };
}

function buildPublishedSchedule(): PublishedScheduleResponse {
  return {
    batch: demoBatch,
    run: {
      id: "run-service-test",
      status: "feasible",
      createdAt: "2026-07-07T00:00:00.000Z",
      elapsedMs: 10,
      score: 92,
      conflictCount: 0,
      assignmentCount: 2,
    },
    result: {
      assignments: [
        {
          exam_task_id: "e-data-structures",
          room_id: "r-101",
          time_slot_id: "s-001",
          teacher_ids: ["t-zhang"],
        },
        {
          exam_task_id: "e-database",
          room_id: "r-lab-1",
          time_slot_id: "s-003",
          teacher_ids: ["t-li"],
        },
      ],
      conflicts: [],
      score: {
        total_score: 92,
        hard_violation_count: 0,
        soft_penalty_items: [],
      },
      statistics: {
        status: "feasible",
        elapsed_ms: 10,
        exam_count: 2,
        room_count: 2,
        slot_count: 2,
        attempted_assignments: 2,
      },
      report: {
        summary: {
          status: "feasible",
        },
      },
    },
  };
}
