import type {
  AuditEventListResponse,
  AuditEventListQuery,
  AudienceScope,
  AuthContext,
  ConstraintProfile,
  ConstraintProfileRecord,
  CurrentPublishedScheduleResponse,
  CurrentTeacherAvailabilityResponse,
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
  ScheduleDraftRescheduleResponse,
  ScheduleJobListQuery,
  ScheduleJobListResponse,
  ScheduleJobDetailResponse,
  ScheduleJobResponse,
  ScheduleRollbackResponse,
  ScheduleRunComparisonResponse,
  ScheduleRunListResponse,
  ScheduleRunListQuery,
  ScheduleRunResponse,
  ScheduledExam,
  TeacherUnavailableSlotsResponse,
} from "@examforge/shared";

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
    credentials: "include",
    ...init,
  });

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("examforge:session-expired"));
    }
    throw new ApiClientError(response.status, await readErrorMessage(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

function jsonInit(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): RequestInit {
  return {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function internalReadInit(): RequestInit {
  return {};
}

function queryString(query: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  return text || `HTTP ${response.status}`;
}

export const apiClient = {
  login(username: string, password: string) {
    return requestJson<AuthContext>("/api/auth/login", jsonInit("POST", { username, password }));
  },

  getSession() {
    return requestJson<AuthContext>("/api/auth/me", internalReadInit());
  },

  logout() {
    return requestJson<void>("/api/auth/logout", jsonInit("POST"));
  },

  getDashboard() {
    return requestJson<DashboardResponse>("/api/dashboard", internalReadInit());
  },

  getCurrentAudience() {
    return requestJson<AudienceScope>("/api/me/audience", internalReadInit());
  },

  getCurrentPublishedSchedule() {
    return requestJson<CurrentPublishedScheduleResponse>(
      "/api/me/published-schedule",
      internalReadInit(),
    );
  },

  getCurrentTeacherAvailability() {
    return requestJson<CurrentTeacherAvailabilityResponse>(
      "/api/me/teacher-unavailable-slots",
      internalReadInit(),
    );
  },

  updateCurrentTeacherUnavailableSlots(slotIds: string[]) {
    return requestJson<TeacherUnavailableSlotsResponse>(
      "/api/me/teacher-unavailable-slots",
      jsonInit("PATCH", { unavailable_slot_ids: slotIds }),
    );
  },

  getReferenceData() {
    return requestJson<ReferenceDataResponse>("/api/reference-data", internalReadInit());
  },

  listConstraintProfiles() {
    return requestJson<{ profiles: ConstraintProfileRecord[] }>(
      "/api/constraint-profiles",
      internalReadInit(),
    );
  },

  createConstraintProfile(name: string, config: ConstraintProfile) {
    return requestJson<{ profile: ConstraintProfileRecord }>(
      "/api/constraint-profiles",
      jsonInit("POST", { name, config }),
    );
  },

  createConstraintProfileVersion(
    profileId: string,
    expectedCurrentVersionId: string,
    config: ConstraintProfile,
  ) {
    return requestJson<{ profile: ConstraintProfileRecord }>(
      `/api/constraint-profiles/${encodeURIComponent(profileId)}/versions`,
      jsonInit("POST", { expectedCurrentVersionId, config }),
    );
  },

  setConstraintProfileStatus(profileId: string, status: "active" | "disabled") {
    return requestJson<{ profile: ConstraintProfileRecord }>(
      `/api/constraint-profiles/${encodeURIComponent(profileId)}/status`,
      jsonInit("PATCH", { status }),
    );
  },

  setDefaultConstraintProfile(profileId: string) {
    return requestJson<{ profile: ConstraintProfileRecord }>(
      `/api/constraint-profiles/${encodeURIComponent(profileId)}/default`,
      jsonInit("PUT"),
    );
  },

  createReferenceRecord(
    resource: ReferenceResource,
    record: ReferenceRecord,
  ) {
    return requestJson<{ record: ReferenceRecord }>(
      `/api/reference-data/${resource}`,
      jsonInit("POST", record),
    );
  },

  updateReferenceRecord(
    resource: ReferenceResource,
    id: string,
    patch: Partial<ReferenceRecord>,
  ) {
    return requestJson<{ record: ReferenceRecord }>(
      `/api/reference-data/${resource}/${encodeURIComponent(id)}`,
      jsonInit("PATCH", patch),
    );
  },

  deleteReferenceRecord(resource: ReferenceResource, id: string) {
    return requestJson<ReferenceDeleteResponse>(
      `/api/reference-data/${resource}/${encodeURIComponent(id)}`,
      jsonInit("DELETE"),
    );
  },

  importReferenceRecords(
    resource: ReferenceResource,
    records: unknown[],
  ) {
    return requestJson<ReferenceImportResponse>(
      `/api/reference-data/${resource}/import`,
      jsonInit("POST", { records }),
    );
  },

  createScheduleRun() {
    return requestJson<ScheduleRunResponse>("/api/schedule-runs", jsonInit("POST"));
  },

  listScheduleRuns(query: ScheduleRunListQuery = { page: 1, pageSize: 20 }) {
    return requestJson<ScheduleRunListResponse>(
      `/api/schedule-runs?${queryString(query)}`,
      internalReadInit(),
    );
  },

  getScheduleRun(id: string) {
    return requestJson<ScheduleRunResponse>(
      `/api/schedule-runs/${encodeURIComponent(id)}`,
      internalReadInit(),
    );
  },

  compareScheduleRuns(baseId: string, targetId: string) {
    return requestJson<ScheduleRunComparisonResponse>(
      `/api/schedule-runs/compare?baseId=${encodeURIComponent(baseId)}&targetId=${encodeURIComponent(targetId)}`,
      internalReadInit(),
    );
  },

  publishScheduleRun(id: string) {
    return requestJson<PublishedScheduleResponse>(
      `/api/schedule-runs/${encodeURIComponent(id)}/publish`,
      jsonInit("POST"),
    );
  },

  createDraftFromRun(id: string) {
    return requestJson<ScheduleDraftDetailResponse>(
      `/api/schedule-runs/${encodeURIComponent(id)}/drafts`,
      jsonInit("POST"),
    );
  },

  listAuditEvents(query: AuditEventListQuery = { page: 1, pageSize: 20 }) {
    return requestJson<AuditEventListResponse>(
      `/api/audit-events?${queryString(query)}`,
      internalReadInit(),
    );
  },

  getPublishedSchedule() {
    return requestJson<PublishedScheduleResponse>("/api/published-schedule");
  },

  rollbackPublishedSchedule() {
    return requestJson<ScheduleRollbackResponse>(
      "/api/published-schedule/rollback",
      jsonInit("POST"),
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

  async downloadPublishedScheduleCsv() {
    const response = await fetch(`${apiBase}/api/published-schedule/export.csv`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      throw new ApiClientError(response.status, await readErrorMessage(response));
    }
    return await response.blob();
  },

  listScheduleDrafts() {
    return requestJson<ScheduleDraftListResponse>("/api/schedule-drafts", internalReadInit());
  },

  getScheduleDraft(id: string) {
    return requestJson<ScheduleDraftDetailResponse>(
      `/api/schedule-drafts/${encodeURIComponent(id)}`,
      internalReadInit(),
    );
  },

  updateScheduleDraftAssignment(
    draftId: string,
    examTaskId: string,
    patch: Pick<ScheduledExam, "room_id" | "time_slot_id" | "teacher_ids">,
  ) {
    return requestJson<ScheduleDraftDetailResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/assignments/${encodeURIComponent(examTaskId)}`,
      jsonInit("PATCH", patch),
    );
  },

  lockScheduleDraftAssignment(draftId: string, examTaskId: string) {
    return requestJson<ScheduleDraftDetailResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/assignments/${encodeURIComponent(examTaskId)}/lock`,
      jsonInit("POST"),
    );
  },

  unlockScheduleDraftAssignment(draftId: string, examTaskId: string) {
    return requestJson<ScheduleDraftDetailResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/assignments/${encodeURIComponent(examTaskId)}/unlock`,
      jsonInit("POST"),
    );
  },

  rebalanceScheduleDraft(draftId: string) {
    return requestJson<ScheduleDraftDetailResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/rebalance`,
      jsonInit("POST"),
    );
  },

  rescheduleScheduleDraft(draftId: string) {
    return requestJson<ScheduleDraftRescheduleResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/reschedule`,
      jsonInit("POST"),
    );
  },

  getScheduleDraftSuggestions(draftId: string, examTaskId: string) {
    return requestJson<ScheduleDraftAdjustmentSuggestionsResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/assignments/${encodeURIComponent(examTaskId)}/suggestions`,
      internalReadInit(),
    );
  },

  publishScheduleDraft(draftId: string) {
    return requestJson<ScheduleDraftPublishResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/publish`,
      jsonInit("POST"),
    );
  },

  discardScheduleDraft(draftId: string) {
    return requestJson<ScheduleDraftDiscardResponse>(
      `/api/schedule-drafts/${encodeURIComponent(draftId)}/discard`,
      jsonInit("POST"),
    );
  },

  compareScheduleDraft(id: string) {
    return requestJson<ScheduleDraftComparisonResponse>(
      `/api/schedule-drafts/${encodeURIComponent(id)}/compare`,
      internalReadInit(),
    );
  },

  createScheduleJob(constraintProfileVersionId?: string) {
    return requestJson<ScheduleJobResponse>(
      "/api/schedule-jobs",
      jsonInit("POST", constraintProfileVersionId ? { constraintProfileVersionId } : {}),
    );
  },

  listScheduleJobs(query: ScheduleJobListQuery = { page: 1, pageSize: 20 }) {
    return requestJson<ScheduleJobListResponse>(
      `/api/schedule-jobs?${queryString(query)}`,
      internalReadInit(),
    );
  },

  getScheduleJob(id: string) {
    return requestJson<ScheduleJobDetailResponse>(
      `/api/schedule-jobs/${encodeURIComponent(id)}`,
      internalReadInit(),
    );
  },

  cancelScheduleJob(id: string) {
    return requestJson<ScheduleJobResponse>(
      `/api/schedule-jobs/${encodeURIComponent(id)}/cancel`,
      jsonInit("POST"),
    );
  },

};
