import { ApiClientError, apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";

export const audienceQueries = {
  current: () => ({
    queryKey: queryKeys.currentAudience,
    queryFn: () => apiClient.getCurrentAudience(),
    retry: false,
  }),
  schedule: () => ({
    queryKey: queryKeys.currentPublishedSchedule,
    queryFn: async () => {
      try {
        return await apiClient.getCurrentPublishedSchedule();
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 404) return null;
        throw error;
      }
    },
    retry: false,
  }),
  teacherAvailability: () => ({
    queryKey: queryKeys.currentTeacherAvailability,
    queryFn: () => apiClient.getCurrentTeacherAvailability(),
    retry: false,
  }),
};
