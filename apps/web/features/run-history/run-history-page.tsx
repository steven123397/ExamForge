"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FilePenLine, RotateCcw, Send } from "lucide-react";
import Link from "next/link";
import { notFound, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { SolveStatus } from "@examforge/shared";
import { OperationsRoutePage } from "../../components/layout/route-page";
import { ConfirmationDialog } from "../../components/shared/confirmation-dialog";
import { PanelQueryError } from "../../components/shared/panel-query-error";
import { ApiClientError, apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { useAuth } from "../auth/auth-provider";
import {
  buildScheduleRunApiQuery,
  fallbackListPage,
  readScheduleRunsPageState,
  updateScheduleRunsPageSearch,
  type ScheduleRunsPageState,
} from "./run-page-model";
import { runHistoryQueries } from "./queries";

export function RunHistoryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const state = readScheduleRunsPageState(searchParams);
  const listQuery = useMemo(() => buildScheduleRunApiQuery(state), [
    state.page,
    state.pageSize,
    state.status,
  ]);
  const runsQuery = useQuery(runHistoryQueries.runs(listQuery));
  const effectiveRunId = state.runId || runsQuery.data?.runs[0]?.id || "";
  const detailQuery = useQuery({
    queryKey: queryKeys.scheduleRun(effectiveRunId || "none"),
    queryFn: () => apiClient.getScheduleRun(effectiveRunId),
    enabled: Boolean(effectiveRunId),
    retry: false,
  });
  const comparisonQuery = useQuery({
    ...runHistoryQueries.comparison(state.compareTo, effectiveRunId),
    enabled: Boolean(state.compareTo && effectiveRunId && state.compareTo !== effectiveRunId),
    retry: false,
  });
  const publishedQuery = useQuery({
    queryKey: queryKeys.publishedSchedule,
    queryFn: async () => {
      try {
        return await apiClient.getPublishedSchedule();
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    retry: false,
  });
  const [confirmation, setConfirmation] = useState<"publish" | "rollback" | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  useEffect(() => {
    if (!runsQuery.data) {
      return;
    }
    const fallback = fallbackListPage(state.page, runsQuery.data.pageCount, runsQuery.data.total);
    if (fallback !== state.page) {
      updateUrl({ page: fallback });
    }
  }, [runsQuery.data?.pageCount, runsQuery.data?.total, state.page]);

  if ((detailQuery.error instanceof ApiClientError && detailQuery.error.status === 404)
    || (comparisonQuery.error instanceof ApiClientError && comparisonQuery.error.status === 404)) {
    notFound();
  }

  function updateUrl(patch: Partial<ScheduleRunsPageState>) {
    const next = updateScheduleRunsPageSearch(searchParams, patch);
    router.replace(`${pathname}${next ? `?${next}` : ""}`, { scroll: false });
  }

  function hrefForRun(runId: string) {
    const next = updateScheduleRunsPageSearch(searchParams, { runId });
    return `${pathname}?${next}`;
  }

  async function refreshPublicationFacts() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.scheduleRunsRoot }),
      queryClient.invalidateQueries({ queryKey: queryKeys.auditEventsRoot }),
      queryClient.invalidateQueries({ queryKey: queryKeys.publishedSchedule, exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard, exact: true }),
    ]);
  }

  async function publish() {
    if (!effectiveRunId) {
      return;
    }
    setMutationError(null);
    try {
      await apiClient.publishScheduleRun(effectiveRunId);
      await refreshPublicationFacts();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "运行发布失败");
      throw error;
    }
  }

  async function rollback() {
    setMutationError(null);
    try {
      await apiClient.rollbackPublishedSchedule();
      await refreshPublicationFacts();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "发布回滚失败");
      throw error;
    }
  }

  async function createDraft() {
    if (!effectiveRunId) {
      return;
    }
    setMutationError(null);
    try {
      const created = await apiClient.createDraftFromRun(effectiveRunId);
      router.push(`/scheduling/drafts/${encodeURIComponent(created.draft.id)}`);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "草稿创建失败");
    }
  }

  const response = runsQuery.data;
  const detail = detailQuery.data;
  const publishable = detail
    ? (detail.run.status === "feasible" || detail.run.status === "partial")
      && detail.run.assignmentCount > 0
    : false;

  return (
    <OperationsRoutePage title="运行历史" context="求解结果 · 发布版本">
      {mutationError ? <div className="alert" role="alert">{mutationError}</div> : null}
      <div className="run-page-toolbar">
        <label>
          <span>运行状态</span>
          <select
            aria-label="按运行状态筛选"
            value={state.status}
            onChange={(event) => updateUrl({
              status: event.target.value as SolveStatus | "all",
              page: 1,
            })}
          >
            <option value="all">全部状态</option>
            <option value="feasible">可行</option>
            <option value="partial">部分可行</option>
            <option value="infeasible">不可行</option>
            <option value="error">错误</option>
          </select>
        </label>
        <label>
          <span>对比基准</span>
          <select
            aria-label="选择对比运行"
            value={state.compareTo}
            onChange={(event) => updateUrl({ compareTo: event.target.value })}
          >
            <option value="">不对比</option>
            {response?.runs.filter((run) => run.id !== effectiveRunId).map((run) => (
              <option value={run.id} key={run.id}>{run.id}</option>
            ))}
          </select>
        </label>
      </div>

      {runsQuery.isError ? (
        <PanelQueryError
          message="运行历史读取失败"
          retrying={runsQuery.isFetching}
          onRetry={() => runsQuery.refetch()}
        />
      ) : response ? (
        <div className="run-history-workspace" data-testid="run-history-panel">
          <section className="history-list" aria-label="运行列表">
            {response.runs.map((run) => (
              <article key={run.id} className={run.id === effectiveRunId ? "active" : ""}>
                <div>
                  <strong>{run.status}</strong>
                  <span>{new Date(run.createdAt).toLocaleString()}</span>
                  {publishedQuery.data?.run.id === run.id ? <em>已发布</em> : null}
                </div>
                <dl>
                  <div><dt>归一化评分</dt><dd>{run.normalizedScore ?? "--"}</dd></div>
                  <div><dt>安排</dt><dd>{run.assignmentCount}</dd></div>
                  <div><dt>冲突</dt><dd>{run.conflictCount}</dd></div>
                </dl>
                <Link className="mini-button" href={hrefForRun(run.id)}>查看</Link>
              </article>
            ))}
            {!response.runs.length ? <p className="muted">没有符合条件的运行记录。</p> : null}
            <ListPagination
              page={response.page}
              pageCount={response.pageCount}
              total={response.total}
              pageSize={response.pageSize}
              onPage={(page) => updateUrl({ page })}
              onPageSize={(pageSize) => updateUrl({ pageSize, page: 1 })}
            />
          </section>

          <section className="run-inspector" aria-label="运行详情">
            {detail ? (
              <>
                <header>
                  <div><span>{detail.run.status}</span><h2>{detail.run.id}</h2></div>
                  <div className="run-inspector-actions">
                    <button type="button" className="mini-button" onClick={() => void createDraft()}>
                      <FilePenLine size={15} />创建草稿
                    </button>
                    <button
                      type="button"
                      className="mini-button"
                      disabled={!publishable || publishedQuery.data?.run.id === detail.run.id}
                      onClick={() => setConfirmation("publish")}
                    >
                      <Send size={15} />发布
                    </button>
                  </div>
                </header>
                <dl className="run-facts-grid">
                  <div><dt>原始评分</dt><dd>{detail.run.score}</dd></div>
                  <div><dt>归一化评分</dt><dd>{detail.run.normalizedScore ?? "--"}</dd></div>
                  <div><dt>策略版本</dt><dd>{detail.run.constraintProfileVersionId ?? "Legacy"}</dd></div>
                  <div><dt>Scheduler</dt><dd>{detail.run.schedulerVersion ?? "unknown"}</dd></div>
                  <div><dt>评分合同</dt><dd>v{detail.run.scoringContractVersion ?? 0}</dd></div>
                  <div><dt>耗时</dt><dd>{detail.run.elapsedMs} ms</dd></div>
                </dl>
                {auth?.user.roles.includes("admin") ? (
                  <Link className="secondary-button" href={`/audit?entityType=schedule_run&entityId=${encodeURIComponent(detail.run.id)}`}>
                    查看相关审计
                  </Link>
                ) : null}
                {state.compareTo && comparisonQuery.data ? (
                  <div className="comparison-grid" aria-label="运行对比">
                    <div><span>评分变化</span><strong>{formatDelta(comparisonQuery.data.deltas.score)}</strong></div>
                    <div><span>安排变化</span><strong>{formatDelta(comparisonQuery.data.deltas.assignments)}</strong></div>
                    <div><span>冲突变化</span><strong>{formatDelta(comparisonQuery.data.deltas.conflicts)}</strong></div>
                    <div><span>耗时变化</span><strong>{formatDelta(comparisonQuery.data.deltas.elapsedMs)}</strong></div>
                  </div>
                ) : null}
              </>
            ) : detailQuery.isLoading ? <p className="muted">正在读取运行详情…</p> : (
              <p className="muted">选择运行查看详情。</p>
            )}
          </section>
        </div>
      ) : <div className="route-frame" aria-label="正在加载运行历史"><span /><span /><span /></div>}

      <div className="publish-box">
        <div><span>当前发布</span><strong>{publishedQuery.data?.run.id ?? "暂无发布版本"}</strong></div>
        <button
          type="button"
          className="secondary-button"
          disabled={!publishedQuery.data}
          onClick={() => setConfirmation("rollback")}
        >
          <RotateCcw size={16} />回滚发布
        </button>
      </div>
      {confirmation === "publish" ? (
        <ConfirmationDialog
          title="确认发布排考运行"
          target={effectiveRunId}
          description="确认后该运行将成为对外查询、通知和导出的正式排考。"
          confirmLabel="确认发布"
          onConfirm={publish}
          onCancel={() => setConfirmation(null)}
        />
      ) : null}
      {confirmation === "rollback" && publishedQuery.data ? (
        <ConfirmationDialog
          title="确认回滚发布"
          target={publishedQuery.data.run.id}
          description="确认后当前正式排考将被撤下，对外发布查询会随之变化。"
          confirmLabel="确认回滚"
          onConfirm={rollback}
          onCancel={() => setConfirmation(null)}
        />
      ) : null}
    </OperationsRoutePage>
  );
}

function ListPagination({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage(page: number): void;
  onPageSize(pageSize: number): void;
}) {
  const visiblePageCount = Math.max(1, pageCount);
  return (
    <div className="task-pagination">
      <span>{total} 条 · 第 {page}/{visiblePageCount} 页</span>
      <div>
        <select aria-label="运行每页条数" value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>
          <option value="20">20 / 页</option><option value="50">50 / 页</option><option value="100">100 / 页</option>
        </select>
        <button type="button" className="icon-button" title="上一页" aria-label="上一页" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
        <button type="button" className="icon-button" title="下一页" aria-label="下一页" disabled={page >= visiblePageCount} onClick={() => onPage(page + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
    </div>
  );
}

function formatDelta(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
