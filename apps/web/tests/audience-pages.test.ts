import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PublishedScheduleAssignmentView, TimeSlot } from "@examforge/shared";
import {
  buildAudienceScheduleModel,
  toggleUnavailableSlot,
} from "../features/audience/audience-page-model.js";

describe("audience page models", () => {
  it("groups assignments in chronological order and identifies the next assignment", () => {
    const assignments = [
      assignment("exam-late", "2026-07-16", "14:00", "16:00"),
      assignment("exam-past", "2026-07-14", "09:00", "11:00"),
      assignment("exam-next", "2026-07-16", "09:00", "11:00"),
    ];

    const model = buildAudienceScheduleModel(
      assignments,
      new Date("2026-07-15T08:00:00+08:00"),
    );

    assert.deepEqual(model.days.map((day) => day.date), ["2026-07-14", "2026-07-16"]);
    assert.deepEqual(
      model.days[1]?.assignments.map((item) => item.assignment.exam_task_id),
      ["exam-next", "exam-late"],
    );
    assert.equal(model.nextAssignment?.assignment.exam_task_id, "exam-next");
  });

  it("returns no next assignment after the batch and toggles slots in directory order", () => {
    const assignments = [assignment("exam-past", "2026-07-14", "09:00", "11:00")];
    assert.equal(
      buildAudienceScheduleModel(assignments, new Date("2026-07-20T08:00:00+08:00"))
        .nextAssignment,
      null,
    );

    const slots = [slot("s-002", "2026-07-16"), slot("s-001", "2026-07-15")];
    assert.deepEqual(toggleUnavailableSlot(["s-002", "s-002"], "s-001", true, slots), [
      "s-001",
      "s-002",
    ]);
    assert.deepEqual(toggleUnavailableSlot(["s-001", "s-002"], "s-001", false, slots), [
      "s-002",
    ]);
  });
});

function assignment(
  examTaskId: string,
  date: string,
  startTime: string,
  endTime: string,
): PublishedScheduleAssignmentView {
  return {
    assignment: {
      exam_task_id: examTaskId,
      room_id: `room-${examTaskId}`,
      time_slot_id: `slot-${examTaskId}`,
      teacher_ids: ["teacher-1"],
    },
    examTask: null,
    course: null,
    studentGroups: [],
    room: null,
    timeSlot: slot(`slot-${examTaskId}`, date, startTime, endTime),
    teachers: [],
  };
}

function slot(
  id: string,
  date: string,
  startTime = "09:00",
  endTime = "11:00",
): TimeSlot {
  return {
    id,
    date,
    start_time: startTime,
    end_time: endTime,
    period_index: 0,
  };
}
