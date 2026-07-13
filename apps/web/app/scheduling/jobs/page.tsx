import { Suspense } from "react";
import { ScheduleJobsPage as ScheduleJobsFeaturePage } from "../../../features/async-jobs/schedule-jobs-page";

export default function SchedulingJobsPage() {
  return (
    <Suspense fallback={<div className="route-frame" aria-label="正在加载调度任务"><span /><span /><span /></div>}>
      <ScheduleJobsFeaturePage />
    </Suspense>
  );
}
