import {
  auditEventListQuerySchema,
  type AuditEventListQuery,
} from "@examforge/shared";

export class AuditFilterValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "AuditFilterValidationError";
  }
}

export function parseAuditEventFilter(query: Record<string, unknown>): AuditEventListQuery {
  const normalized: Record<string, unknown> = {
    ...query,
    ...(query.from === undefined && query.since !== undefined ? { from: query.since } : {}),
    ...(query.to === undefined && query.until !== undefined ? { to: query.until } : {}),
  };
  delete normalized.since;
  delete normalized.until;
  const parsed = auditEventListQuerySchema.safeParse(normalized);
  if (!parsed.success) {
    throw new AuditFilterValidationError(parsed.error.issues.map((issue) => issue.message));
  }
  return parsed.data;
}
