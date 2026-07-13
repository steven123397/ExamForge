import { queryKeys } from "../../lib/query-keys";
import { referenceForms, type EditableResource } from "./reference-data-forms";

export interface ReferencePageState {
  resource: EditableResource;
  selectedId: string | null;
}

export function readReferencePageState(search: URLSearchParams): ReferencePageState {
  const candidate = search.get("resource");
  const resource = candidate && candidate in referenceForms
    ? candidate as EditableResource
    : "courses";
  return {
    resource,
    selectedId: search.get("id")?.trim() || null,
  };
}

export function updateReferencePageSearch(
  current: URLSearchParams,
  patch: Partial<ReferencePageState>,
) {
  const next = new URLSearchParams(current);
  if (patch.resource) {
    next.set("resource", patch.resource);
  }
  if (patch.selectedId === null) {
    next.delete("id");
  } else if (patch.selectedId) {
    next.set("id", patch.selectedId);
  }
  return next.toString();
}

export function referenceMutationInvalidationKeys() {
  return [queryKeys.referenceData, queryKeys.dashboard] as const;
}
