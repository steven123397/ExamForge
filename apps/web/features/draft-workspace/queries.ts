import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";

export const draftWorkspaceQueries = {
  drafts: () => ({
    queryKey: queryKeys.scheduleDrafts,
    queryFn: () => apiClient.listScheduleDrafts(),
  }),
  draft: (id: string) => ({
    queryKey: queryKeys.scheduleDraft(id),
    queryFn: () => apiClient.getScheduleDraft(id),
  }),
  comparison: (id: string) => ({
    queryKey: queryKeys.scheduleDraftComparison(id),
    queryFn: () => apiClient.compareScheduleDraft(id),
  }),
  suggestions: (id: string, examTaskId: string) => ({
    queryKey: queryKeys.scheduleDraftSuggestions(id, examTaskId),
    queryFn: () => apiClient.getScheduleDraftSuggestions(id, examTaskId),
  }),
};
