import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";

export function dashboardQueryOptions() {
  return {
    queryKey: queryKeys.dashboard,
    queryFn: () => apiClient.getDashboard(),
    retry: false,
  };
}
