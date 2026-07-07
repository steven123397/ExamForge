import type { AuditEventFilter } from "@examforge/shared";

const defaultAuditLimit = 50;

export class AuditFilterValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "AuditFilterValidationError";
  }
}

export function parseAuditEventFilter(query: Record<string, unknown>): AuditEventFilter {
  const issues: string[] = [];
  const entityType = optionalString(query.entityType);
  const entityId = optionalString(query.entityId);
  const actor = optionalString(query.actor);
  const since = optionalDate("since", query.since, issues);
  const until = optionalDate("until", query.until, issues);

  if (since && until && Date.parse(since) > Date.parse(until)) {
    issues.push("since must be earlier than until");
  }

  if (issues.length > 0) {
    throw new AuditFilterValidationError(issues);
  }

  return {
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    ...(actor ? { actor } : {}),
    ...(since ? { since } : {}),
    ...(until ? { until } : {}),
    limit: defaultAuditLimit,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalDate(
  field: "since" | "until",
  value: unknown,
  issues: string[],
): string | undefined {
  const raw = optionalString(value);
  if (!raw) {
    return undefined;
  }
  const timestamp = Date.parse(raw);
  if (Number.isNaN(timestamp)) {
    issues.push(`${field} must be a valid date`);
    return undefined;
  }
  return new Date(timestamp).toISOString();
}
