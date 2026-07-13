import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";

export function referenceDataQueryOptions() {
  return {
    queryKey: queryKeys.referenceData,
    queryFn: () => apiClient.getReferenceData(),
    retry: false,
  };
}
