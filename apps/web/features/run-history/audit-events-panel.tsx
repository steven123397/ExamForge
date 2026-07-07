import { History } from "lucide-react";
import type { AuditEventSummary } from "@examforge/shared";

export function AuditEventsPanel({ events }: { events: AuditEventSummary[] }) {
  return (
    <div className="audit-list">
      {events.slice(0, 8).map((event) => (
        <article key={event.id}>
          <History size={16} />
          <div>
            <strong>{event.action}</strong>
            <span>{event.entityType} · {event.entityId}</span>
            <p>{new Date(event.createdAt).toLocaleString()} · {event.actor}</p>
          </div>
        </article>
      ))}
      {!events.length ? <p className="muted">暂无审计事件。</p> : null}
    </div>
  );
}
