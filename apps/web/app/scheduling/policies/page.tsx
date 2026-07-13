import { Suspense } from "react";
import { ConstraintProfilesPage } from "../../../features/constraint-profiles/constraint-profiles-page";

export default function SchedulingPoliciesPage() {
  return (
    <Suspense fallback={<div className="route-frame" aria-label="正在加载约束策略"><span /><span /><span /></div>}>
      <ConstraintProfilesPage />
    </Suspense>
  );
}
