import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import type { ScheduleDraftDetailResponse, ScheduleInput } from "@examforge/shared";
import { buildDraftAdjustmentSuggestions } from "../src/repository.js";

describe("draft adjustment suggestions", () => {
  it("keeps high-cardinality actionable suggestions bounded without changing their stable order", () => {
    const { detail, examTaskId, scheduleInput } = buildHighCardinalityDraft();
    const startedAt = performance.now();
    const response = buildDraftAdjustmentSuggestions(scheduleInput, detail, examTaskId);
    const elapsedMs = performance.now() - startedAt;

    assert.ok(response);
    assert.equal(response.suggestions.length, 8);
    assert.ok(response.suggestions.every((suggestion) => suggestion.hardConflictCount === 0));
    assert.deepEqual(
      response.suggestions.map((suggestion) => [
        suggestion.assignment.time_slot_id,
        suggestion.assignment.room_id,
        suggestion.assignment.teacher_ids.join(","),
      ].join("|")),
      Array.from({ length: 8 }, (_, index) => (
        `slot-00|room-00|teacher-00,teacher-${String(index + 1).padStart(2, "0")}`
      )),
    );
    assert.ok(
      elapsedMs < 2_000,
      `expected bounded suggestion search under 2000 ms, received ${elapsedMs.toFixed(0)} ms`,
    );
  });

  it("keeps a conflict explanation when no directly applicable teacher exists", () => {
    const response = buildDraftAdjustmentSuggestions(
      {
        exam_tasks: [{
          id: "task-001",
          allowed_slot_ids: ["slot-001"],
          invigilator_count: 1,
          expected_count: 20,
          required_room_type: "standard",
          required_equipment_tags: [],
          student_group_ids: ["group-001"],
        }],
        rooms: [{
          id: "room-001",
          name: "Room 1",
          capacity: 30,
          room_type: "standard",
          equipment_tags: [],
        }],
        teachers: [{
          id: "teacher-001",
          name: "Teacher 1",
          unavailable_slot_ids: ["slot-001"],
        }],
        time_slots: [{
          id: "slot-001",
          date: "2026-07-23",
          start_time: "09:00",
          end_time: "10:00",
          period_index: 0,
        }],
      } as unknown as ScheduleInput,
      {
        draft: { id: "draft-no-direct-candidate" },
        assignments: [{
          exam_task_id: "task-001",
          room_id: "room-001",
          time_slot_id: "slot-001",
          teacher_ids: ["teacher-001"],
        }],
      } as unknown as ScheduleDraftDetailResponse,
      "task-001",
    );

    assert.ok(response);
    assert.equal(response.suggestions.length, 1);
    assert.equal(response.suggestions[0]?.hardConflictCount, 1);
    assert.match(response.suggestions[0]?.reasons.join(" ") ?? "", /不可用/);
  });

  it("keeps high-cardinality conflict explanations within the fallback budget", () => {
    const { detail, examTaskId, scheduleInput } = buildHighCardinalityDraft();
    for (const teacher of scheduleInput.teachers) {
      teacher.unavailable_slot_ids = scheduleInput.time_slots.map((slot) => slot.id);
    }

    const startedAt = performance.now();
    const response = buildDraftAdjustmentSuggestions(scheduleInput, detail, examTaskId);
    const elapsedMs = performance.now() - startedAt;

    assert.ok(response);
    assert.equal(response.suggestions.length, 8);
    assert.ok(response.suggestions.every((suggestion) => suggestion.hardConflictCount > 0));
    assert.ok(
      elapsedMs < 2_000,
      `expected bounded fallback search under 2000 ms, received ${elapsedMs.toFixed(0)} ms`,
    );
  });
});

function buildHighCardinalityDraft(): {
  detail: ScheduleDraftDetailResponse;
  examTaskId: string;
  scheduleInput: ScheduleInput;
} {
  const rooms = Array.from({ length: 15 }, (_, index) => ({
    id: `room-${String(index).padStart(2, "0")}`,
    name: `Room ${index}`,
    capacity: 200,
    room_type: "standard",
    equipment_tags: [],
  }));
  const timeSlots = Array.from({ length: 20 }, (_, index) => ({
    id: `slot-${String(index).padStart(2, "0")}`,
    date: "2026-07-23",
    start_time: `${String(8 + (index % 10)).padStart(2, "0")}:00`,
    end_time: `${String(9 + (index % 10)).padStart(2, "0")}:00`,
    period_index: index,
  }));
  const teachers = Array.from({ length: 30 }, (_, index) => ({
    id: `teacher-${String(index).padStart(2, "0")}`,
    name: `Teacher ${index}`,
    unavailable_slot_ids: [],
  }));
  const examTasks = Array.from({ length: 150 }, (_, index) => ({
    id: `task-${String(index).padStart(3, "0")}`,
    allowed_slot_ids: timeSlots.map((slot) => slot.id),
    invigilator_count: 2,
    expected_count: 100,
    required_room_type: "standard",
    required_equipment_tags: [],
    student_group_ids: [`group-${index}`],
  }));
  const assignments = examTasks.map((task, index) => {
    const placement = index === 0 ? 0 : index - 1;
    const roomIndex = placement % rooms.length;
    const slotIndex = index === 0 ? 0 : 1 + Math.floor(placement / rooms.length);
    return {
      exam_task_id: task.id,
      room_id: rooms[roomIndex]!.id,
      time_slot_id: timeSlots[slotIndex]!.id,
      teacher_ids: [teachers[roomIndex * 2]!.id, teachers[roomIndex * 2 + 1]!.id],
    };
  });

  return {
    examTaskId: examTasks[0]!.id,
    scheduleInput: {
      exam_tasks: examTasks,
      rooms,
      teachers,
      time_slots: timeSlots,
    } as unknown as ScheduleInput,
    detail: {
      draft: { id: "draft-high-cardinality" },
      assignments,
    } as unknown as ScheduleDraftDetailResponse,
  };
}
