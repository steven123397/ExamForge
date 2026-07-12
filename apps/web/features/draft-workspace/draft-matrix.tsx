import { Move } from "lucide-react";
import { useRef, useState } from "react";
import type {
  Course,
  ReferenceDataResponse,
  ScheduleDraftDetailResponse,
  ScheduledExam,
  StudentGroup,
  Teacher,
} from "@examforge/shared";

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
  onSelectAssignment,
  onMoveAssignment,
}: {
  scheduleInput: ReferenceDataResponse["scheduleInput"] | undefined;
  draft: ScheduleDraftDetailResponse | null;
  selectedAssignmentId: string;
  draftLocked: boolean;
  lookups: DraftMatrixLookups;
  onSelectAssignment(id: string): void;
  onMoveAssignment(examTaskId: string, roomId: string, timeSlotId: string): Promise<void>;
}) {
  const [draggedAssignmentId, setDraggedAssignmentId] = useState("");
  const [dragTargetKey, setDragTargetKey] = useState("");
  const draggedAssignmentIdRef = useRef("");
  const dragSourceKeyRef = useRef("");

  function assignmentHasConflict(assignment: ScheduledExam) {
    return draft?.conflicts.some((conflict) => (
      conflict.affected_ids.includes(assignment.exam_task_id)
    )) ?? false;
  }

  function clearDragState() {
    draggedAssignmentIdRef.current = "";
    dragSourceKeyRef.current = "";
    setDraggedAssignmentId("");
    setDragTargetKey("");
  }

  function beginDrag(examTaskId: string, sourceKey: string) {
    draggedAssignmentIdRef.current = examTaskId;
    dragSourceKeyRef.current = sourceKey;
    setDraggedAssignmentId(examTaskId);
    onSelectAssignment(examTaskId);
  }

  function handleDrop(roomId: string, slotId: string, transferredAssignmentId = "") {
    const moving = transferredAssignmentId || draggedAssignmentIdRef.current || draggedAssignmentId;
    if (!moving || draftLocked) {
      return;
    }
    clearDragState();
    void onMoveAssignment(moving, roomId, slotId);
  }

  function handlePointerDrop(roomId: string, slotId: string) {
    const targetKey = `${slotId}-${roomId}`;
    if (!draggedAssignmentIdRef.current || draftLocked) {
      return;
    }
    if (dragSourceKeyRef.current === targetKey) {
      clearDragState();
      return;
    }
    handleDrop(roomId, slotId);
  }

  return (
    <div className="schedule-matrix-wrap">
      {scheduleInput ? (
        <table className="schedule-matrix">
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
                  ));
                  const task = assignment ? scheduleInput.exam_tasks.find((item) => item.id === assignment.exam_task_id) : null;
                  const course = task ? lookups.courses.get(task.course_id) : null;
                  return (
                    <td className="matrix-cell-container" key={`${slot.id}-${room.id}`}>
                      <button
                        type="button"
                        data-testid={`draft-cell-${slot.id}-${room.id}`}
                        data-exam-task-id={assignment?.exam_task_id}
                        className={[
                          "matrix-cell",
                          assignment ? "filled" : "",
                          assignment?.exam_task_id === selectedAssignmentId ? "selected" : "",
                          assignment && assignmentHasConflict(assignment) ? "conflicted" : "",
                          assignment && draft?.lockedExamTaskIds?.includes(assignment.exam_task_id) ? "locked" : "",
                          dragTargetKey === `${slot.id}-${room.id}` ? "drop-target" : "",
                        ].join(" ")}
                        draggable={Boolean(assignment && !draftLocked)}
                        aria-label={assignment ? undefined : `${slot.date} ${slot.start_time}-${slot.end_time} ${room.name} 空考位`}
                        onDragStart={(event) => {
                          if (assignment && !draftLocked) {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", assignment.exam_task_id);
                            beginDrag(assignment.exam_task_id, `${slot.id}-${room.id}`);
                          }
                        }}
                        onDragEnd={clearDragState}
                        onDragOver={(event) => {
                          if ((draggedAssignmentIdRef.current || draggedAssignmentId) && !draftLocked) {
                            event.preventDefault();
                            setDragTargetKey(`${slot.id}-${room.id}`);
                          }
                        }}
                        onPointerDown={(event) => {
                          if (event.button === 0 && assignment && !draftLocked) {
                            beginDrag(assignment.exam_task_id, `${slot.id}-${room.id}`);
                          }
                        }}
                        onPointerEnter={() => {
                          if (draggedAssignmentIdRef.current && !draftLocked) {
                            setDragTargetKey(`${slot.id}-${room.id}`);
                          }
                        }}
                        onPointerUp={() => handlePointerDrop(room.id, slot.id)}
                        onDragLeave={() => setDragTargetKey("")}
                        onDrop={(event) => {
                          event.preventDefault();
                          handleDrop(room.id, slot.id, event.dataTransfer.getData("text/plain"));
                        }}
                        onClick={() => assignment ? onSelectAssignment(assignment.exam_task_id) : undefined}
                      >
                        {assignment && task ? (
                          <>
                            <Move size={14} aria-hidden="true" />
                            <strong>{course?.name ?? task.course_id}</strong>
                            <span>{task.student_group_ids.map((id) => lookups.groups.get(id)?.name ?? id).join("、")}</span>
                            <em>{assignment.teacher_ids.map((id) => lookups.teachers.get(id)?.name ?? id).join("、")}</em>
                          </>
                        ) : <span>空</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="muted">基础数据加载后展示矩阵。</p>}
    </div>
  );
}
