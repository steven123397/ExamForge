"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { OperationsRoutePage } from "../../components/layout/route-page";
import { PanelQueryError } from "../../components/shared/panel-query-error";
import { queryKeys } from "../../lib/query-keys";
import { useAuth } from "../auth/auth-provider";
import { ConstraintProfilePanel } from "./constraint-profile-panel";
import { constraintProfilesQueryOptions } from "./queries";

export function ConstraintProfilesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const query = useQuery(constraintProfilesQueryOptions());
  const profiles = query.data?.profiles ?? [];
  const requestedVersionId = searchParams.get("versionId")?.trim() ?? "";
  const requestedExists = profiles.some((profile) => profile.versions.some((version) => (
    version.id === requestedVersionId
  )));
  const fallbackProfile = profiles.find((profile) => profile.isDefault)
    ?? profiles.find((profile) => profile.status === "active")
    ?? profiles[0];
  const selectedVersionId = requestedExists
    ? requestedVersionId
    : fallbackProfile?.currentVersionId ?? "";

  useEffect(() => {
    if (query.data && selectedVersionId && selectedVersionId !== requestedVersionId) {
      updateVersion(selectedVersionId);
    }
  }, [query.data, requestedVersionId, selectedVersionId]);

  function updateVersion(versionId: string) {
    const next = new URLSearchParams(searchParams);
    if (versionId) {
      next.set("versionId", versionId);
    } else {
      next.delete("versionId");
    }
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  async function refreshAffectedQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.constraintProfiles, exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.scheduleJobsRoot }),
    ]);
  }

  return (
    <OperationsRoutePage title="约束策略" context="规则版本 · 生效配置">
      {query.data ? (
        <ConstraintProfilePanel
          profiles={profiles}
          isAdmin={auth?.user.roles.includes("admin") ?? false}
          selectedVersionId={selectedVersionId}
          loading={query.isFetching}
          onSelectVersion={updateVersion}
          onChanged={refreshAffectedQueries}
        />
      ) : query.isError ? (
        <PanelQueryError
          message="约束策略读取失败"
          retrying={query.isFetching}
          onRetry={() => query.refetch()}
        />
      ) : (
        <div className="route-frame" aria-label="正在加载约束策略"><span /><span /><span /></div>
      )}
    </OperationsRoutePage>
  );
}
