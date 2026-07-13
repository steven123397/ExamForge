import type { ScheduleJobListQuery, ScheduleJobStatus } from "@examforge/shared";

const statuses = new Set<ScheduleJobStatus>([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

export interface ScheduleJobsPageState {
  status: ScheduleJobStatus | "all";
  submittedBy: string;
  constraintProfileVersionId: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
  jobId: string;
}

export function readScheduleJobsPageState(search: URLSearchParams): ScheduleJobsPageState {
  const status = search.get("status") ?? "";
  return {
    status: statuses.has(status as ScheduleJobStatus) ? status as ScheduleJobStatus : "all",
    submittedBy: search.get("submittedBy")?.trim() ?? "",
    constraintProfileVersionId: search.get("constraintProfileVersionId")?.trim() ?? "",
    from: validDate(search.get("from")),
    to: validDate(search.get("to")),
    page: boundedInteger(search.get("page"), 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: boundedInteger(search.get("pageSize"), 1, 100, 20),
    jobId: search.get("jobId")?.trim() ?? "",
  };
}

export function buildScheduleJobApiQuery(state: ScheduleJobsPageState): ScheduleJobListQuery {
  return {
    ...(state.status === "all" ? {} : { status: state.status }),
    ...(state.submittedBy ? { submittedBy: state.submittedBy } : {}),
    ...(state.constraintProfileVersionId
      ? { constraintProfileVersionId: state.constraintProfileVersionId }
      : {}),
    ...(state.from ? { from: `${state.from}T00:00:00.000Z` } : {}),
    ...(state.to ? { to: `${state.to}T23:59:59.999Z` } : {}),
    page: state.page,
    pageSize: state.pageSize,
  };
}

export function updateScheduleJobsPageSearch(
  current: URLSearchParams,
  patch: Partial<ScheduleJobsPageState>,
) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    const isDefault = (key === "status" && value === "all")
      || (key === "page" && value === 1)
      || (key === "pageSize" && value === 20);
    if (value === "" || value === null || value === undefined || isDefault) {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
  }
  return next.toString();
}

export function fallbackScheduleJobPage(page: number, pageCount: number, total: number) {
  if (total === 0) {
    return 1;
  }
  return Math.max(1, Math.min(page, pageCount));
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "";
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
    ? ""
    : value;
}

function boundedInteger(value: string | null, min: number, max: number, fallback: number) {
  if (!value || !/^\d+$/.test(value)) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
