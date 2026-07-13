"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { StatusPage } from "../../components/shared/status-page";
import { useAuth } from "./auth-provider";
import { SessionLoading } from "./route-guard";
import { defaultRouteForRoles } from "./routing";

export function RoleRedirect() {
  const router = useRouter();
  const { status, auth, restoreError, restore } = useAuth();

  useEffect(() => {
    if (status === "authenticated" && auth) {
      router.replace(defaultRouteForRoles(auth.user.roles));
    } else if (status === "anonymous") {
      router.replace("/login");
    }
  }, [auth, router, status]);

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
  return <SessionLoading />;
}
