import { History } from "lucide-react";
import type { AuditEventSummary } from "@examforge/shared";
import { PanelQueryError } from "../../components/shared/panel-query-error";

export function AuditEventsPanel({
  events,
  historyError,
  historyRetrying,
  onRetryHistory,
}: {
  events: AuditEventSummary[];
  historyError: boolean;
  historyRetrying: boolean;
  onRetryHistory(): Promise<unknown>;
}) {
  return (
    <div className="audit-list" data-testid="audit-events-panel">
      {historyError ? (
        <PanelQueryError
          message="审计历史读取失败。"
          retrying={historyRetrying}
          onRetry={onRetryHistory}
        />
      ) : events.slice(0, 8).map((event) => (
        <article key={event.id}>
          <History size={16} />
          <div>
            <strong>{event.action}</strong>
            <span>{event.entityType} · {event.entityId}</span>
            <p>{new Date(event.createdAt).toLocaleString()} · {event.actor}</p>
          </div>
        </article>
      ))}
      {!historyError && !events.length ? <p className="muted">暂无审计事件。</p> : null}
    </div>
  );
}
