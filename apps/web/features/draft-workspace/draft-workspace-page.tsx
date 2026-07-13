"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { notFound, useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  ScheduleDraftAdjustmentSuggestion,
  ScheduleDraftDetailResponse,
  ScheduledExam,
} from "@examforge/shared";
import { OperationsRoutePage } from "../../components/layout/route-page";
import { ApiClientError, apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { referenceDataQueryOptions } from "../reference-data/queries";
import { runHistoryQueries } from "../run-history/queries";
import {
  readDraftWorkspaceRouteState,
  updateDraftWorkspaceSearch,
} from "./draft-page-model";
import { DraftWorkspace, type DraftAssignmentForm } from "./draft-workspace";
import { draftWorkspaceQueries } from "./queries";

const emptyForm: DraftAssignmentForm = {
  room_id: "",
  time_slot_id: "",
  teacher_ids: "",
};

export function DraftWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const state = readDraftWorkspaceRouteState(params.id ?? "", searchParams);
  const draftQuery = useQuery({
    ...draftWorkspaceQueries.draft(state.draftId),
    enabled: Boolean(state.draftId),
    retry: false,
  });
  const draftsQuery = useQuery({ ...draftWorkspaceQueries.drafts(), retry: false });
  const runsQuery = useQuery(runHistoryQueries.runs({ page: 1, pageSize: 100 }));
  const referenceQuery = useQuery(referenceDataQueryOptions());
  const comparisonQuery = useQuery({
    ...draftWorkspaceQueries.comparison(state.draftId),
    enabled: Boolean(draftQuery.data),
    retry: false,
  });
  const suggestionsQuery = useQuery({
    ...draftWorkspaceQueries.suggestions(state.draftId, state.examTaskId),
    enabled: Boolean(draftQuery.data && state.examTaskId),
    retry: false,
  });
  const [form, setForm] = useState<DraftAssignmentForm>(emptyForm);
  const [draftState, setDraftState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [rescheduleState, setRescheduleState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [reschedule, setReschedule] = useState<Awaited<ReturnType<typeof apiClient.rescheduleScheduleDraft>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft = draftQuery.data ?? null;
  const selectedAssignment = draft?.assignments.find((assignment) => (
    assignment.exam_task_id === state.examTaskId
  )) ?? null;

  useEffect(() => {
    if (!draft || state.examTaskId) {
      return;
    }
    const firstId = draft.assignments[0]?.exam_task_id;
    if (firstId) {
      updateUrl({ examTaskId: firstId });
    }
  }, [draft?.draft.id, state.examTaskId]);

  useEffect(() => {
    setForm(selectedAssignment ? {
      room_id: selectedAssignment.room_id,
      time_slot_id: selectedAssignment.time_slot_id,
      teacher_ids: selectedAssignment.teacher_ids.join(", "),
    } : emptyForm);
  }, [selectedAssignment?.exam_task_id, selectedAssignment?.room_id, selectedAssignment?.time_slot_id, selectedAssignment?.teacher_ids.join("\u0000")]);

  if (!state.draftId
    || (draftQuery.error instanceof ApiClientError && draftQuery.error.status === 404)) {
    notFound();
  }

  function updateUrl(patch: Parameters<typeof updateDraftWorkspaceSearch>[1]) {
    const next = updateDraftWorkspaceSearch(searchParams, patch);
    router.replace(`${pathname}${next ? `?${next}` : ""}`, { scroll: false });
  }

  async function refreshDraftFacts(payload?: ScheduleDraftDetailResponse) {
    if (payload) {
      queryClient.setQueryData(queryKeys.scheduleDraft(state.draftId), payload);
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.scheduleDrafts, exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.scheduleDraftComparison(state.draftId), exact: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.auditEventsRoot }),
    ]);
  }

  async function createDraft(runId: string) {
    setDraftState("loading");
    setError(null);
    try {
      const created = await apiClient.createDraftFromRun(runId);
      await queryClient.invalidateQueries({ queryKey: queryKeys.scheduleDrafts, exact: true });
      router.push(`/scheduling/drafts/${encodeURIComponent(created.draft.id)}`);
      setDraftState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿创建失败");
      setDraftState("error");
    }
  }

  async function saveAssignment(
    examTaskId: string,
    patch: Pick<ScheduledExam, "room_id" | "time_slot_id" | "teacher_ids">,
  ) {
    const current = queryClient.getQueryData<ScheduleDraftDetailResponse>(
      queryKeys.scheduleDraft(state.draftId),
    );
    const assignment = current?.assignments.find((item) => item.exam_task_id === examTaskId);
    const terminal = current?.draft.status === "published" || current?.draft.status === "discarded";
    if (!current || current.draft.id !== state.draftId || !assignment || terminal
      || current.lockedExamTaskIds?.includes(examTaskId)) {
      return;
    }
    setDraftState("loading");
    setReschedule(null);
    setRescheduleState("idle");
    setError(null);
    try {
      const updated = await apiClient.updateScheduleDraftAssignment(
        state.draftId,
        examTaskId,
        patch,
      );
      updateUrl({ examTaskId });
      await refreshDraftFacts(updated);
      await queryClient.invalidateQueries({ queryKey: queryKeys.scheduleDraftSuggestions(state.draftId, examTaskId) });
      setDraftState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿调整失败");
      setDraftState("error");
    }
  }

  async function mutateDraft(
    mutation: () => Promise<ScheduleDraftDetailResponse>,
    message: string,
  ) {
    setDraftState("loading");
    setReschedule(null);
    setRescheduleState("idle");
    setError(null);
    try {
      const updated = await mutation();
      await refreshDraftFacts(updated);
      setDraftState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : message);
      setDraftState("error");
    }
  }

  async function moveAssignment(examTaskId: string, roomId: string, timeSlotId: string) {
    const current = draftQuery.data;
    const assignment = current?.assignments.find((item) => item.exam_task_id === examTaskId);
    if (!current || current.draft.id !== state.draftId || !assignment) {
      return;
    }
    await saveAssignment(examTaskId, {
      room_id: roomId,
      time_slot_id: timeSlotId,
      teacher_ids: assignment.teacher_ids,
    });
  }

  async function applySuggestion(suggestion: ScheduleDraftAdjustmentSuggestion) {
    const generation = suggestionsQuery.data;
    if (!draft || !generation
      || generation.draft.id !== draft.draft.id
      || generation.examTaskId !== state.examTaskId
      || suggestion.assignment.exam_task_id !== state.examTaskId) {
      return;
    }
    await saveAssignment(state.examTaskId, {
      room_id: suggestion.assignment.room_id,
      time_slot_id: suggestion.assignment.time_slot_id,
      teacher_ids: suggestion.assignment.teacher_ids,
    });
  }

  async function rescheduleDraft() {
    if (!draft || draft.draft.id !== state.draftId) {
      return;
    }
    setRescheduleState("loading");
    setReschedule(null);
    setError(null);
    try {
      const response = await apiClient.rescheduleScheduleDraft(state.draftId);
      setReschedule(response);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.scheduleRunsRoot }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard, exact: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.auditEventsRoot }),
      ]);
      setRescheduleState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "增量重排失败");
      setRescheduleState("error");
    }
  }

  async function publishDraft() {
    if (!draft || draft.draft.id !== state.draftId) {
      return;
    }
    setDraftState("loading");
    setError(null);
    try {
      const published = await apiClient.publishScheduleDraft(state.draftId);
      await refreshDraftFacts({ ...draft, draft: published.draft });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.publishedSchedule, exact: true }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard, exact: true }),
      ]);
      setDraftState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿发布失败");
      setDraftState("error");
      throw reason;
    }
  }

  async function discardDraft() {
    if (!draft || draft.draft.id !== state.draftId) {
      return;
    }
    setDraftState("loading");
    setError(null);
    try {
      const discarded = await apiClient.discardScheduleDraft(state.draftId);
      await refreshDraftFacts({ ...draft, draft: discarded.draft });
      setDraftState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿废弃失败");
      setDraftState("error");
      throw reason;
    }
  }

  return (
    <OperationsRoutePage title="草稿工作区" context="人工调整 · 约束检查">
      {error ? <div className="alert" role="alert">{error}</div> : null}
      {draftQuery.isError ? <div className="alert" role="alert">草稿读取失败</div> : null}
      <DraftWorkspace
        drafts={draftsQuery.data?.drafts ?? []}
        runs={runsQuery.data?.runs ?? []}
        draft={draft}
        comparison={comparisonQuery.data ?? null}
        suggestions={suggestionsQuery.data ?? null}
        reschedule={reschedule}
        referenceData={referenceQuery.data ?? null}
        selectedAssignmentId={state.examTaskId}
        draftForm={form}
        draftState={draftQuery.isLoading ? "loading" : draftState}
        historyError={draftsQuery.isError}
        historyRetrying={draftsQuery.isFetching}
        suggestionState={suggestionsQuery.isFetching ? "loading" : suggestionsQuery.isError ? "error" : suggestionsQuery.data ? "ready" : "idle"}
        rescheduleState={rescheduleState}
        view={state.view}
        conflict={state.conflict}
        onCreateDraft={createDraft}
        onRetryHistory={() => draftsQuery.refetch()}
        onLoadDraft={async (draftId) => router.push(`/scheduling/drafts/${encodeURIComponent(draftId)}`)}
        onSelectAssignment={(examTaskId) => updateUrl({ examTaskId })}
        onDraftFormChange={setForm}
        onSaveAdjustment={() => state.examTaskId ? saveAssignment(state.examTaskId, {
          room_id: form.room_id,
          time_slot_id: form.time_slot_id,
          teacher_ids: splitList(form.teacher_ids),
        }) : Promise.resolve()}
        onApplySuggestion={applySuggestion}
        onMoveAssignment={moveAssignment}
        onLockAssignment={() => state.examTaskId
          ? mutateDraft(() => apiClient.lockScheduleDraftAssignment(state.draftId, state.examTaskId), "考试锁定失败")
          : Promise.resolve()}
        onUnlockAssignment={() => state.examTaskId
          ? mutateDraft(() => apiClient.unlockScheduleDraftAssignment(state.draftId, state.examTaskId), "考试解锁失败")
          : Promise.resolve()}
        onRebalanceDraft={() => mutateDraft(() => apiClient.rebalanceScheduleDraft(state.draftId), "局部再平衡失败")}
        onRescheduleDraft={rescheduleDraft}
        onPublishDraft={publishDraft}
        onDiscardDraft={discardDraft}
        onViewChange={(view) => updateUrl({ view })}
        onConflictChange={(conflict) => updateUrl({ conflict })}
      />
    </OperationsRoutePage>
  );
}

function splitList(value: string) {
  return value.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
}
