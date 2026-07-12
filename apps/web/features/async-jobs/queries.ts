import { useQuery } from "@tanstack/react-query";
import type { ScheduleJobSummary } from "@examforge/shared";
import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";

export function hasActiveScheduleJobs(jobs: ScheduleJobSummary[]) {
  return jobs.some((job) => job.status === "queued" || job.status === "running");
}

export function useScheduleJobsQuery() {
  return useQuery({
    queryKey: queryKeys.scheduleJobs,
    queryFn: () => apiClient.listScheduleJobs(),
    retry: false,
    refetchInterval: (query) => (
      hasActiveScheduleJobs(query.state.data?.jobs ?? []) ? 1200 : false
    ),
  });
}
