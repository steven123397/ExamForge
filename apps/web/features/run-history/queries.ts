import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";

export const runHistoryQueries = {
  runs: () => ({
    queryKey: queryKeys.scheduleRuns,
    queryFn: () => apiClient.listScheduleRuns(),
  }),
  auditEvents: () => ({
    queryKey: queryKeys.auditEvents,
    queryFn: () => apiClient.listAuditEvents(),
  }),
  comparison: (baseId: string, targetId: string) => ({
    queryKey: queryKeys.scheduleRunComparison(baseId, targetId),
    queryFn: () => apiClient.compareScheduleRuns(baseId, targetId),
  }),
};
