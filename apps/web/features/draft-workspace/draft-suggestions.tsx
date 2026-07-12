import { Lightbulb } from "lucide-react";
import type {
  Room,
  ScheduleDraftAdjustmentSuggestion,
  ScheduleDraftAdjustmentSuggestionsResponse,
  TimeSlot,
} from "@examforge/shared";
import type { LoadState } from "../../components/shared/load-state";

export function DraftSuggestions({
  suggestions,
  selectedAssignmentId,
  suggestionState,
  draftState,
  draftLocked,
  rooms,
  slots,
  onApplySuggestion,
}: {
  suggestions: ScheduleDraftAdjustmentSuggestionsResponse | null;
  selectedAssignmentId: string;
  suggestionState: LoadState;
  draftState: LoadState;
  draftLocked: boolean;
  rooms: Map<string, Room>;
  slots: Map<string, TimeSlot>;
  onApplySuggestion(suggestion: ScheduleDraftAdjustmentSuggestion): Promise<void>;
}) {
  return (
    <div className="suggestion-panel" data-testid="draft-suggestion-panel">
      <div className="suggestion-title">
        <Lightbulb size={16} />
        <strong>局部调整建议</strong>
        <span data-testid="draft-suggestion-context">{selectedAssignmentId || "--"}</span>
        <span>{suggestionState === "loading" ? "计算中" : `${suggestions?.suggestions.length ?? 0} 项`}</span>
      </div>
      {suggestions?.suggestions.slice(0, 4).map((suggestion) => {
        const room = rooms.get(suggestion.assignment.room_id);
        const slot = slots.get(suggestion.assignment.time_slot_id);
        return (
          <article key={[
            suggestion.assignment.room_id,
            suggestion.assignment.time_slot_id,
            suggestion.assignment.teacher_ids.join("-"),
          ].join("|")}>
            <div>
              <strong>{room?.name ?? suggestion.assignment.room_id}</strong>
              <span>{slot ? `${slot.date} ${slot.start_time}-${slot.end_time}` : suggestion.assignment.time_slot_id}</span>
            </div>
            <p>{suggestion.reasons.join("；")}</p>
            <footer>
              <span>{suggestion.hardConflictCount} 冲突 · {suggestion.score} 分</span>
              <button
                type="button"
                className="secondary-button"
                data-testid="draft-suggestion-apply"
                disabled={
                  draftState === "loading"
                  || draftLocked
                  || suggestions?.examTaskId !== selectedAssignmentId
                  || suggestion.assignment.exam_task_id !== selectedAssignmentId
                  || suggestion.hardConflictCount > 0
                }
                onClick={() => onApplySuggestion(suggestion)}
              >
                应用
              </button>
            </footer>
          </article>
        );
      })}
      {suggestionState !== "loading" && !suggestions?.suggestions.length ? (
        <p className="muted">选择可编辑草稿中的考试后显示候选安排。</p>
      ) : null}
    </div>
  );
}
