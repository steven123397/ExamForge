import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import type { AuditEventListQuery, ScheduleRunListQuery } from "@examforge/shared";

export const runHistoryQueries = {
  runs: (query: ScheduleRunListQuery = { page: 1, pageSize: 20 }) => ({
    queryKey: queryKeys.scheduleRuns(query),
    queryFn: () => apiClient.listScheduleRuns(query),
    retry: false,
  }),
  auditEvents: (query: AuditEventListQuery = { page: 1, pageSize: 20 }) => ({
    queryKey: queryKeys.auditEvents(query),
    queryFn: () => apiClient.listAuditEvents(query),
    retry: false,
  }),
  comparison: (baseId: string, targetId: string) => ({
    queryKey: queryKeys.scheduleRunComparison(baseId, targetId),
    queryFn: () => apiClient.compareScheduleRuns(baseId, targetId),
  }),
};
