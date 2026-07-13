import { Suspense } from "react";
import { AuditEventsPage } from "../../features/run-history/audit-events-page";

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="route-frame" aria-label="正在加载审计追踪"><span /><span /><span /></div>}>
      <AuditEventsPage />
    </Suspense>
  );
}
