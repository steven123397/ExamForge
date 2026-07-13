import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";

export function constraintProfilesQueryOptions() {
  return {
    queryKey: queryKeys.constraintProfiles,
    queryFn: () => apiClient.listConstraintProfiles(),
    retry: false,
  };
}
