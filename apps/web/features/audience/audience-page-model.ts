import type { PublishedScheduleAssignmentView, TimeSlot } from "@examforge/shared";

export interface AudienceScheduleDay {
  date: string;
  assignments: PublishedScheduleAssignmentView[];
}

export interface AudienceScheduleModel {
  days: AudienceScheduleDay[];
  nextAssignment: PublishedScheduleAssignmentView | null;
}

export function buildAudienceScheduleModel(
  assignments: PublishedScheduleAssignmentView[],
  now: Date,
): AudienceScheduleModel {
  const ordered = [...assignments].sort(compareAssignments);
  const days = new Map<string, PublishedScheduleAssignmentView[]>();
  for (const assignment of ordered) {
    const date = assignment.timeSlot?.date ?? "日期待定";
    const items = days.get(date) ?? [];
    items.push(assignment);
    days.set(date, items);
  }
  const nextAssignment = ordered.find((assignment) => {
    const timeSlot = assignment.timeSlot;
    if (!timeSlot) return false;
    return new Date(`${timeSlot.date}T${timeSlot.start_time}:00`).getTime() >= now.getTime();
  }) ?? null;
  return {
    days: [...days].map(([date, dayAssignments]) => ({
      date,
      assignments: dayAssignments,
    })),
    nextAssignment,
  };
}

export function toggleUnavailableSlot(
  current: string[],
  slotId: string,
  checked: boolean,
  timeSlots: TimeSlot[],
) {
  const selected = new Set(current);
  if (checked) selected.add(slotId);
  else selected.delete(slotId);
  const slotOrder = new Map(
    [...timeSlots].sort(compareTimeSlots).map((slot, index) => [slot.id, index]),
  );
  return [...selected].sort((left, right) => (
    (slotOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
      - (slotOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
    || left.localeCompare(right)
  ));
}

function compareAssignments(
  left: PublishedScheduleAssignmentView,
  right: PublishedScheduleAssignmentView,
) {
  return compareTimeSlots(left.timeSlot, right.timeSlot)
    || left.assignment.exam_task_id.localeCompare(right.assignment.exam_task_id);
}

function compareTimeSlots(left: TimeSlot | null, right: TimeSlot | null) {
  if (!left) return right ? 1 : 0;
  if (!right) return -1;
  return left.date.localeCompare(right.date)
    || left.start_time.localeCompare(right.start_time)
    || left.end_time.localeCompare(right.end_time)
    || left.id.localeCompare(right.id);
}
