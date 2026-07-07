import type {
  AuditEventListResponse,
  DashboardResponse,
  PublishedScheduleAudienceResponse,
  PublishedScheduleNotificationsResponse,
  PublishedScheduleResponse,
  ReferenceDataResponse,
  ReferenceDeleteResponse,
  ReferenceImportResponse,
  ReferenceRecord,
  ReferenceResource,
  ScheduleDraftAdjustmentSuggestionsResponse,
  ScheduleDraftComparisonResponse,
  ScheduleDraftDetailResponse,
  ScheduleDraftDiscardResponse,
  ScheduleDraftListResponse,
  ScheduleDraftPublishResponse,
  ScheduleJobListResponse,
  ScheduleJobResponse,
  ScheduleRollbackResponse,
  ScheduleRunComparisonResponse,
  ScheduleRunListResponse,
  ScheduleRunResponse,
  ScheduledExam,
  TeacherUnavailableSlotsResponse,
} from "@examforge/shared";
import { roleHeaders, type WorkspaceRole } from "./roles";

export const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    cache: "no-store",
    ...init,
  });

  if (!response.ok) {
    throw new ApiClientError(response.status, await readErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

function jsonInit(
  role: WorkspaceRole,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): RequestInit {
  return {
    method,
    headers: roleHeaders(role, body === undefined ? {} : { "content-type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  return text || `HTTP ${response.status}`;
}

export const apiClient = {
  getDashboard() {
    return requestJson<DashboardResponse>("/api/dashboard");
  },

  getReferenceData() {
    return requestJson<ReferenceDataResponse>("/api/reference-data");
  },

  createReferenceRecord(
    resource: ReferenceResource,
    record: ReferenceRecord,
    role: WorkspaceRole,
  ) {
    return requestJson<{ record: ReferenceRecord }>(
      `/api/reference-data/${resource}`,
      jsonInit(role, "POST", record),
    );
  },

  updateReferenceRecord(
    resource: ReferenceResource,
    id: string,
    patch: Partial<ReferenceRecord>,
    role: WorkspaceRole,
  ) {
    return requestJson<{ record: ReferenceRecord }>(
      `/api/reference-data/${resource}/${encodeURIComponent(id)}`,
      jsonInit(role, "PATCH", patch),
    );
  },

  deleteReferenceRecord(resource: ReferenceResource, id: string, role: WorkspaceRole) {
    return requestJson<ReferenceDeleteResponse>(
      `/api/reference-data/${resource}/${encodeURIComponent(id)}`,
      jsonInit(role, "DELETE"),
    );
  },

  importReferenceRecords(
    resource: ReferenceResource,
    records: unknown[],
    role: WorkspaceRole,
  ) {
    return requestJson<ReferenceImportResponse>(
      `/api/reference-data/${resource}/import`,
      jsonInit(role, "POST", { records }),
    );
  },

  createScheduleRun(role: WorkspaceRole) {
    return requestJson<ScheduleRunResponse>("/api/schedule-runs", jsonInit(role, "POST"));
  },

  listScheduleRuns() {
    return requestJson<ScheduleRunListResponse>("/api/schedule-runs");
  },

  getScheduleRun(id: string) {
    return requestJson<ScheduleRunResponse>(`/api/schedule-runs/${encodeURIComponent(id)}`);
  },

  compareScheduleRuns(baseId: string, targetId: string) {
    return requestJson<ScheduleRunComparisonResponse>(
      `/api/schedule-runs/compare?baseId=${encodeURIComponent(baseId)}&targetId=${encodeURIComponent(targetId)}`,
    );
  },

  publishScheduleRun(id: string, role: WorkspaceRole) {
    return requestJson<PublishedScheduleResponse>(
      `/api/schedule-runs/${encodeURIComponent(id)}/publish`,
      jsonInit(role, "POST"),
    );
  },

  createDraftFromRun(id: string, role: WorkspaceRole) {
    return requestJson<ScheduleDraftDetailResponse>(
      `/api/schedule-runs/${encodeURIComponent(id)}/drafts`,
      jsonInit(role, "POST"),
    );
  },

  listAuditEvents() {
    return requestJson<AuditEventListResponse>("/api/audit-events");
  },

  getPublishedSchedule() {
    return requestJson<PublishedScheduleResponse>("/api/published-schedule");
  },

  rollbackPublishedSchedule(role: WorkspaceRole) {
    return requestJson<ScheduleRollbackResponse>(
      "/api/published-schedule/rollback",
      jsonInit(role, "POST"),
    );
  },

  getPublishedTeacherSchedule(teacherId: string) {
    return requestJson<PublishedScheduleAudienceResponse>(
      `/api/published-schedule/teachers/${encodeURIComponent(teacherId)}`,
    );
  },

  getPublishedStudentSchedule(studentGroupId: string) {
    return requestJson<PublishedScheduleAudienceResponse>(
      `/api/published-schedule/student-groups/${encodeURIComponent(studentGroupId)}`,
    );
  },

  getPublishedScheduleNotifications() {
    return requestJson<PublishedScheduleNotificationsResponse>(
      "/api/published-schedule/notifications",
    );
  },

  publishedScheduleCsvUrl() {
    return `${apiBase}/api/published-schedule/export.csv`;
  },

  listScheduleDrafts() {
    return requestJson<ScheduleDraftListResponse>("/api/schedule-drafts");
  },

  getScheduleDraft(id: string) {
    return requestJson<ScheduleDraftDetailResponse>(`/api/schedule-drafts/${encodeURIComponent(id)}`);
  },

  updateScheduleDraftAssignment(
    draftId: string,
    examTaskId: string,
    patch: Pick<ScheduledExam, "room_id" | "time_slot_id" | "teacher_ids">,
    role: WorkspaceRole,
  ) {
    return requestJson<ScheduleDraftDetailResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/assignments/${encodeURIComponent(examTaskId)}`,
      jsonInit(role, "PATCH", patch),
    );
  },

  lockScheduleDraftAssignment(draftId: string, examTaskId: string, role: WorkspaceRole) {
    return requestJson<ScheduleDraftDetailResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/assignments/${encodeURIComponent(examTaskId)}/lock`,
      jsonInit(role, "POST"),
    );
  },

  unlockScheduleDraftAssignment(draftId: string, examTaskId: string, role: WorkspaceRole) {
    return requestJson<ScheduleDraftDetailResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/assignments/${encodeURIComponent(examTaskId)}/unlock`,
      jsonInit(role, "POST"),
    );
  },

  rebalanceScheduleDraft(draftId: string, role: WorkspaceRole) {
    return requestJson<ScheduleDraftDetailResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/rebalance`,
      jsonInit(role, "POST"),
    );
  },

  getScheduleDraftSuggestions(draftId: string, examTaskId: string) {
    return requestJson<ScheduleDraftAdjustmentSuggestionsResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/assignments/${encodeURIComponent(examTaskId)}/suggestions`,
    );
  },

  publishScheduleDraft(draftId: string, role: WorkspaceRole) {
    return requestJson<ScheduleDraftPublishResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/publish`,
      jsonInit(role, "POST"),
    );
  },

  discardScheduleDraft(draftId: string, role: WorkspaceRole) {
    return requestJson<ScheduleDraftDiscardResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/discard`,
      jsonInit(role, "POST"),
    );
  },

  compareScheduleDraft(id: string) {
    return requestJson<ScheduleDraftComparisonResponse>(
      `/api/schedule-drafts/${encodeURIComponent(id)}/compare`,
    );
  },

  createScheduleJob(role: WorkspaceRole) {
    return requestJson<ScheduleJobResponse>("/api/schedule-jobs", jsonInit(role, "POST"));
  },

  listScheduleJobs() {
    return requestJson<ScheduleJobListResponse>("/api/schedule-jobs");
  },

  updateTeacherUnavailableSlots(
    teacherId: string,
    slotIds: string[],
    role: WorkspaceRole,
  ) {
    return requestJson<TeacherUnavailableSlotsResponse>(
      `/api/teachers/${encodeURIComponent(teacherId)}/unavailable-slots`,
      jsonInit(role, "PATCH", { unavailable_slot_ids: slotIds }),
    );
  },
};
