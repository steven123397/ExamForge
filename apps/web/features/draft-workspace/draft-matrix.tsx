"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { useState } from "react";
import type {
  Course,
  ReferenceDataResponse,
  ScheduleDraftDetailResponse,
  ScheduledExam,
  StudentGroup,
  Teacher,
} from "@examforge/shared";
import { dropDestinationId, resolveDraftDrop } from "./draft-page-model";

export interface DraftMatrixLookups {
  courses: Map<string, Course>;
  teachers: Map<string, Teacher>;
  groups: Map<string, StudentGroup>;
}

export function DraftMatrix({
  scheduleInput,
  draft,
  selectedAssignmentId,
  draftLocked,
  lookups,
  view = "matrix",
  conflict = "all",
  onSelectAssignment,
  onMoveAssignment,
}: {
  scheduleInput: ReferenceDataResponse["scheduleInput"] | undefined;
  draft: ScheduleDraftDetailResponse | null;
  selectedAssignmentId: string;
  draftLocked: boolean;
  lookups: DraftMatrixLookups;
  view?: "matrix" | "list";
  conflict?: "all" | "conflicted";
  onSelectAssignment(id: string): void;
  onMoveAssignment(examTaskId: string, roomId: string, timeSlotId: string): Promise<void>;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      scrollBehavior: "auto",
      onActivation({ event }) {
        if (event.target instanceof HTMLElement) {
          event.target.scrollIntoView({ block: "nearest", inline: "center" });
        }
      },
    }),
  );
  const [activeAssignmentId, setActiveAssignmentId] = useState("");
  const conflictedIds = new Set(draft?.conflicts.flatMap((item) => item.affected_ids) ?? []);

  function handleDragEnd(event: DragEndEvent) {
    setActiveAssignmentId("");
    const examTaskId = String(event.active.data.current?.examTaskId ?? event.active.id);
    const move = resolveDraftDrop({
      examTaskId,
      overId: event.over ? String(event.over.id) : "",
      assignments: draft?.assignments ?? [],
      lockedExamTaskIds: draft?.lockedExamTaskIds ?? [],
      draftLocked,
    });
    if (move) {
      void onMoveAssignment(move.examTaskId, move.roomId, move.timeSlotId);
    }
  }

  if (!scheduleInput) {
    return <p className="muted">基础数据加载后展示矩阵。</p>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{
        announcements: draftAnnouncements,
        screenReaderInstructions: {
          draggable: "按空格或回车拿起考试，使用方向键选择目标考位，再按空格或回车放下；按 Escape 取消。",
        },
      }}
      onDragStart={(event) => {
        const examTaskId = String(event.active.data.current?.examTaskId ?? event.active.id);
        setActiveAssignmentId(examTaskId);
        if (examTaskId !== selectedAssignmentId) {
          onSelectAssignment(examTaskId);
        }
      }}
      onDragCancel={() => setActiveAssignmentId("")}
      onDragEnd={handleDragEnd}
    >
      <div className={`schedule-matrix-wrap draft-view-${view}`}>
        <table className="schedule-matrix draft-matrix-view">
          <caption className="visually-hidden">排考草稿矩阵</caption>
          <thead>
            <tr>
              <th className="matrix-corner" scope="col">时间 / 考场</th>
              {scheduleInput.rooms.map((room) => (
                <th className="matrix-head" scope="col" key={room.id}>{room.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {scheduleInput.time_slots.map((slot) => (
              <tr className="matrix-row" key={slot.id}>
                <th className="matrix-slot" scope="row">
                  <strong>{slot.date}</strong>
                  <span>{slot.start_time}-{slot.end_time}</span>
                </th>
                {scheduleInput.rooms.map((room) => {
                  const assignment = draft?.assignments.find((item) => (
                    item.room_id === room.id && item.time_slot_id === slot.id
                  )) ?? null;
                  const visible = conflict === "all"
                    || (assignment && conflictedIds.has(assignment.exam_task_id));
                  return (
                    <DraftMatrixCell
                      key={`${slot.id}-${room.id}`}
                      roomId={room.id}
                      roomName={room.name}
                      slotId={slot.id}
                      slotLabel={`${slot.date} ${slot.start_time}-${slot.end_time}`}
                      assignment={visible ? assignment : null}
                      occupied={!visible && Boolean(assignment)}
                      scheduleInput={scheduleInput}
                      selectedAssignmentId={selectedAssignmentId}
                      conflicted={Boolean(assignment && conflictedIds.has(assignment.exam_task_id))}
                      assignmentLocked={Boolean(assignment && draft?.lockedExamTaskIds?.includes(assignment.exam_task_id))}
                      draftLocked={draftLocked}
                      active={assignment?.exam_task_id === activeAssignmentId}
                      lookups={lookups}
                      onSelectAssignment={onSelectAssignment}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="draft-assignment-list" aria-label="草稿安排列表">
          {draft?.assignments
            .filter((assignment) => conflict === "all" || conflictedIds.has(assignment.exam_task_id))
            .map((assignment) => {
              const task = scheduleInput.exam_tasks.find((item) => item.id === assignment.exam_task_id);
              const course = task ? lookups.courses.get(task.course_id) : null;
              const room = scheduleInput.rooms.find((item) => item.id === assignment.room_id);
              const slot = scheduleInput.time_slots.find((item) => item.id === assignment.time_slot_id);
              return (
                <button
                  type="button"
                  key={assignment.exam_task_id}
                  className={assignment.exam_task_id === selectedAssignmentId ? "draft-list-row active" : "draft-list-row"}
                  onClick={() => onSelectAssignment(assignment.exam_task_id)}
                >
                  <strong>{course?.name ?? task?.course_id ?? assignment.exam_task_id}</strong>
                  <span>{slot ? `${slot.date} ${slot.start_time}-${slot.end_time}` : assignment.time_slot_id}</span>
                  <em>{room?.name ?? assignment.room_id}</em>
                  {draft.lockedExamTaskIds?.includes(assignment.exam_task_id) ? <small>已锁定</small> : null}
                </button>
              );
            })}
          {!draft?.assignments.length ? <p className="muted">当前草稿没有安排。</p> : null}
        </div>
      </div>
    </DndContext>
  );
}

function DraftMatrixCell({
  roomId,
  roomName,
  slotId,
  slotLabel,
  assignment,
  occupied,
  scheduleInput,
  selectedAssignmentId,
  conflicted,
  assignmentLocked,
  draftLocked,
  active,
  lookups,
  onSelectAssignment,
}: {
  roomId: string;
  roomName: string;
  slotId: string;
  slotLabel: string;
  assignment: ScheduledExam | null;
  occupied: boolean;
  scheduleInput: ReferenceDataResponse["scheduleInput"];
  selectedAssignmentId: string;
  conflicted: boolean;
  assignmentLocked: boolean;
  draftLocked: boolean;
  active: boolean;
  lookups: DraftMatrixLookups;
  onSelectAssignment(id: string): void;
}) {
  const destinationId = dropDestinationId(roomId, slotId);
  const { isOver, setNodeRef: setDroppableRef } = useDroppable({
    id: destinationId,
    disabled: draftLocked || occupied,
    data: { label: `${slotLabel} ${roomName}` },
  });
  const task = assignment
    ? scheduleInput.exam_tasks.find((item) => item.id === assignment.exam_task_id)
    : null;
  const course = task ? lookups.courses.get(task.course_id) : null;
  return (
    <td ref={setDroppableRef} className="matrix-cell-container">
      {assignment && task ? (
        <DraggableAssignment
          assignment={assignment}
          task={task}
          course={course ?? undefined}
          selected={assignment.exam_task_id === selectedAssignmentId}
          conflicted={conflicted}
          locked={assignmentLocked}
          disabled={draftLocked || assignmentLocked}
          active={active}
          roomId={roomId}
          slotId={slotId}
          lookups={lookups}
          onSelectAssignment={onSelectAssignment}
        />
      ) : (
        <button
          type="button"
          data-testid={`draft-cell-${slotId}-${roomId}`}
          className={["matrix-cell", isOver ? "drop-target" : "", occupied ? "filtered-occupied" : ""].join(" ")}
          aria-label={`${slotLabel} ${roomName} ${occupied ? "已占用" : "空考位"}`}
          disabled={occupied}
        >
          <span>{occupied ? "已占用" : "空"}</span>
        </button>
      )}
    </td>
  );
}

function DraggableAssignment({
  assignment,
  task,
  course,
  selected,
  conflicted,
  locked,
  disabled,
  active,
  roomId,
  slotId,
  lookups,
  onSelectAssignment,
}: {
  assignment: ScheduledExam;
  task: ReferenceDataResponse["scheduleInput"]["exam_tasks"][number];
  course: Course | undefined;
  selected: boolean;
  conflicted: boolean;
  locked: boolean;
  disabled: boolean;
  active: boolean;
  roomId: string;
  slotId: string;
  lookups: DraftMatrixLookups;
  onSelectAssignment(id: string): void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: assignment.exam_task_id,
    disabled,
    data: {
      examTaskId: assignment.exam_task_id,
      label: course?.name ?? task.course_id,
    },
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-testid={`draft-cell-${slotId}-${roomId}`}
      data-exam-task-id={assignment.exam_task_id}
      className={[
        "matrix-cell filled",
        selected ? "selected" : "",
        conflicted ? "conflicted" : "",
        locked ? "locked" : "",
        active ? "dragging" : "",
      ].join(" ")}
      style={transform ? {
        transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`,
      } : undefined}
      onClick={() => {
        if (!selected) {
          onSelectAssignment(assignment.exam_task_id);
        }
      }}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={14} aria-hidden="true" />
      <strong>{course?.name ?? task.course_id}</strong>
      <span>{task.student_group_ids.map((id) => lookups.groups.get(id)?.name ?? id).join("、")}</span>
      <em>{assignment.teacher_ids.map((id) => lookups.teachers.get(id)?.name ?? id).join("、")}</em>
    </button>
  );
}

const draftAnnouncements: Announcements = {
  onDragStart({ active }) {
    return `已拿起${String(active.data.current?.label ?? active.id)}。`;
  },
  onDragOver({ active, over }) {
    return over
      ? `${String(active.data.current?.label ?? active.id)}已移动到${String(over.data.current?.label ?? over.id)}。`
      : "当前没有可放置的目标。";
  },
  onDragEnd({ active, over }) {
    return over
      ? `${String(active.data.current?.label ?? active.id)}已放置到${String(over.data.current?.label ?? over.id)}。`
      : "移动已取消。";
  },
  onDragCancel() {
    return "移动已取消。";
  },
};
