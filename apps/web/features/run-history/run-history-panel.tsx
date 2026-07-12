import { GitCompareArrows } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  PublishedScheduleResponse,
  ScheduleRunComparisonResponse,
  ScheduleRunSummary,
} from "@examforge/shared";
import type { LoadState } from "../../components/shared/load-state";
import { ConfirmationDialog } from "../../components/shared/confirmation-dialog";
import { PanelQueryError } from "../../components/shared/panel-query-error";

export function RunHistoryPanel({
  runs,
  comparison,
  publishedSchedule,
  compareState,
  publishState,
  historyError,
  historyRetrying,
  onRetryHistory,
  onCompare,
  onPublish,
  onCreateDraft,
  onRollback,
}: {
  runs: ScheduleRunSummary[];
  comparison: ScheduleRunComparisonResponse | null;
  publishedSchedule: PublishedScheduleResponse | null;
  compareState: LoadState;
  publishState: LoadState;
  historyError: boolean;
  historyRetrying: boolean;
  onRetryHistory(): Promise<unknown>;
  onCompare(baseId: string, targetId: string): Promise<void>;
  onPublish(id: string): Promise<void>;
  onCreateDraft(id: string): Promise<void>;
  onRollback(): Promise<void>;
}) {
  const [baseId, setBaseId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [confirmation, setConfirmation] = useState<{
    action: "publish" | "rollback";
    targetId: string;
  } | null>(null);

  useEffect(() => {
    if (runs.length >= 2) {
      setTargetId(runs[0].id);
      setBaseId(runs[1].id);
    } else if (runs.length === 1) {
      setTargetId(runs[0].id);
      setBaseId("");
    }
  }, [runs]);

  return (
    <div className="history-panel" data-testid="run-history-panel">
      <div className="history-list">
        {historyError ? (
          <PanelQueryError
            message="运行历史读取失败。"
            retrying={historyRetrying}
            onRetry={onRetryHistory}
          />
        ) : runs.slice(0, 6).map((run) => (
          <article key={run.id}>
            <div>
              <strong>{run.status}</strong>
              <span>{new Date(run.createdAt).toLocaleString()}</span>
              {publishedSchedule?.run.id === run.id ? <em>已发布</em> : null}
            </div>
            <dl>
              <div><dt>评分</dt><dd>{run.score}</dd></div>
              <div><dt>安排</dt><dd>{run.assignmentCount}</dd></div>
              <div><dt>冲突</dt><dd>{run.conflictCount}</dd></div>
            </dl>
            <button
              type="button"
              className="mini-button"
              disabled={publishState === "loading"}
              onClick={() => setConfirmation({ action: "publish", targetId: run.id })}
            >
              发布
            </button>
            <button
              type="button"
              className="mini-button"
              disabled={publishState === "loading"}
              onClick={() => onCreateDraft(run.id)}
            >
              草稿
            </button>
          </article>
        ))}
        {!historyError && !runs.length ? <p className="muted">运行排考后展示历史版本。</p> : null}
      </div>

      <div className="compare-box">
        <div className="compare-controls">
          <select value={baseId} onChange={(event) => setBaseId(event.target.value)}>
            <option value="">基准版本</option>
            {runs.map((run) => <option value={run.id} key={run.id}>{run.id}</option>)}
          </select>
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            <option value="">目标版本</option>
            {runs.map((run) => <option value={run.id} key={run.id}>{run.id}</option>)}
          </select>
          <button
            type="button"
            className="secondary-button"
            disabled={!baseId || !targetId || compareState === "loading"}
            onClick={() => onCompare(baseId, targetId)}
          >
            <GitCompareArrows size={16} />
            对比
          </button>
        </div>

        {comparison ? (
          <div className="comparison-grid">
            <div><span>评分变化</span><strong>{formatDelta(comparison.deltas.score)}</strong></div>
            <div><span>安排变化</span><strong>{formatDelta(comparison.deltas.assignments)}</strong></div>
            <div><span>冲突变化</span><strong>{formatDelta(comparison.deltas.conflicts)}</strong></div>
            <div><span>新增安排</span><strong>{comparison.assignmentChanges.added.length}</strong></div>
          </div>
        ) : <p className="muted">选择两个运行版本后查看差异。</p>}
      </div>

      <div className="publish-box">
        <div>
          <span>当前发布</span>
          <strong>{publishedSchedule?.run.id ?? "暂无发布版本"}</strong>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={!publishedSchedule || publishState === "loading"}
          onClick={() => publishedSchedule && setConfirmation({
            action: "rollback",
            targetId: publishedSchedule.run.id,
          })}
        >
          回滚发布
        </button>
      </div>
      {confirmation?.action === "publish" ? (
        <ConfirmationDialog
          title="确认发布排考运行"
          target={confirmation.targetId}
          description="确认后该运行将成为对外查询、通知和导出的正式排考。"
          confirmLabel="确认发布"
          onConfirm={() => onPublish(confirmation.targetId)}
          onCancel={() => setConfirmation(null)}
        />
      ) : null}
      {confirmation?.action === "rollback" ? (
        <ConfirmationDialog
          title="确认回滚发布"
          target={confirmation.targetId}
          description="确认后当前正式排考将被撤下，对外发布查询会随之变化。"
          confirmLabel="确认回滚"
          onConfirm={onRollback}
          onCancel={() => setConfirmation(null)}
        />
      ) : null}
    </div>
  );
}

function formatDelta(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
