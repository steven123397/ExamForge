import { Suspense } from "react";
import { ReferenceDataPage } from "../../../features/reference-data/reference-data-page";

export default function ReferenceDataRoute() {
  return (
    <Suspense fallback={<div className="session-loading">正在加载基础数据</div>}>
      <ReferenceDataPage />
    </Suspense>
  );
}
