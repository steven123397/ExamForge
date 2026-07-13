import { useQuery } from "@tanstack/react-query";
import type { ScheduleJobListQuery, ScheduleJobSummary } from "@examforge/shared";
import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";

export function hasActiveScheduleJobs(jobs: ScheduleJobSummary[]) {
  return jobs.some((job) => job.status === "queued" || job.status === "running");
}

export function useScheduleJobsQuery(query: ScheduleJobListQuery = { page: 1, pageSize: 20 }) {
  return useQuery({
    queryKey: queryKeys.scheduleJobs(query),
    queryFn: () => apiClient.listScheduleJobs(query),
    retry: false,
  });
}
