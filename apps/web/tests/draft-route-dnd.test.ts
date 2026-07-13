import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ScheduledExam } from "@examforge/shared";
import {
  dropDestinationId,
  readDraftWorkspaceRouteState,
  resolveDraftDrop,
  updateDraftWorkspaceSearch,
} from "../features/draft-workspace/draft-page-model.js";

describe("draft route and drag models", () => {
  it("normalizes route-owned draft, assignment, view, and conflict state", () => {
    assert.deepEqual(readDraftWorkspaceRouteState(
      "draft-1",
      new URLSearchParams("examTaskId=exam-1&view=list&conflict=conflicted"),
    ), {
      draftId: "draft-1",
      examTaskId: "exam-1",
      view: "list",
      conflict: "conflicted",
    });
    assert.deepEqual(readDraftWorkspaceRouteState(
      " ",
      new URLSearchParams("view=cards&conflict=unknown"),
    ), {
      draftId: "",
      examTaskId: "",
      view: "matrix",
      conflict: "all",
    });
    assert.equal(updateDraftWorkspaceSearch(
      new URLSearchParams("examTaskId=old&trace=keep"),
      { examTaskId: "exam-2", view: "list", conflict: "all" },
    ), "examTaskId=exam-2&trace=keep&view=list");
  });

  it("accepts only real unlocked unoccupied drop destinations", () => {
    const assignments = [
      assignment("exam-1", "room-1", "slot:1"),
      assignment("exam-2", "room-2", "slot-2"),
    ];
    const target = dropDestinationId("room:3", "slot-3");
    assert.deepEqual(resolveDraftDrop({
      examTaskId: "exam-1",
      overId: target,
      assignments,
      lockedExamTaskIds: [],
      draftLocked: false,
    }), {
      examTaskId: "exam-1",
      roomId: "room:3",
      timeSlotId: "slot-3",
    });
    assert.equal(resolveDraftDrop({
      examTaskId: "exam-1",
      overId: dropDestinationId("room-1", "slot:1"),
      assignments,
      lockedExamTaskIds: [],
      draftLocked: false,
    }), null);
    assert.equal(resolveDraftDrop({
      examTaskId: "exam-1",
      overId: dropDestinationId("room-2", "slot-2"),
      assignments,
      lockedExamTaskIds: [],
      draftLocked: false,
    }), null);
    assert.equal(resolveDraftDrop({
      examTaskId: "exam-1",
      overId: target,
      assignments,
      lockedExamTaskIds: ["exam-1"],
      draftLocked: false,
    }), null);
    assert.equal(resolveDraftDrop({
      examTaskId: "exam-1",
      overId: "forged-target",
      assignments,
      lockedExamTaskIds: [],
      draftLocked: false,
    }), null);
  });
});

function assignment(examTaskId: string, roomId: string, timeSlotId: string): ScheduledExam {
  return {
    exam_task_id: examTaskId,
    room_id: roomId,
    time_slot_id: timeSlotId,
    teacher_ids: [],
  };
}
