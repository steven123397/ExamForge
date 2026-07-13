import type { ScheduleRunListQuery, SolveStatus } from "@examforge/shared";

const statuses = new Set<SolveStatus>(["feasible", "partial", "infeasible", "error"]);

export interface ScheduleRunsPageState {
  status: SolveStatus | "all";
  runId: string;
  compareTo: string;
  page: number;
  pageSize: number;
}

export function readScheduleRunsPageState(search: URLSearchParams): ScheduleRunsPageState {
  const status = search.get("status") ?? "";
  return {
    status: statuses.has(status as SolveStatus) ? status as SolveStatus : "all",
    runId: search.get("runId")?.trim() ?? "",
    compareTo: search.get("compareTo")?.trim() ?? "",
    page: boundedInteger(search.get("page"), 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: boundedInteger(search.get("pageSize"), 1, 100, 20),
  };
}

export function buildScheduleRunApiQuery(state: ScheduleRunsPageState): ScheduleRunListQuery {
  return {
    ...(state.status === "all" ? {} : { status: state.status }),
    page: state.page,
    pageSize: state.pageSize,
  };
}

export function updateScheduleRunsPageSearch(
  current: URLSearchParams,
  patch: Partial<ScheduleRunsPageState>,
) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    const isDefault = (key === "status" && value === "all")
      || (key === "page" && value === 1)
      || (key === "pageSize" && value === 20);
    if (value === "" || value === undefined || value === null || isDefault) {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
  }
  return next.toString();
}

export function fallbackListPage(page: number, pageCount: number, total: number) {
  return total === 0 ? 1 : Math.max(1, Math.min(page, pageCount));
}

function boundedInteger(value: string | null, min: number, max: number, fallback: number) {
  if (!value || !/^\d+$/.test(value)) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
