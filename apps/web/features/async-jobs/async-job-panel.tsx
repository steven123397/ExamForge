import { Play } from "lucide-react";
import type { ScheduleJobSummary } from "@examforge/shared";
import type { LoadState } from "../../components/shared/load-state";
import { PanelQueryError } from "../../components/shared/panel-query-error";

export function AsyncJobPanel({
  jobs,
  jobState,
  historyError,
  historyRetrying,
  onRetryHistory,
  onCreateJob,
}: {
  jobs: ScheduleJobSummary[];
  jobState: LoadState;
  historyError: boolean;
  historyRetrying: boolean;
  onRetryHistory(): Promise<unknown>;
  onCreateJob(): Promise<void>;
}) {
  return (
    <div className="job-panel" data-testid="schedule-job-panel">
      <div className="job-toolbar">
        <button
          type="button"
          className="secondary-button"
          disabled={jobState === "loading"}
          onClick={() => onCreateJob()}
          data-testid="schedule-job-create"
        >
          <Play size={16} />
          异步排考
        </button>
        <span>{jobs[0]?.status ?? "无后台作业"}</span>
      </div>
      <div className="job-list">
        {historyError ? (
          <PanelQueryError
            message="异步作业历史读取失败。"
            retrying={historyRetrying}
            onRetry={onRetryHistory}
          />
        ) : jobs.slice(0, 4).map((job) => (
          <article key={job.id}>
            <div>
              <strong>{job.status}</strong>
              <span>{job.runId ?? job.id.slice(0, 16)}</span>
            </div>
            <div className="progress-track" aria-label={`${job.progress}%`}>
              <div style={{ width: `${job.progress}%` }} />
            </div>
          </article>
        ))}
        {!historyError && !jobs.length ? <p className="muted">后台作业会显示队列、运行进度和生成的运行版本。</p> : null}
      </div>
    </div>
  );
}
