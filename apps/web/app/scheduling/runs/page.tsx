import { Suspense } from "react";
import { RunHistoryPage } from "../../../features/run-history/run-history-page";

export default function SchedulingRunsPage() {
  return (
    <Suspense fallback={<div className="route-frame" aria-label="正在加载运行历史"><span /><span /><span /></div>}>
      <RunHistoryPage />
    </Suspense>
  );
}
