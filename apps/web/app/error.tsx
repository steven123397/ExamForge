"use client";

import { StatusPage } from "../components/shared/status-page";

export default function ErrorPage({ reset }: { reset(): void }) {
  return (
    <StatusPage
      code="500"
      title="页面暂时不可用"
      detail="页面数据未能完成加载。"
      actionLabel="重试"
      onAction={reset}
    />
  );
}
