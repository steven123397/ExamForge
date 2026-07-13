"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { StatusPage } from "../../components/shared/status-page";
import { useAuth } from "./auth-provider";
import { canAccessRoute, defaultRouteForRoles } from "./routing";

export function RouteGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, auth, restoreError, restore } = useAuth();

  useEffect(() => {
    if (status !== "anonymous") return;
    const returnTo = `${window.location.pathname}${window.location.search}`;
    router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }, [router, status]);

  if (status === "restoring" || status === "anonymous") {
    return <SessionLoading />;
  }
  if (status === "error") {
    return (
      <StatusPage
        code="503"
        title="暂时无法恢复会话"
        detail={restoreError ?? "认证服务当前不可用。"}
        actionLabel="重试"
        onAction={() => void restore()}
      />
    );
  }
  if (!auth || !canAccessRoute(auth.user.roles, pathname)) {
    return (
      <StatusPage
        code="403"
        title="无权访问此页面"
        detail="当前账户没有此页面所需的访问范围。"
        href={auth ? defaultRouteForRoles(auth.user.roles) : "/login"}
        actionLabel="返回工作区"
      />
    );
  }
  return children;
}

export function SessionLoading() {
  return (
    <main className="session-loading" aria-live="polite" aria-busy="true">
      <span className="loading-mark" aria-hidden="true" />
      正在恢复会话
    </main>
  );
}
