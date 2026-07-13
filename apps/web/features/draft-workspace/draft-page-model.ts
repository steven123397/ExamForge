import type { ScheduledExam } from "@examforge/shared";

export interface DraftWorkspaceRouteState {
  draftId: string;
  examTaskId: string;
  view: "matrix" | "list";
  conflict: "all" | "conflicted";
}

export function readDraftWorkspaceRouteState(
  draftId: string,
  search: URLSearchParams,
): DraftWorkspaceRouteState {
  return {
    draftId: draftId.trim(),
    examTaskId: search.get("examTaskId")?.trim() ?? "",
    view: search.get("view") === "list" ? "list" : "matrix",
    conflict: search.get("conflict") === "conflicted" ? "conflicted" : "all",
  };
}

export function updateDraftWorkspaceSearch(
  current: URLSearchParams,
  patch: Partial<Omit<DraftWorkspaceRouteState, "draftId">>,
) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    const isDefault = (key === "view" && value === "matrix")
      || (key === "conflict" && value === "all");
    if (value === "" || value === undefined || value === null || isDefault) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  return next.toString();
}

export function dropDestinationId(roomId: string, timeSlotId: string) {
  return `draft-drop:${encodeURIComponent(roomId)}:${encodeURIComponent(timeSlotId)}`;
}

export function resolveDraftDrop({
  examTaskId,
  overId,
  assignments,
  lockedExamTaskIds,
  draftLocked,
}: {
  examTaskId: string;
  overId: string;
  assignments: ScheduledExam[];
  lockedExamTaskIds: string[];
  draftLocked: boolean;
}) {
  if (!examTaskId || draftLocked || lockedExamTaskIds.includes(examTaskId)) {
    return null;
  }
  const destination = parseDropDestination(overId);
  const source = assignments.find((assignment) => assignment.exam_task_id === examTaskId);
  if (!destination || !source) {
    return null;
  }
  if (source.room_id === destination.roomId && source.time_slot_id === destination.timeSlotId) {
    return null;
  }
  const occupied = assignments.some((assignment) => (
    assignment.exam_task_id !== examTaskId
    && assignment.room_id === destination.roomId
    && assignment.time_slot_id === destination.timeSlotId
  ));
  return occupied ? null : {
    examTaskId,
    roomId: destination.roomId,
    timeSlotId: destination.timeSlotId,
  };
}

function parseDropDestination(value: string) {
  const match = /^draft-drop:([^:]+):([^:]+)$/.exec(value);
  if (!match) {
    return null;
  }
  try {
    const roomId = decodeURIComponent(match[1]);
    const timeSlotId = decodeURIComponent(match[2]);
    return roomId && timeSlotId ? { roomId, timeSlotId } : null;
  } catch {
    return null;
  }
}
