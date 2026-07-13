"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FilterX, History } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { OperationsRoutePage } from "../../components/layout/route-page";
import { PanelQueryError } from "../../components/shared/panel-query-error";
import {
  buildAuditEventApiQuery,
  readAuditPageState,
  updateAuditPageSearch,
  type AuditPageState,
} from "./audit-page-model";
import { fallbackListPage } from "./run-page-model";
import { runHistoryQueries } from "./queries";

export function AuditEventsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = readAuditPageState(searchParams);
  const apiQuery = useMemo(() => buildAuditEventApiQuery(state), [
    state.action,
    state.actor,
    state.entityId,
    state.entityType,
    state.from,
    state.page,
    state.pageSize,
    state.to,
    state.traceId,
  ]);
  const query = useQuery(runHistoryQueries.auditEvents(apiQuery));

  useEffect(() => {
    if (!query.data) {
      return;
    }
    const fallback = fallbackListPage(state.page, query.data.pageCount, query.data.total);
    if (fallback !== state.page) {
      updateUrl({ page: fallback });
    }
  }, [query.data?.pageCount, query.data?.total, state.page]);

  function updateUrl(patch: Partial<AuditPageState>) {
    const next = updateAuditPageSearch(searchParams, patch);
    router.replace(`${pathname}${next ? `?${next}` : ""}`, { scroll: false });
  }

  function updateFilter(patch: Partial<AuditPageState>) {
    updateUrl({ ...patch, page: 1 });
  }

  const filtersActive = Boolean(
    state.actor || state.action || state.entityType || state.entityId
    || state.traceId || state.from || state.to,
  );

  return (
    <OperationsRoutePage title="审计追踪" context="操作事实 · 关联链路">
      <div className="audit-filters" aria-label="审计筛选">
        <input aria-label="审计操作人" placeholder="操作人" value={state.actor} onChange={(event) => updateFilter({ actor: event.target.value })} />
        <input aria-label="审计动作" placeholder="动作" value={state.action} onChange={(event) => updateFilter({ action: event.target.value })} />
        <input aria-label="实体类型" placeholder="实体类型" value={state.entityType} onChange={(event) => updateFilter({ entityType: event.target.value })} />
        <input aria-label="实体 ID" placeholder="实体 ID" value={state.entityId} onChange={(event) => updateFilter({ entityId: event.target.value })} />
        <input aria-label="Trace ID" placeholder="Trace ID" value={state.traceId} onChange={(event) => updateFilter({ traceId: event.target.value })} />
        <input type="date" aria-label="审计日期起始" value={state.from} onChange={(event) => updateFilter({ from: event.target.value })} />
        <input type="date" aria-label="审计日期结束" value={state.to} onChange={(event) => updateFilter({ to: event.target.value })} />
        <button
          type="button"
          className="icon-button"
          title="清除筛选"
          aria-label="清除审计筛选"
          disabled={!filtersActive}
          onClick={() => updateFilter({
            actor: "",
            action: "",
            entityType: "",
            entityId: "",
            traceId: "",
            from: "",
            to: "",
          })}
        >
          <FilterX size={16} />
        </button>
      </div>

      {query.isError ? (
        <PanelQueryError
          message="审计历史读取失败"
          retrying={query.isFetching}
          onRetry={() => query.refetch()}
        />
      ) : query.data ? (
        <div className="audit-page-list" data-testid="audit-events-panel">
          {query.data.events.map((event) => (
            <article key={event.id}>
              <History size={17} aria-hidden="true" />
              <div className="audit-event-main">
                <strong>{event.action}</strong>
                <span>{event.entityType} · {event.entityId}</span>
                <p>{new Date(event.createdAt).toLocaleString()} · {event.actor}</p>
                {event.entityType === "schedule_run" ? (
                  <Link href={`/scheduling/runs?runId=${encodeURIComponent(event.entityId)}`}>打开运行</Link>
                ) : event.entityType === "schedule_draft" ? (
                  <Link href={`/scheduling/drafts/${encodeURIComponent(event.entityId)}`}>打开草稿</Link>
                ) : null}
              </div>
              <details>
                <summary>原始 payload</summary>
                <pre>{JSON.stringify(event.payload, null, 2)}</pre>
              </details>
            </article>
          ))}
          {!query.data.events.length ? <p className="muted">没有符合筛选条件的审计事件。</p> : null}
          <div className="task-pagination">
            <span>{query.data.total} 条 · 第 {query.data.page}/{Math.max(1, query.data.pageCount)} 页</span>
            <div>
              <select
                aria-label="审计每页条数"
                value={query.data.pageSize}
                onChange={(event) => updateUrl({ pageSize: Number(event.target.value), page: 1 })}
              >
                <option value="20">20 / 页</option><option value="50">50 / 页</option><option value="100">100 / 页</option>
              </select>
              <button type="button" className="icon-button" title="上一页" aria-label="上一页" disabled={query.data.page <= 1} onClick={() => updateUrl({ page: query.data.page - 1 })}><ChevronLeft size={16} aria-hidden="true" /></button>
              <button type="button" className="icon-button" title="下一页" aria-label="下一页" disabled={query.data.page >= Math.max(1, query.data.pageCount)} onClick={() => updateUrl({ page: query.data.page + 1 })}><ChevronRight size={16} aria-hidden="true" /></button>
            </div>
          </div>
        </div>
      ) : <div className="route-frame" aria-label="正在加载审计追踪"><span /><span /><span /></div>}
    </OperationsRoutePage>
  );
}
