"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ScheduleJobStatus } from "@examforge/shared";
import { OperationsRoutePage } from "../../components/layout/route-page";
import { PanelQueryError } from "../../components/shared/panel-query-error";
import type { LoadState } from "../../components/shared/load-state";
import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { constraintProfilesQueryOptions } from "../constraint-profiles/queries";
import { AsyncJobPanel, type JobFilters } from "./async-job-panel";
import {
  buildScheduleJobApiQuery,
  fallbackScheduleJobPage,
  readScheduleJobsPageState,
  updateScheduleJobsPageSearch,
  type ScheduleJobsPageState,
} from "./job-page-model";
import { useScheduleJobsQuery } from "./queries";
import { useScheduleJobEvents } from "./use-schedule-job-events";

export function ScheduleJobsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const state = readScheduleJobsPageState(searchParams);
  const apiQuery = useMemo(() => buildScheduleJobApiQuery(state), [
    state.constraintProfileVersionId,
    state.from,
    state.page,
    state.pageSize,
    state.status,
    state.submittedBy,
    state.to,
  ]);
  const jobsQuery = useScheduleJobsQuery(apiQuery);
  const profilesQuery = useQuery(constraintProfilesQueryOptions());
  const profiles = profilesQuery.data?.profiles ?? [];
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [jobState, setJobState] = useState<LoadState>("idle");
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const connectionState = useScheduleJobEvents(jobsQuery.data?.jobs ?? []);

  useEffect(() => {
    const selectedExists = profiles.some((profile) => profile.versions.some((version) => (
      version.id === selectedVersionId && profile.status === "active"
    )));
    if (selectedExists) {
      return;
    }
    const preferred = profiles.find((profile) => profile.isDefault)
      ?? profiles.find((profile) => profile.status === "active");
    setSelectedVersionId(preferred?.currentVersionId ?? "");
  }, [profiles, selectedVersionId]);

  useEffect(() => {
    if (!jobsQuery.data) {
      return;
    }
    const fallback = fallbackScheduleJobPage(
      state.page,
      jobsQuery.data.pageCount,
      jobsQuery.data.total,
    );
    if (fallback !== state.page) {
      updateUrl({ page: fallback });
    }
  }, [jobsQuery.data?.pageCount, jobsQuery.data?.total, state.page]);

  function updateUrl(patch: Partial<ScheduleJobsPageState>) {
    const next = updateScheduleJobsPageSearch(searchParams, patch);
    router.replace(`${pathname}${next ? `?${next}` : ""}`, { scroll: false });
  }

  function updateFilters(patch: Partial<JobFilters>) {
    updateUrl({ ...patch, page: 1 });
  }

  async function createJob(versionId?: string) {
    setJobState("loading");
    setMutationError(null);
    try {
      const created = await apiClient.createScheduleJob(versionId);
      updateUrl({ jobId: created.job.id, page: 1 });
      await queryClient.invalidateQueries({ queryKey: queryKeys.scheduleJobsRoot });
      setJobState("ready");
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "后台任务提交失败");
      setJobState("error");
    }
  }

  async function cancelJob(id: string) {
    setCancellingJobId(id);
    setMutationError(null);
    try {
      await apiClient.cancelScheduleJob(id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.scheduleJobsRoot });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "任务取消失败");
    } finally {
      setCancellingJobId(null);
    }
  }

  async function openRun(id: string) {
    router.push(`/scheduling/runs?runId=${encodeURIComponent(id)}`);
  }

  const filters: JobFilters = {
    status: state.status as ScheduleJobStatus | "all",
    submittedBy: state.submittedBy,
    constraintProfileVersionId: state.constraintProfileVersionId,
    from: state.from,
    to: state.to,
  };

  return (
    <OperationsRoutePage title="调度任务" context="当前批次 · 作业队列">
      {mutationError ? <div className="alert" role="alert">{mutationError}</div> : null}
      {profilesQuery.isError ? (
        <PanelQueryError
          message="策略版本读取失败"
          retrying={profilesQuery.isFetching}
          onRetry={() => profilesQuery.refetch()}
        />
      ) : null}
      {jobsQuery.data ? (
        <AsyncJobPanel
          response={jobsQuery.data}
          profiles={profiles}
          selectedVersionId={selectedVersionId}
          filters={filters}
          selectedJobId={state.jobId}
          jobState={jobState}
          historyError={jobsQuery.isError}
          historyRetrying={jobsQuery.isFetching}
          connectionState={connectionState}
          cancellingJobId={cancellingJobId}
          onRetryHistory={() => jobsQuery.refetch()}
          onCreateJob={createJob}
          onCancelJob={cancelJob}
          onOpenRun={openRun}
          onSelectedVersionChange={setSelectedVersionId}
          onFiltersChange={updateFilters}
          onPageChange={(page) => updateUrl({ page })}
          onPageSizeChange={(pageSize) => updateUrl({ pageSize, page: 1 })}
          onSelectJob={(jobId) => updateUrl({ jobId })}
        />
      ) : jobsQuery.isError ? (
        <PanelQueryError
          message="后台任务历史读取失败"
          retrying={jobsQuery.isFetching}
          onRetry={() => jobsQuery.refetch()}
        />
      ) : (
        <div className="route-frame" aria-label="正在加载调度任务"><span /><span /><span /></div>
      )}
    </OperationsRoutePage>
  );
}
