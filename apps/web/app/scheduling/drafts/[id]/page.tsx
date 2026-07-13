import { Suspense } from "react";
import { DraftWorkspacePage } from "../../../../features/draft-workspace/draft-workspace-page";

export default function SchedulingDraftPage() {
  return (
    <Suspense fallback={<div className="route-frame" aria-label="正在加载草稿"><span /><span /><span /></div>}>
      <DraftWorkspacePage />
    </Suspense>
  );
}
