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
  buildPublicPublishedSchedule,
  buildPublicPublishedScheduleNotifications,
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

  it("projects public schedules without falling back to internal identifiers", () => {
    const referenceData = buildReferenceData();
    referenceData.scheduleInput.courses = referenceData.scheduleInput.courses.filter(
      (course) => course.id !== "c-database",
    );
    referenceData.scheduleInput.student_groups = referenceData.scheduleInput.student_groups.filter(
      (group) => group.id !== "g-cs-2302",
    );
    referenceData.scheduleInput.rooms = referenceData.scheduleInput.rooms.filter(
      (room) => room.id !== "r-lab-1",
    );
    referenceData.scheduleInput.time_slots = referenceData.scheduleInput.time_slots.filter(
      (slot) => slot.id !== "s-003",
    );

    const schedule = buildPublicPublishedSchedule(referenceData, buildPublishedSchedule());
    assert.equal(schedule.contractVersion, 1);
    assert.deepEqual(Object.keys(schedule.batch).sort(), ["endDate", "name", "startDate"]);
    const missingReferenceEntry = schedule.entries.find((entry) => entry.courseName === null);
    assert.deepEqual(missingReferenceEntry, {
      courseName: null,
      studentGroupNames: [],
      roomName: null,
      date: null,
      startTime: null,
      endTime: null,
    });
    const serializedSchedule = JSON.stringify(schedule);
    for (const identifier of ["e-database", "g-cs-2302", "r-lab-1", "s-003"]) {
      assert.equal(serializedSchedule.includes(identifier), false, `${identifier} must not be public`);
    }

    const notifications = buildPublicPublishedScheduleNotifications(
      referenceData,
      buildPublishedSchedule(),
    );
    assert.deepEqual(notifications.notifications.map((notice) => notice.studentGroupName), ["计算机 2301"]);
    assert.equal(JSON.stringify(notifications).includes("g-cs-2302"), false);
  });

  it("normalizes blank public schedule labels to null instead of rejecting the response", () => {
    const referenceData = buildReferenceData();
    referenceData.scheduleInput.courses = referenceData.scheduleInput.courses.map((course) => (
      course.id === "c-data-structures" ? { ...course, name: "   " } : course
    ));
    referenceData.scheduleInput.student_groups = referenceData.scheduleInput.student_groups.map((group) => (
      group.id === "g-cs-2301" ? { ...group, name: "   " } : group
    ));
    referenceData.scheduleInput.rooms = referenceData.scheduleInput.rooms.map((room) => (
      room.id === "r-101" ? { ...room, name: "   " } : room
    ));
    referenceData.scheduleInput.time_slots = referenceData.scheduleInput.time_slots.map((slot) => (
      slot.id === "s-001"
        ? { ...slot, date: "   ", start_time: "   ", end_time: "   " }
        : slot
    ));

    assert.doesNotThrow(() => buildPublicPublishedSchedule(referenceData, buildPublishedSchedule()));
    assert.deepEqual(buildPublicPublishedSchedule(referenceData, buildPublishedSchedule()).entries[0], {
      courseName: null,
      studentGroupNames: [],
      roomName: null,
      date: null,
      startTime: null,
      endTime: null,
    });
  });

  it("omits blank public notification labels without falling back to group IDs", () => {
    const referenceData = buildReferenceData();
    referenceData.scheduleInput.student_groups = referenceData.scheduleInput.student_groups.map((group) => (
      group.id === "g-cs-2301" ? { ...group, name: "   " } : group
    ));

    assert.doesNotThrow(() => (
      buildPublicPublishedScheduleNotifications(referenceData, buildPublishedSchedule())
    ));
    assert.deepEqual(
      buildPublicPublishedScheduleNotifications(referenceData, buildPublishedSchedule())
        .notifications
        .map((notification) => notification.studentGroupName),
      ["计算机 2302"],
    );
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
        scoring_contract_version: 1,
        normalized_score: 92,
        total_raw_penalty: 0,
        total_weighted_penalty: 0,
        normalized_penalty_items: [],
      },
      statistics: {
        status: "feasible",
        elapsed_ms: 10,
        exam_count: 2,
        room_count: 2,
        slot_count: 2,
        attempted_assignments: 2,
      },
      diagnostics: [],
      report: {
        summary: {
          status: "feasible",
        },
      },
    },
  };
}
