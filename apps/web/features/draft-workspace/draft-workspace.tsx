import {
  ClipboardList,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ReferenceDataResponse,
  ScheduleDraftAdjustmentSuggestion,
  ScheduleDraftAdjustmentSuggestionsResponse,
  ScheduleDraftComparisonResponse,
  ScheduleDraftDetailResponse,
  ScheduleDraftRescheduleResponse,
  ScheduleDraftSummary,
  ScheduleRunSummary,
  ScheduledExam,
} from "@examforge/shared";
import type { LoadState } from "../../components/shared/load-state";
import { DraftMatrix } from "./draft-matrix";
import { DraftSuggestions } from "./draft-suggestions";

export type DraftAssignmentForm = Pick<ScheduledExam, "room_id" | "time_slot_id"> & {
  teacher_ids: string;
};

export function DraftWorkspace({
  drafts,
  runs,
  draft,
  comparison,
  suggestions,
  reschedule,
  referenceData,
  selectedAssignmentId,
  draftForm,
  draftState,
  suggestionState,
  rescheduleState,
  onCreateDraft,
  onLoadDraft,
  onSelectAssignment,
  onDraftFormChange,
  onSaveAdjustment,
  onApplySuggestion,
  onMoveAssignment,
  onLockAssignment,
  onUnlockAssignment,
  onRebalanceDraft,
  onRescheduleDraft,
  onPublishDraft,
  onDiscardDraft,
}: {
  drafts: ScheduleDraftSummary[];
  runs: ScheduleRunSummary[];
  draft: ScheduleDraftDetailResponse | null;
  comparison: ScheduleDraftComparisonResponse | null;
  suggestions: ScheduleDraftAdjustmentSuggestionsResponse | null;
  reschedule: ScheduleDraftRescheduleResponse | null;
  referenceData: ReferenceDataResponse | null;
  selectedAssignmentId: string;
  draftForm: DraftAssignmentForm;
  draftState: LoadState;
  suggestionState: LoadState;
  rescheduleState: LoadState;
  onCreateDraft(id: string): Promise<void>;
  onLoadDraft(id: string): Promise<void>;
  onSelectAssignment(id: string): void;
  onDraftFormChange(form: DraftAssignmentForm): void;
  onSaveAdjustment(): Promise<void>;
  onApplySuggestion(suggestion: ScheduleDraftAdjustmentSuggestion): Promise<void>;
  onMoveAssignment(examTaskId: string, roomId: string, timeSlotId: string): Promise<void>;
  onLockAssignment(): Promise<void>;
  onUnlockAssignment(): Promise<void>;
  onRebalanceDraft(): Promise<void>;
  onRescheduleDraft(): Promise<void>;
  onPublishDraft(): Promise<void>;
  onDiscardDraft(): Promise<void>;
}) {
  const [sourceRunId, setSourceRunId] = useState("");
  const scheduleInput = referenceData?.scheduleInput;
  const selectedAssignment = draft?.assignments.find((assignment) => (
    assignment.exam_task_id === selectedAssignmentId
  )) ?? null;
  const draftLocked = draft?.draft.status === "published" || draft?.draft.status === "discarded";
  const assignmentLocked = Boolean(selectedAssignmentId && draft?.lockedExamTaskIds?.includes(selectedAssignmentId));
  const canPublishDraft = draft?.draft.status === "validated" && draft.draft.conflictCount === 0;
  const draftBusy = draftState === "loading" || rescheduleState === "loading";
  const currentReschedule = reschedule?.sourceDraftId === draft?.draft.id ? reschedule : null;

  useEffect(() => {
    setSourceRunId((current) => current || runs[0]?.id || "");
  }, [runs]);

  const lookups = useMemo(() => ({
    courses: new Map(scheduleInput?.courses.map((item) => [item.id, item]) ?? []),
    rooms: new Map(scheduleInput?.rooms.map((item) => [item.id, item]) ?? []),
    slots: new Map(scheduleInput?.time_slots.map((item) => [item.id, item]) ?? []),
    teachers: new Map(scheduleInput?.teachers.map((item) => [item.id, item]) ?? []),
    groups: new Map(scheduleInput?.student_groups.map((item) => [item.id, item]) ?? []),
  }), [scheduleInput]);

  return (
    <div className="draft-workspace" data-testid="schedule-draft-workspace">
      <div className="draft-rail">
        <div className="draft-create">
          <label>
            <span>来源运行</span>
            <select value={sourceRunId} onChange={(event) => setSourceRunId(event.target.value)}>
              <option value="">选择运行版本</option>
              {runs.map((run) => (
                <option value={run.id} key={run.id}>
                  {run.status} · {run.score} · {run.id.slice(0, 12)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={!sourceRunId || draftBusy}
            onClick={() => onCreateDraft(sourceRunId)}
          >
            <ClipboardList size={16} />
            创建草稿
          </button>
        </div>

        <div className="draft-list">
          {drafts.map((item) => (
            <button
              type="button"
              key={item.id}
              data-testid={`draft-row-${item.id}`}
              className={draft?.draft.id === item.id ? "draft-row active" : "draft-row"}
              onClick={() => onLoadDraft(item.id)}
            >
              <strong>{item.status}</strong>
              <span>{item.id.slice(0, 18)}</span>
              <em>{item.conflictCount} 冲突 · {item.score} 分</em>
            </button>
          ))}
          {!drafts.length ? <p className="muted">从运行历史创建草稿后开始人工调整。</p> : null}
        </div>
      </div>

      <div className="draft-main">
        <div className="draft-summary">
          <div className="draft-summary-metrics">
            <div><span>状态</span><strong>{draft?.draft.status ?? "未选择"}</strong></div>
            <div><span>评分</span><strong>{draft?.draft.score ?? "--"}</strong></div>
            <div><span>冲突</span><strong>{draft?.draft.conflictCount ?? "--"}</strong></div>
            <div><span>安排</span><strong>{draft?.draft.assignmentCount ?? "--"}</strong></div>
            <div><span>锁定</span><strong>{draft?.lockedExamTaskIds?.length ?? 0}</strong></div>
          </div>
          <div className="draft-summary-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={!draft || draftLocked || draftBusy}
              onClick={onRebalanceDraft}
              data-testid="draft-rebalance"
            >
              <RotateCcw size={17} />
              局部再平衡
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!draft || draftLocked || draftBusy}
              onClick={onRescheduleDraft}
              data-testid="draft-reschedule"
            >
              <RefreshCw size={17} />
              {rescheduleState === "loading" ? "正在重排" : "生成重排版本"}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!canPublishDraft || draftBusy}
              onClick={onPublishDraft}
            >
              <ShieldCheck size={17} />
              发布草稿
            </button>
          </div>
        </div>

        {currentReschedule ? (
          <div
            className="draft-reschedule-summary"
            data-testid="draft-reschedule-summary"
            aria-live="polite"
          >
            <div>
              <span>增量重排结果</span>
              <strong>{currentReschedule.run.id.slice(0, 18)}</strong>
            </div>
            <dl>
              <div><dt>冻结</dt><dd data-testid="draft-reschedule-frozen">{currentReschedule.reschedule.frozen_exam_task_ids.length}</dd></div>
              <div><dt>保留</dt><dd data-testid="draft-reschedule-retained">{currentReschedule.reschedule.retained_exam_task_ids.length}</dd></div>
              <div><dt>变化</dt><dd data-testid="draft-reschedule-changed">{currentReschedule.reschedule.changed_exam_task_ids.length}</dd></div>
            </dl>
          </div>
        ) : null}

        <div className="draft-confirmation">
          <div className="confirmation-metrics">
            <div>
              <span>相对来源变化</span>
              <strong>{comparison?.summary.changedFromSource ?? "--"}</strong>
            </div>
            <div>
              <span>相对发布变化</span>
              <strong>{comparison?.summary.changedFromPublished ?? "--"}</strong>
            </div>
            <div>
              <span>硬冲突</span>
              <strong>{comparison?.summary.hardConflictCount ?? draft?.draft.conflictCount ?? "--"}</strong>
            </div>
            <div>
              <span>最近调整</span>
              <strong>{draft?.changeEvents.length ?? "--"}</strong>
            </div>
          </div>
          <div className="governance-actions">
            <p className="muted">
              {draft?.draft.conflictCount
                ? "存在硬冲突时不能发布，请先修复草稿安排。"
                : draftLocked
                  ? "已发布或已废弃草稿仅保留审计与对比，不再允许调整。"
                  : "发布前请核对评分、变化数量和最近调整记录。"}
            </p>
            <button
              type="button"
              className="danger-button"
              disabled={!draft || draftLocked || draftBusy}
              onClick={onDiscardDraft}
            >
              废弃草稿
            </button>
          </div>
        </div>

        <DraftMatrix
          scheduleInput={scheduleInput}
          draft={draft}
          selectedAssignmentId={selectedAssignmentId}
          draftLocked={draftLocked}
          lookups={lookups}
          onSelectAssignment={onSelectAssignment}
          onMoveAssignment={onMoveAssignment}
        />
      </div>

      <div className="draft-inspector">
        <div className="inspector-title">
          <span>Selected Assignment</span>
          <strong>{selectedAssignmentId || "未选择考试"}</strong>
        </div>
        {selectedAssignment ? (
          <>
            <div className="form-grid compact">
              <label>
                <span>时间段</span>
                <select
                  value={draftForm.time_slot_id}
                  onChange={(event) => onDraftFormChange({
                    ...draftForm,
                    time_slot_id: event.target.value,
                  })}
                >
                  {scheduleInput?.time_slots.map((slot) => (
                    <option value={slot.id} key={slot.id}>
                      {slot.date} {slot.start_time}-{slot.end_time}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>考场</span>
                <select
                  value={draftForm.room_id}
                  onChange={(event) => onDraftFormChange({
                    ...draftForm,
                    room_id: event.target.value,
                  })}
                >
                  {scheduleInput?.rooms.map((room) => (
                    <option value={room.id} key={room.id}>{room.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>监考教师 ID</span>
                <input
                  value={draftForm.teacher_ids}
                  onChange={(event) => onDraftFormChange({
                    ...draftForm,
                    teacher_ids: event.target.value,
                  })}
                />
              </label>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={draftBusy || draftLocked || assignmentLocked}
              onClick={onSaveAdjustment}
            >
              <Save size={16} />
              保存调整并校验
            </button>
            <div className="lock-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={draftBusy || draftLocked || assignmentLocked}
                onClick={onLockAssignment}
                data-testid="draft-lock-assignment"
              >
                <Lock size={16} />
                锁定考试
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={draftBusy || draftLocked || !assignmentLocked}
                onClick={onUnlockAssignment}
                data-testid="draft-unlock-assignment"
              >
                <Unlock size={16} />
                解锁考试
              </button>
              <span data-testid="draft-lock-state">{assignmentLocked ? "已锁定" : "未锁定"}</span>
            </div>
          </>
        ) : <p className="muted">选择矩阵中的考试卡片后调整时间、考场和监考教师。</p>}

        <DraftSuggestions
          suggestions={suggestions}
          suggestionState={suggestionState}
          draftState={draftBusy ? "loading" : draftState}
          draftLocked={draftLocked}
          rooms={lookups.rooms}
          slots={lookups.slots}
          onApplySuggestion={onApplySuggestion}
        />

        <div className="conflict-list draft-conflicts">
          {draft?.conflicts.slice(0, 6).map((conflict) => (
            <article key={`${conflict.type}-${conflict.affected_ids.join("-")}`}>
              <strong>{conflict.type}</strong>
              <p>{conflict.message}</p>
              <span>{conflict.suggestion}</span>
            </article>
          ))}
          {draft && draft.conflicts.length === 0 ? <p className="muted">当前草稿没有硬约束冲突。</p> : null}
        </div>

        <div className="draft-events">
          {draft?.changeEvents.slice(0, 10).map((event) => (
            <article key={event.id}>
              <strong>{event.examTaskId}</strong>
              <span>{new Date(event.createdAt).toLocaleString()}</span>
              <p>{event.before.room_id}/{event.before.time_slot_id} → {event.after.room_id}/{event.after.time_slot_id}</p>
            </article>
          ))}
          {draft && draft.changeEvents.length === 0 ? <p className="muted">尚无人工调整记录。</p> : null}
        </div>
      </div>
    </div>
  );
}
