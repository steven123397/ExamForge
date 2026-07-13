"use client";

import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarClock,
  Gauge,
  ListChecks,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Metric } from "../../components/shared/metric";
import { PanelQueryError } from "../../components/shared/panel-query-error";
import { OperationsRoutePage } from "../../components/layout/route-page";
import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { dashboardQueryOptions } from "./queries";

export function OverviewPage() {
  const dashboardQuery = useQuery(dashboardQueryOptions());
  const latestRunId = dashboardQuery.data?.latestRun?.id ?? null;
  const latestRunQuery = useQuery({
    queryKey: latestRunId ? queryKeys.scheduleRun(latestRunId) : ["schedule-runs", "none"],
    queryFn: () => apiClient.getScheduleRun(latestRunId as string),
    enabled: latestRunId !== null,
    retry: false,
  });
  const dashboard = dashboardQuery.data;
  const latestRun = latestRunQuery.data;
  const rooms = latestRun?.result.report?.room_utilization as
    | { rooms?: Array<{ room_id: string; average_utilization: number; exam_count: number }> }
    | undefined;

  return (
    <OperationsRoutePage title="运行概览" context="当前批次 · 数据健康">
      <div className="page-command-row">
        <div>
          <strong>{dashboard?.batch.name ?? "当前批次"}</strong>
          <span>{dashboard ? `${dashboard.batch.startDate} 至 ${dashboard.batch.endDate}` : "--"}</span>
        </div>
        <Link href="/scheduling/jobs" className="primary-button">
          <Activity size={18} aria-hidden="true" />
          进入任务中心
        </Link>
      </div>

      {dashboardQuery.isError ? (
        <PanelQueryError
          message="概览数据读取失败"
          retrying={dashboardQuery.isFetching}
          onRetry={() => dashboardQuery.refetch()}
        />
      ) : null}

      <section className="metric-grid overview-metrics" aria-label="批次指标">
        <Metric icon={ListChecks} label="考试任务" value={dashboard?.metrics.examTaskCount ?? "--"} />
        <Metric icon={Users} label="教师资源" value={dashboard?.metrics.teacherCount ?? "--"} />
        <Metric icon={Building2} label="可用考场" value={dashboard?.metrics.roomCount ?? "--"} />
        <Metric icon={CalendarClock} label="时间段" value={dashboard?.metrics.timeSlotCount ?? "--"} />
        <Metric icon={AlertTriangle} label="硬冲突" value={dashboard?.metrics.conflictCount ?? "--"} tone="danger" />
        <Metric icon={Gauge} label="当前评分" value={dashboard?.metrics.score ?? "--"} tone="score" />
      </section>

      <section className="overview-band" aria-labelledby="latest-run-title">
        <div className="section-heading-inline">
          <div>
            <span>Latest run</span>
            <h2 id="latest-run-title">当前运行</h2>
          </div>
          <Link href="/scheduling/runs">查看运行历史</Link>
        </div>
        {latestRunQuery.isError ? (
          <PanelQueryError
            message="最新运行详情读取失败"
            retrying={latestRunQuery.isFetching}
            onRetry={() => latestRunQuery.refetch()}
          />
        ) : latestRun ? (
          <dl className="overview-facts">
            <div><dt>状态</dt><dd>{latestRun.run.status}</dd></div>
            <div><dt>安排</dt><dd>{latestRun.run.assignmentCount}</dd></div>
            <div><dt>冲突</dt><dd>{latestRun.run.conflictCount}</dd></div>
            <div><dt>耗时</dt><dd>{latestRun.run.elapsedMs} ms</dd></div>
            <div><dt>策略版本</dt><dd>{latestRun.run.constraintProfileVersionId ?? "legacy"}</dd></div>
            <div><dt>Scheduler</dt><dd>{latestRun.run.schedulerVersion ?? "--"}</dd></div>
          </dl>
        ) : (
          <div className="data-empty">暂无运行记录</div>
        )}
      </section>

      <section className="overview-band" aria-labelledby="room-health-title">
        <div className="section-heading-inline">
          <div>
            <span>Capacity</span>
            <h2 id="room-health-title">考场利用率</h2>
          </div>
        </div>
        <div className="capacity-list">
          {(rooms?.rooms ?? []).slice(0, 6).map((room) => (
            <div className="capacity-row" key={room.room_id}>
              <span>{room.room_id}</span>
              <div><i style={{ width: `${Math.min(100, room.average_utilization * 100)}%` }} /></div>
              <strong>{Math.round(room.average_utilization * 100)}%</strong>
            </div>
          ))}
          {!rooms?.rooms?.length ? <div className="data-empty">暂无可用运行报告</div> : null}
        </div>
      </section>
    </OperationsRoutePage>
  );
}
