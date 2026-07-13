"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { OperationsRoutePage } from "../../components/layout/route-page";
import { PanelQueryError } from "../../components/shared/panel-query-error";
import { useAuth } from "../auth/auth-provider";
import {
  readReferencePageState,
  referenceMutationInvalidationKeys,
  updateReferencePageSearch,
  type ReferencePageState,
} from "./page-model";
import { referenceDataQueryOptions } from "./queries";
import { ReferenceDataManager } from "./reference-data-manager";

export function ReferenceDataPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { auth } = useAuth();
  const query = useQuery(referenceDataQueryOptions());
  const [mutationError, setMutationError] = useState<string | null>(null);
  const state = readReferencePageState(searchParams);

  function updateUrl(patch: Partial<ReferencePageState>) {
    const next = updateReferencePageSearch(searchParams, patch);
    router.replace(`${pathname}${next ? `?${next}` : ""}`, { scroll: false });
  }

  async function refreshAffectedQueries() {
    await Promise.all(referenceMutationInvalidationKeys().map((queryKey) => (
      queryClient.invalidateQueries({ queryKey, exact: true })
    )));
  }

  return (
    <OperationsRoutePage title="基础数据" context="资源目录 · 完整性治理">
      {mutationError ? <div className="alert" role="alert">{mutationError}</div> : null}
      {query.isError ? (
        <PanelQueryError
          message="基础数据读取失败"
          retrying={query.isFetching}
          onRetry={() => query.refetch()}
        />
      ) : null}
      {query.data ? (
        <ReferenceDataManager
          referenceData={query.data}
          resource={state.resource}
          selectedId={state.selectedId}
          canDelete={auth?.user.roles.includes("admin") ?? false}
          onResourceChange={(resource) => updateUrl({ resource, selectedId: null })}
          onSelectedIdChange={(selectedId) => updateUrl({ selectedId })}
          onRefresh={refreshAffectedQueries}
          onError={setMutationError}
        />
      ) : query.isLoading ? (
        <div className="route-frame" aria-label="正在加载基础数据"><span /><span /><span /></div>
      ) : null}
    </OperationsRoutePage>
  );
}
