import type { AuditEventListQuery } from "@examforge/shared";

export interface AuditPageState {
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  traceId: string;
  from: string;
  to: string;
  page: number;
  pageSize: number;
}

export function readAuditPageState(search: URLSearchParams): AuditPageState {
  return {
    actor: trimmed(search.get("actor")),
    action: trimmed(search.get("action")),
    entityType: trimmed(search.get("entityType")),
    entityId: trimmed(search.get("entityId")),
    traceId: trimmed(search.get("traceId")),
    from: validDate(search.get("from")),
    to: validDate(search.get("to")),
    page: boundedInteger(search.get("page"), 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: boundedInteger(search.get("pageSize"), 1, 100, 20),
  };
}

export function buildAuditEventApiQuery(state: AuditPageState): AuditEventListQuery {
  return {
    ...(state.actor ? { actor: state.actor } : {}),
    ...(state.action ? { action: state.action } : {}),
    ...(state.entityType ? { entityType: state.entityType } : {}),
    ...(state.entityId ? { entityId: state.entityId } : {}),
    ...(state.traceId ? { traceId: state.traceId } : {}),
    ...(state.from ? { from: `${state.from}T00:00:00.000Z` } : {}),
    ...(state.to ? { to: `${state.to}T23:59:59.999Z` } : {}),
    page: state.page,
    pageSize: state.pageSize,
  };
}

export function updateAuditPageSearch(current: URLSearchParams, patch: Partial<AuditPageState>) {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    const isDefault = (key === "page" && value === 1)
      || (key === "pageSize" && value === 20);
    if (value === "" || value === undefined || value === null || isDefault) {
      next.delete(key);
    } else {
      next.set(key, String(value));
    }
  }
  return next.toString();
}

function trimmed(value: string | null) {
  return value?.trim() ?? "";
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
