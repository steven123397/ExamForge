"use client";

import {
  ChevronLeft,
  ChevronRight,
  CircleStop,
  ExternalLink,
  Filter,
  FilterX,
  LoaderCircle,
  Play,
  Radio,
  WifiOff,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type {
  ConstraintProfileRecord,
  ScheduleJobAttempt,
  ScheduleJobEventEnvelope,
  ScheduleJobListResponse,
  ScheduleJobStatus,
  ScheduleJobSummary,
} from "@examforge/shared";
import type { LoadState } from "../../components/shared/load-state";
import { PanelQueryError } from "../../components/shared/panel-query-error";
import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import type { ScheduleJobEventConnectionState } from "./use-schedule-job-events";

export interface JobFilters {
  status: ScheduleJobStatus | "all";
  submittedBy: string;
  constraintProfileVersionId: string;
  from: string;
  to: string;
}

export function AsyncJobPanel({
  response,
  profiles,
  selectedVersionId,
  filters,
  selectedJobId,
  jobState,
  historyError,
  historyRetrying,
  connectionState,
  cancellingJobId,
  onRetryHistory,
  onCreateJob,
  onCancelJob,
  onOpenRun,
  onSelectedVersionChange,
  onFiltersChange,
  onPageChange,
  onPageSizeChange,
  onSelectJob,
}: {
  response: ScheduleJobListResponse;
  profiles: ConstraintProfileRecord[];
  selectedVersionId: string;
  filters: JobFilters;
  selectedJobId: string;
  jobState: LoadState;
  historyError: boolean;
  historyRetrying: boolean;
  connectionState: ScheduleJobEventConnectionState;
  cancellingJobId: string | null;
  onRetryHistory(): Promise<unknown>;
  onCreateJob(versionId?: string): Promise<void>;
  onCancelJob(id: string): Promise<void>;
  onOpenRun(id: string): Promise<void>;
  onSelectedVersionChange(versionId: string): void;
  onFiltersChange(patch: Partial<JobFilters>): void;
  onPageChange(page: number): void;
  onPageSizeChange(pageSize: number): void;
  onSelectJob(id: string): void;
}) {
  const jobs = response.jobs;
  const pageCount = Math.max(1, response.pageCount);
  const effectiveSelectedJobId = selectedJobId || jobs[0]?.id || "";
  const selectedSummary = jobs.find((job) => job.id === effectiveSelectedJobId)
    ?? jobs[0]
    ?? null;
  const detailQuery = useQuery({
    queryKey: queryKeys.scheduleJob(effectiveSelectedJobId || "none"),
    queryFn: () => apiClient.getScheduleJob(effectiveSelectedJobId),
    enabled: Boolean(effectiveSelectedJobId),
    retry: false,
  });
  const selectedJob = detailQuery.data?.job ?? selectedSummary;
  const selectedAttempts = detailQuery.data?.attempts ?? [];
  const selectedEvents = detailQuery.data?.events ?? [];
  const profileNames = new Map(profiles.flatMap((profile) => profile.versions.map((version) => (
    [version.id, `${profile.name} · v${version.versionNumber}`] as const
  ))));
  const activeProfileNames = new Map(profiles
    .filter((profile) => profile.status === "active")
    .flatMap((profile) => profile.versions.map((version) => (
      [version.id, `${profile.name} · v${version.versionNumber}`] as const
    ))));
  const connection = connectionPresentation(connectionState);
  const ConnectionIcon = connection.icon;

  function updateFilters(patch: Partial<JobFilters>) {
    onFiltersChange(patch);
  }

  return (
    <div className="task-center" data-testid="schedule-job-panel">
      <div className="task-toolbar">
        <label className="task-submit-profile">
          <span>提交策略</span>
          <select
            aria-label="提交任务使用的策略"
            value={selectedVersionId}
            onChange={(event) => onSelectedVersionChange(event.target.value)}
            disabled={jobState === "loading" || activeProfileNames.size === 0}
          >
            {[...activeProfileNames].map(([versionId, label]) => (
              <option key={versionId} value={versionId}>{label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={jobState === "loading" || !selectedVersionId}
          onClick={() => onCreateJob(selectedVersionId || undefined)}
          data-testid="schedule-job-create"
        >
          {jobState === "loading" ? <LoaderCircle size={16} className="spin-icon" /> : <Play size={16} />}
          提交后台排考
        </button>
        <span
          className={`job-connection job-connection-${connectionState}`}
          role="status"
          aria-live="polite"
          data-testid="schedule-job-connection"
        >
          <ConnectionIcon size={15} className={connectionState === "connecting" ? "spin-icon" : undefined} />
          {connection.label}
        </span>
      </div>

      <div className="task-filters" aria-label="任务筛选">
        <Filter size={15} aria-hidden="true" />
        <select
          aria-label="按状态筛选"
          value={filters.status}
          onChange={(event) => updateFilters({ status: event.target.value as JobFilters["status"] })}
        >
          <option value="all">全部状态</option>
          <option value="queued">排队中</option>
          <option value="running">运行中</option>
          <option value="succeeded">已完成</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
          <option value="timed_out">已超时</option>
        </select>
        <input
          aria-label="按提交人筛选"
          placeholder="提交人"
          value={filters.submittedBy}
          onChange={(event) => updateFilters({ submittedBy: event.target.value })}
        />
        <select
          aria-label="按策略筛选"
          value={filters.constraintProfileVersionId}
          onChange={(event) => updateFilters({ constraintProfileVersionId: event.target.value })}
        >
          <option value="">全部策略</option>
          {[...profileNames].map(([versionId, label]) => (
            <option key={versionId} value={versionId}>{label}</option>
          ))}
        </select>
        <input
          type="date"
          aria-label="创建日期起始"
          value={filters.from}
          onChange={(event) => updateFilters({ from: event.target.value })}
        />
        <input
          type="date"
          aria-label="创建日期结束"
          value={filters.to}
          onChange={(event) => updateFilters({ to: event.target.value })}
        />
        <button
          type="button"
          className="icon-button"
          title="清除筛选"
          aria-label="清除筛选"
          disabled={!filters.status || (
            filters.status === "all"
            && !filters.submittedBy
            && !filters.constraintProfileVersionId
            && !filters.from
            && !filters.to
          )}
          onClick={() => updateFilters({
            status: "all",
            submittedBy: "",
            constraintProfileVersionId: "",
            from: "",
            to: "",
          })}
        >
          <FilterX size={16} />
        </button>
      </div>

      {historyError ? (
        <PanelQueryError
          message="后台任务历史读取失败。"
          retrying={historyRetrying}
          onRetry={onRetryHistory}
        />
      ) : (
        <div className="task-center-layout">
          <div className="task-list-wrap">
            <div className="task-list" role={jobs.length ? "list" : undefined}>
              {jobs.map((job) => (
                <button
                  type="button"
                  role="listitem"
                  key={job.id}
                  className={selectedJob?.id === job.id ? "task-row active" : "task-row"}
                  onClick={() => onSelectJob(job.id)}
                >
                  <span className={`task-state task-state-${job.status}`}>{jobStatusLabel(job)}</span>
                  <span className="task-row-main">
                    <strong>{job.runId ?? job.id}</strong>
                    <small>{job.submittedBy ?? "system"} · {formatTime(job.createdAt)}</small>
                  </span>
                  <span className="task-row-strategy">
                    {profileNames.get(job.constraintProfileVersionId ?? "") ?? "Legacy / default"}
                  </span>
                  <span className="task-row-progress">{job.progress}%</span>
                </button>
              ))}
              {!jobs.length ? <p className="muted task-empty">没有符合筛选条件的后台任务。</p> : null}
            </div>
            <div className="task-pagination">
              <span>{response.total} 条 · 第 {response.page}/{pageCount} 页</span>
              <div>
                <select
                  aria-label="每页条数"
                  value={response.pageSize}
                  onChange={(event) => onPageSizeChange(Number(event.target.value))}
                >
                  <option value="20">20 / 页</option>
                  <option value="50">50 / 页</option>
                  <option value="100">100 / 页</option>
                </select>
                <button type="button" className="icon-button" title="上一页" aria-label="上一页" disabled={response.page <= 1} onClick={() => onPageChange(response.page - 1)}>
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <button type="button" className="icon-button" title="下一页" aria-label="下一页" disabled={response.page >= pageCount} onClick={() => onPageChange(response.page + 1)}>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          <div className="task-inspector">
            {selectedJob ? (
              <>
                <div className="task-inspector-head">
                  <div>
                    <span>{selectedJob.status}</span>
                    <strong>{selectedJob.id}</strong>
                  </div>
                  <div className="task-inspector-actions">
                    {selectedJob.runId ? (
                      <button type="button" className="mini-button" onClick={() => onOpenRun(selectedJob.runId!)}>
                        <ExternalLink size={14} />
                        打开运行
                      </button>
                    ) : null}
                    {isActive(selectedJob) ? (
                      <button
                        type="button"
                        className="danger-button job-cancel-button"
                        disabled={Boolean(selectedJob.cancellationRequestedAt) || cancellingJobId === selectedJob.id}
                        onClick={() => onCancelJob(selectedJob.id)}
                      >
                        {cancellingJobId === selectedJob.id ? <LoaderCircle size={15} className="spin-icon" /> : <CircleStop size={15} />}
                        {selectedJob.cancellationRequestedAt ? "取消处理中" : "取消"}
                      </button>
                    ) : null}
                  </div>
                </div>
                <dl className="task-facts-grid">
                  <div><dt>提交人</dt><dd>{selectedJob.submittedBy ?? "system"}</dd></div>
                  <div><dt>策略</dt><dd>{profileNames.get(selectedJob.constraintProfileVersionId ?? "") ?? "Legacy"}</dd></div>
                  <div><dt>Attempt</dt><dd>{selectedJob.attemptCount ?? 0}</dd></div>
                  <div><dt>Trace</dt><dd>{selectedJob.traceId.slice(0, 18)}</dd></div>
                </dl>
                {detailQuery.isError ? (
                  <PanelQueryError
                    message="任务执行轨迹读取失败。"
                    retrying={detailQuery.isFetching}
                    onRetry={() => detailQuery.refetch()}
                  />
                ) : null}
                <div className="task-timeline">
                  {buildJobTimeline(selectedJob, selectedEvents, selectedAttempts).map((event) => (
                    <div key={event.code}>
                      <i aria-hidden="true" />
                      <span><strong>{event.label}</strong><small>{event.detail}</small></span>
                      <time>{formatTime(event.at)}</time>
                    </div>
                  ))}
                </div>
                {selectedAttempts.length ? (
                  <ol className="task-attempts" aria-label="执行尝试">
                    {selectedAttempts.map((attempt) => (
                      <li key={attempt.id}>
                        <strong>Attempt {attempt.attemptNumber}</strong>
                        <span>{attempt.status} · {attempt.schedulerRequestId}</span>
                        <small>{attempt.durationMs === null ? "执行中" : `${attempt.durationMs} ms`}</small>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {selectedJob.error ? (
                  <div className="task-error-detail">
                    <strong>{selectedJob.error.code}</strong>
                    <p>{selectedJob.error.message}</p>
                    <span>{selectedJob.error.retryable ? "可重试故障" : "终态故障"}</span>
                  </div>
                ) : null}
              </>
            ) : <p className="muted">选择任务查看执行时间线。</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function buildJobTimeline(
  job: ScheduleJobSummary,
  events: ScheduleJobEventEnvelope[] = [],
  attempts: ScheduleJobAttempt[] = [],
) {
  if (events.length) {
    const attemptByNumber = new Map(attempts.map((attempt) => [attempt.attemptNumber, attempt]));
    return events
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .map((event) => eventTimelineItem(event, attemptByNumber));
  }
  const items = [{
    code: "queued",
    label: "进入队列",
    detail: "请求快照已冻结",
    at: job.queuedAt,
  }];
  if (job.startedAt) {
    items.push({
      code: "attempt_started",
      label: "开始执行",
      detail: `第 ${Math.max(1, job.attemptCount ?? 1)} 次执行`,
      at: job.startedAt,
    });
  }
  if (job.cancellationRequestedAt) {
    items.push({
      code: "cancellation_requested",
      label: "请求取消",
      detail: "等待 Worker 协作终止",
      at: job.cancellationRequestedAt,
    });
  }
  if (job.finishedAt) {
    items.push({
      code: `finished_${job.status}`,
      label: jobStatusLabel(job),
      detail: job.runId ? `生成 ${job.runId}` : job.error?.code ?? "任务结束",
      at: job.finishedAt,
    });
  }
  return items.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
}

function eventTimelineItem(
  event: ScheduleJobEventEnvelope,
  attemptByNumber: Map<number, ScheduleJobAttempt>,
) {
  const attemptNumber = typeof event.payload.attemptNumber === "number"
    ? event.payload.attemptNumber
    : null;
  const attempt = attemptNumber === null ? null : attemptByNumber.get(attemptNumber);
  const runId = typeof event.payload.runId === "string" ? event.payload.runId : null;
  const error = isRecord(event.payload.error) && typeof event.payload.error.code === "string"
    ? event.payload.error.code
    : null;
  const presentation = {
    "schedule_job.queued": ["进入队列", "请求快照已冻结"],
    "schedule_job.attempt_started": [
      "开始执行",
      `第 ${attemptNumber ?? "?"} 次执行${attempt ? ` · ${attempt.schedulerRequestId}` : ""}`,
    ],
    "schedule_job.running": ["求解中", `第 ${attemptNumber ?? "?"} 次执行已被 Worker 接管`],
    "schedule_job.stage_changed": ["阶段更新", String(event.payload.stage ?? "执行阶段已更新")],
    "schedule_job.retry_scheduled": [
      "等待重试",
      `第 ${attemptNumber ?? "?"} 次执行失败，等待重试`,
    ],
    "schedule_job.cancellation_requested": ["请求取消", "等待 Worker 协作终止"],
    "schedule_job.run_created": ["生成运行", runId ? `生成 ${runId}` : "排考运行已持久化"],
    "schedule_job.succeeded": ["已完成", runId ? `生成 ${runId}` : "任务成功结束"],
    "schedule_job.failed": ["失败", error ?? "任务失败"],
    "schedule_job.cancelled": ["已取消", "任务已终止"],
    "schedule_job.timed_out": ["已超时", error ?? "执行超过时限"],
  }[event.type];
  return {
    code: `${event.sequence}:${event.type}`,
    label: presentation[0],
    detail: presentation[1],
    at: event.occurredAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isActive(job: ScheduleJobSummary) {
  return job.status === "queued" || job.status === "running";
}

function jobStatusLabel(job: ScheduleJobSummary) {
  if (job.cancellationRequestedAt && job.status === "running") {
    return "正在取消";
  }
  return {
    queued: job.error?.retryable ? "等待重试" : "排队中",
    running: "求解中",
    succeeded: "已完成",
    failed: "失败",
    cancelled: "已取消",
    timed_out: "已超时",
  }[job.status];
}

function connectionPresentation(state: ScheduleJobEventConnectionState) {
  if (state === "connected") return { icon: Radio, label: "实时事件已连接" };
  if (state === "connecting") return { icon: LoaderCircle, label: "正在连接事件" };
  if (state === "degraded") return { icon: WifiOff, label: "事件中断，低频同步" };
  return { icon: Radio, label: "暂无活动作业" };
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
