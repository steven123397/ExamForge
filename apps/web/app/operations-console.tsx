"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CalendarClock,
  Check,
  ClipboardList,
  GitCompareArrows,
  Database,
  Download,
  Gauge,
  History,
  Lightbulb,
  Lock,
  Move,
  Plus,
  Play,
  RotateCcw,
  Save,
  ShieldCheck,
  Unlock,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DashboardResponse,
  AuditEventSummary,
  PublishedScheduleNotificationsResponse,
  PublishedScheduleAudienceResponse,
  PublishedScheduleResponse,
  ReferenceDataResponse,
  ReferenceRecord,
  ReferenceResource,
  ScheduleDraftAdjustmentSuggestion,
  ScheduleDraftAdjustmentSuggestionsResponse,
  ScheduleRunComparisonResponse,
  ScheduleDraftComparisonResponse,
  ScheduleDraftDetailResponse,
  ScheduleDraftPublishResponse,
  ScheduleDraftSummary,
  ScheduleJobSummary,
  ScheduleRunResponse,
  ScheduleRunSummary,
  ScheduledExam,
  Course,
  ExamTask,
  Room,
  StudentGroup,
  Teacher,
  TimeSlot,
} from "@examforge/shared";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type LoadState = "idle" | "loading" | "ready" | "error";
type EditableResource = ReferenceResource;
type FormState = Record<string, string>;
type DraftAssignmentForm = Pick<ScheduledExam, "room_id" | "time_slot_id"> & {
  teacher_ids: string;
};
type WorkspaceRole = "admin" | "operator" | "viewer";

const referenceForms = {
  courses: {
    label: "课程",
    fields: [
      ["id", "编号"],
      ["name", "名称"],
      ["department_id", "院系"],
      ["exam_type", "考试类型"],
    ],
    defaults: {
      id: "c-new",
      name: "",
      department_id: "cs",
      exam_type: "written",
    },
  },
  "student-groups": {
    label: "学生群体",
    fields: [
      ["id", "编号"],
      ["name", "名称"],
      ["size", "人数"],
      ["department_id", "院系"],
    ],
    defaults: {
      id: "g-new",
      name: "",
      size: "60",
      department_id: "cs",
    },
  },
  teachers: {
    label: "教师",
    fields: [
      ["id", "编号"],
      ["name", "姓名"],
      ["department_id", "院系"],
      ["unavailable_slot_ids", "不可用时段"],
    ],
    defaults: {
      id: "t-new",
      name: "",
      department_id: "cs",
      unavailable_slot_ids: "",
    },
  },
  rooms: {
    label: "考场",
    fields: [
      ["id", "编号"],
      ["name", "名称"],
      ["building_id", "楼栋"],
      ["capacity", "容量"],
      ["room_type", "类型"],
      ["equipment_tags", "设备"],
    ],
    defaults: {
      id: "r-new",
      name: "",
      building_id: "main",
      capacity: "60",
      room_type: "standard",
      equipment_tags: "",
    },
  },
  "time-slots": {
    label: "时间段",
    fields: [
      ["id", "编号"],
      ["date", "日期"],
      ["start_time", "开始"],
      ["end_time", "结束"],
      ["period_index", "序号"],
    ],
    defaults: {
      id: "slot-new",
      date: "2026-06-21",
      start_time: "09:00",
      end_time: "11:00",
      period_index: "20",
    },
  },
  "exam-tasks": {
    label: "考试任务",
    fields: [
      ["id", "编号"],
      ["course_id", "课程"],
      ["student_group_ids", "学生群体"],
      ["expected_count", "人数"],
      ["duration_minutes", "时长"],
      ["required_room_type", "考场类型"],
      ["required_equipment_tags", "设备"],
      ["allowed_slot_ids", "允许时段"],
      ["invigilator_count", "监考数"],
    ],
    defaults: {
      id: "task-new",
      course_id: "c-data-structures",
      student_group_ids: "g-cs-2301",
      expected_count: "60",
      duration_minutes: "120",
      required_room_type: "standard",
      required_equipment_tags: "",
      allowed_slot_ids: "",
      invigilator_count: "2",
    },
  },
} as const;

export function OperationsConsole() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [referenceData, setReferenceData] = useState<ReferenceDataResponse | null>(null);
  const [latestRun, setLatestRun] = useState<ScheduleRunResponse | null>(null);
  const [runHistory, setRunHistory] = useState<ScheduleRunSummary[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventSummary[]>([]);
  const [comparison, setComparison] = useState<ScheduleRunComparisonResponse | null>(null);
  const [publishedSchedule, setPublishedSchedule] = useState<PublishedScheduleResponse | null>(null);
  const [notifications, setNotifications] = useState<PublishedScheduleNotificationsResponse | null>(null);
  const [scheduleJobs, setScheduleJobs] = useState<ScheduleJobSummary[]>([]);
  const [drafts, setDrafts] = useState<ScheduleDraftSummary[]>([]);
  const [currentDraft, setCurrentDraft] = useState<ScheduleDraftDetailResponse | null>(null);
  const [draftComparison, setDraftComparison] = useState<ScheduleDraftComparisonResponse | null>(null);
  const [draftSuggestions, setDraftSuggestions] = useState<ScheduleDraftAdjustmentSuggestionsResponse | null>(null);
  const [selectedDraftAssignmentId, setSelectedDraftAssignmentId] = useState("");
  const [draftForm, setDraftForm] = useState<DraftAssignmentForm>({
    room_id: "",
    time_slot_id: "",
    teacher_ids: "",
  });
  const [teacherSchedule, setTeacherSchedule] = useState<PublishedScheduleAudienceResponse | null>(null);
  const [studentSchedule, setStudentSchedule] = useState<PublishedScheduleAudienceResponse | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [runState, setRunState] = useState<LoadState>("idle");
  const [compareState, setCompareState] = useState<LoadState>("idle");
  const [draftState, setDraftState] = useState<LoadState>("idle");
  const [suggestionState, setSuggestionState] = useState<LoadState>("idle");
  const [publishState, setPublishState] = useState<LoadState>("idle");
  const [queryState, setQueryState] = useState<LoadState>("idle");
  const [jobState, setJobState] = useState<LoadState>("idle");
  const [teacherState, setTeacherState] = useState<LoadState>("idle");
  const [notificationState, setNotificationState] = useState<LoadState>("idle");
  const [role, setRole] = useState<WorkspaceRole>("admin");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    if (!scheduleJobs.some((job) => job.status === "queued" || job.status === "running")) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      void loadScheduleJobs();
      void loadOperationalHistory();
    }, 1200);
    return () => window.clearInterval(timer);
  }, [scheduleJobs]);

  useEffect(() => {
    const selected = currentDraft?.assignments.find((assignment) => (
      assignment.exam_task_id === selectedDraftAssignmentId
    ));
    if (selected) {
      setDraftForm({
        room_id: selected.room_id,
        time_slot_id: selected.time_slot_id,
        teacher_ids: selected.teacher_ids.join(","),
      });
    }
  }, [currentDraft, selectedDraftAssignmentId]);

  useEffect(() => {
    const draftLocked = currentDraft?.draft.status === "published" || currentDraft?.draft.status === "discarded";
    if (currentDraft && selectedDraftAssignmentId && !draftLocked) {
      void loadDraftSuggestions(currentDraft.draft.id, selectedDraftAssignmentId);
    } else {
      setDraftSuggestions(null);
      setSuggestionState("idle");
    }
  }, [currentDraft?.draft.id, currentDraft?.draft.status, currentDraft?.draft.updatedAt, selectedDraftAssignmentId]);

  async function loadInitialData() {
    setState("loading");
    setError(null);
    try {
      const [dashboardResponse, referenceResponse] = await Promise.all([
        fetch(`${apiBase}/api/dashboard`, { cache: "no-store" }),
        fetch(`${apiBase}/api/reference-data`, { cache: "no-store" }),
      ]);
      if (!dashboardResponse.ok || !referenceResponse.ok) {
        throw new Error("API 响应异常");
      }
      const dashboardPayload = (await dashboardResponse.json()) as DashboardResponse;
      const referencePayload = (await referenceResponse.json()) as ReferenceDataResponse;
      setDashboard(dashboardPayload);
      setReferenceData(referencePayload);
      await loadOperationalHistory();
      setState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法连接 API");
      setState("error");
    }
  }

  async function runSchedule() {
    setRunState("loading");
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/schedule-runs`, {
        method: "POST",
        headers: roleHeaders(),
      });
      if (!response.ok) {
        throw new Error("排考运行失败");
      }
      const payload = (await response.json()) as ScheduleRunResponse;
      setLatestRun(payload);
      const dashboardResponse = await fetch(`${apiBase}/api/dashboard`, {
        cache: "no-store",
      });
      if (dashboardResponse.ok) {
        setDashboard((await dashboardResponse.json()) as DashboardResponse);
      }
      await loadOperationalHistory();
      setRunState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "排考运行失败");
      setRunState("error");
    }
  }

  async function runScheduleJob() {
    setJobState("loading");
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/schedule-jobs`, {
        method: "POST",
        headers: roleHeaders(),
      });
      if (!response.ok) {
        throw new Error(response.status === 403 ? "当前角色没有异步排考权限" : "异步排考启动失败");
      }
      const payload = (await response.json()) as { job: ScheduleJobSummary };
      setScheduleJobs((current) => [payload.job, ...current.filter((job) => job.id !== payload.job.id)]);
      setJobState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "异步排考启动失败");
      setJobState("error");
    }
  }

  async function loadOperationalHistory() {
    const [runsResponse, auditResponse, publishedResponse, draftsResponse, jobsResponse] = await Promise.all([
      fetch(`${apiBase}/api/schedule-runs`, { cache: "no-store" }),
      fetch(`${apiBase}/api/audit-events`, { cache: "no-store" }),
      fetch(`${apiBase}/api/published-schedule`, { cache: "no-store" }),
      fetch(`${apiBase}/api/schedule-drafts`, { cache: "no-store" }),
      fetch(`${apiBase}/api/schedule-jobs`, { cache: "no-store" }),
    ]);

    if (runsResponse.ok) {
      const payload = (await runsResponse.json()) as { runs: ScheduleRunSummary[] };
      setRunHistory(payload.runs);
    }
    if (auditResponse.ok) {
      const payload = (await auditResponse.json()) as { events: AuditEventSummary[] };
      setAuditEvents(payload.events);
    }
    if (publishedResponse.ok) {
      setPublishedSchedule((await publishedResponse.json()) as PublishedScheduleResponse);
      await loadNotifications();
    } else if (publishedResponse.status === 404) {
      setPublishedSchedule(null);
      setNotifications(null);
      setTeacherSchedule(null);
      setStudentSchedule(null);
    }
    if (draftsResponse.ok) {
      const payload = (await draftsResponse.json()) as { drafts: ScheduleDraftSummary[] };
      setDrafts(payload.drafts);
    }
    if (jobsResponse.ok) {
      const payload = (await jobsResponse.json()) as { jobs: ScheduleJobSummary[] };
      setScheduleJobs(payload.jobs);
    }
  }

  async function loadScheduleJobs() {
    const response = await fetch(`${apiBase}/api/schedule-jobs`, { cache: "no-store" });
    if (response.ok) {
      const payload = (await response.json()) as { jobs: ScheduleJobSummary[] };
      setScheduleJobs(payload.jobs);
      const latestCompleted = payload.jobs.find((job) => job.status === "completed" && job.runId);
      if (latestCompleted?.runId) {
        const runResponse = await fetch(`${apiBase}/api/schedule-runs/${encodeURIComponent(latestCompleted.runId)}`, {
          cache: "no-store",
        });
        if (runResponse.ok) {
          setLatestRun((await runResponse.json()) as ScheduleRunResponse);
        }
      }
    }
  }

  async function compareRuns(baseId: string, targetId: string) {
    setCompareState("loading");
    setError(null);
    try {
      const response = await fetch(
        `${apiBase}/api/schedule-runs/compare?baseId=${encodeURIComponent(baseId)}&targetId=${encodeURIComponent(targetId)}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error("版本对比失败");
      }
      setComparison((await response.json()) as ScheduleRunComparisonResponse);
      setCompareState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "版本对比失败");
      setCompareState("error");
    }
  }

  async function publishRun(id: string) {
    setPublishState("loading");
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/schedule-runs/${encodeURIComponent(id)}/publish`, {
        method: "POST",
        headers: roleHeaders(),
      });
      if (!response.ok) {
        throw new Error("方案发布失败");
      }
      setPublishedSchedule((await response.json()) as PublishedScheduleResponse);
      await loadOperationalHistory();
      const dashboardResponse = await fetch(`${apiBase}/api/dashboard`, { cache: "no-store" });
      if (dashboardResponse.ok) {
        setDashboard((await dashboardResponse.json()) as DashboardResponse);
      }
      setPublishState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "方案发布失败");
      setPublishState("error");
    }
  }

  async function createDraftFromRun(id: string) {
    setDraftState("loading");
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/schedule-runs/${encodeURIComponent(id)}/drafts`, {
        method: "POST",
        headers: roleHeaders(),
      });
      if (!response.ok) {
        throw new Error("草稿创建失败");
      }
      const payload = (await response.json()) as ScheduleDraftDetailResponse;
      setCurrentDraft(payload);
      setSelectedDraftAssignmentId(payload.assignments[0]?.exam_task_id ?? "");
      await loadDraftComparison(payload.draft.id);
      await loadOperationalHistory();
      setDraftState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿创建失败");
      setDraftState("error");
    }
  }

  async function loadDraft(id: string) {
    setDraftState("loading");
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/schedule-drafts/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("草稿读取失败");
      }
      const payload = (await response.json()) as ScheduleDraftDetailResponse;
      setCurrentDraft(payload);
      setSelectedDraftAssignmentId(payload.assignments[0]?.exam_task_id ?? "");
      await loadDraftComparison(payload.draft.id);
      setDraftState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿读取失败");
      setDraftState("error");
    }
  }

  async function adjustDraftAssignment() {
    if (!currentDraft || !selectedDraftAssignmentId) {
      return;
    }
    await saveDraftAssignment(selectedDraftAssignmentId, {
      room_id: draftForm.room_id,
      time_slot_id: draftForm.time_slot_id,
      teacher_ids: splitList(draftForm.teacher_ids),
    });
  }

  async function applyDraftSuggestion(suggestion: ScheduleDraftAdjustmentSuggestion) {
    await saveDraftAssignment(suggestion.assignment.exam_task_id, {
      room_id: suggestion.assignment.room_id,
      time_slot_id: suggestion.assignment.time_slot_id,
      teacher_ids: suggestion.assignment.teacher_ids,
    });
  }

  async function moveDraftAssignment(examTaskId: string, roomId: string, timeSlotId: string) {
    const currentAssignment = currentDraft?.assignments.find((assignment) => (
      assignment.exam_task_id === examTaskId
    ));
    if (!currentAssignment) {
      return;
    }
    setSelectedDraftAssignmentId(examTaskId);
    await saveDraftAssignment(examTaskId, {
      room_id: roomId,
      time_slot_id: timeSlotId,
      teacher_ids: currentAssignment.teacher_ids,
    });
  }

  async function saveDraftAssignment(
    examTaskId: string,
    patch: Pick<ScheduledExam, "room_id" | "time_slot_id" | "teacher_ids">,
  ) {
    if (!currentDraft) {
      return;
    }
    setDraftState("loading");
    setError(null);
    try {
      const response = await fetch(
        `${apiBase}/api/schedule-drafts/${encodeURIComponent(currentDraft.draft.id)}/assignments/${encodeURIComponent(examTaskId)}`,
        {
          method: "PATCH",
          headers: roleHeaders({ "content-type": "application/json" }),
          body: JSON.stringify(patch),
        },
      );
      if (!response.ok) {
        throw new Error("草稿调整失败");
      }
      const payload = (await response.json()) as ScheduleDraftDetailResponse;
      setCurrentDraft(payload);
      setSelectedDraftAssignmentId(examTaskId);
      await loadDraftComparison(payload.draft.id);
      await loadOperationalHistory();
      setDraftState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿调整失败");
      setDraftState("error");
    }
  }

  async function lockDraftAssignment() {
    if (!currentDraft || !selectedDraftAssignmentId) {
      return;
    }
    await mutateDraft(
      `/api/schedule-drafts/${encodeURIComponent(currentDraft.draft.id)}/assignments/${encodeURIComponent(selectedDraftAssignmentId)}/lock`,
      "考试锁定失败",
    );
  }

  async function unlockDraftAssignment() {
    if (!currentDraft || !selectedDraftAssignmentId) {
      return;
    }
    await mutateDraft(
      `/api/schedule-drafts/${encodeURIComponent(currentDraft.draft.id)}/assignments/${encodeURIComponent(selectedDraftAssignmentId)}/unlock`,
      "考试解锁失败",
    );
  }

  async function rebalanceDraft() {
    if (!currentDraft) {
      return;
    }
    await mutateDraft(
      `/api/schedule-drafts/${encodeURIComponent(currentDraft.draft.id)}/rebalance`,
      "局部再平衡失败",
    );
  }

  async function mutateDraft(path: string, message: string) {
    setDraftState("loading");
    setError(null);
    try {
      const response = await fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: roleHeaders(),
      });
      if (!response.ok) {
        throw new Error(message);
      }
      const payload = (await response.json()) as ScheduleDraftDetailResponse;
      setCurrentDraft(payload);
      await loadDraftComparison(payload.draft.id);
      await loadOperationalHistory();
      setDraftState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : message);
      setDraftState("error");
    }
  }

  async function loadDraftSuggestions(id: string, examTaskId: string) {
    setSuggestionState("loading");
    try {
      const response = await fetch(
        `${apiBase}/api/schedule-drafts/${encodeURIComponent(id)}/assignments/${encodeURIComponent(examTaskId)}/suggestions`,
        { cache: "no-store" },
      );
      if (response.ok) {
        setDraftSuggestions((await response.json()) as ScheduleDraftAdjustmentSuggestionsResponse);
        setSuggestionState("ready");
      } else {
        setDraftSuggestions(null);
        setSuggestionState(response.status === 404 ? "idle" : "error");
      }
    } catch {
      setDraftSuggestions(null);
      setSuggestionState("error");
    }
  }

  async function publishDraft() {
    if (!currentDraft) {
      return;
    }
    setDraftState("loading");
    setError(null);
    try {
      const response = await fetch(
        `${apiBase}/api/schedule-drafts/${encodeURIComponent(currentDraft.draft.id)}/publish`,
        { method: "POST", headers: roleHeaders() },
      );
      if (!response.ok) {
        throw new Error(response.status === 409 ? "草稿仍有硬冲突，不能发布" : "草稿发布失败");
      }
      const payload = (await response.json()) as ScheduleDraftPublishResponse;
      setPublishedSchedule(payload);
      setCurrentDraft((current) => current ? {
        ...current,
        draft: payload.draft,
      } : current);
      await loadDraftComparison(payload.draft.id);
      await loadOperationalHistory();
      setDraftState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿发布失败");
      setDraftState("error");
    }
  }

  async function discardDraft() {
    if (!currentDraft) {
      return;
    }
    setDraftState("loading");
    setError(null);
    try {
      const response = await fetch(
        `${apiBase}/api/schedule-drafts/${encodeURIComponent(currentDraft.draft.id)}/discard`,
        { method: "POST", headers: roleHeaders() },
      );
      if (!response.ok) {
        throw new Error("草稿废弃失败");
      }
      const payload = (await response.json()) as { draft: ScheduleDraftSummary };
      setCurrentDraft((current) => current ? {
        ...current,
        draft: payload.draft,
      } : current);
      await loadDraftComparison(payload.draft.id);
      await loadOperationalHistory();
      setDraftState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "草稿废弃失败");
      setDraftState("error");
    }
  }

  async function loadDraftComparison(id: string) {
    const response = await fetch(`${apiBase}/api/schedule-drafts/${encodeURIComponent(id)}/compare`, {
      cache: "no-store",
    });
    if (response.ok) {
      setDraftComparison((await response.json()) as ScheduleDraftComparisonResponse);
    } else {
      setDraftComparison(null);
    }
  }

  async function rollbackPublishedSchedule() {
    setPublishState("loading");
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/published-schedule/rollback`, {
        method: "POST",
        headers: roleHeaders(),
      });
      if (!response.ok) {
        throw new Error("方案回滚失败");
      }
      setPublishedSchedule(null);
      await loadOperationalHistory();
      const dashboardResponse = await fetch(`${apiBase}/api/dashboard`, { cache: "no-store" });
      if (dashboardResponse.ok) {
        setDashboard((await dashboardResponse.json()) as DashboardResponse);
      }
      setPublishState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "方案回滚失败");
      setPublishState("error");
    }
  }

  async function queryTeacherSchedule(teacherId: string) {
    await queryPublishedSchedule(
      `/api/published-schedule/teachers/${encodeURIComponent(teacherId)}`,
      setTeacherSchedule,
      "教师安排查询失败",
    );
  }

  async function queryStudentSchedule(studentGroupId: string) {
    await queryPublishedSchedule(
      `/api/published-schedule/student-groups/${encodeURIComponent(studentGroupId)}`,
      setStudentSchedule,
      "学生安排查询失败",
    );
  }

  async function queryPublishedSchedule(
    path: string,
    setter: (payload: PublishedScheduleAudienceResponse | null) => void,
    message: string,
  ) {
    setQueryState("loading");
    setError(null);
    try {
      const response = await fetch(`${apiBase}${path}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(response.status === 404 ? "暂无已发布方案" : message);
      }
      setter((await response.json()) as PublishedScheduleAudienceResponse);
      setQueryState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : message);
      setter(null);
      setQueryState("error");
    }
  }

  async function updateTeacherUnavailable(teacherId: string, slotIds: string[]) {
    setTeacherState("loading");
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/teachers/${encodeURIComponent(teacherId)}/unavailable-slots`, {
        method: "PATCH",
        headers: roleHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ unavailable_slot_ids: slotIds }),
      });
      if (!response.ok) {
        throw new Error(response.status === 403 ? "当前角色没有维护教师不可用时段权限" : "教师不可用时段保存失败");
      }
      await loadInitialData();
      setTeacherState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "教师不可用时段保存失败");
      setTeacherState("error");
    }
  }

  async function loadNotifications() {
    setNotificationState("loading");
    try {
      const response = await fetch(`${apiBase}/api/published-schedule/notifications`, { cache: "no-store" });
      if (!response.ok) {
        setNotifications(null);
        setNotificationState(response.status === 404 ? "idle" : "error");
        return;
      }
      setNotifications((await response.json()) as PublishedScheduleNotificationsResponse);
      setNotificationState("ready");
    } catch {
      setNotifications(null);
      setNotificationState("error");
    }
  }

  function downloadPublishedCsv() {
    window.open(`${apiBase}/api/published-schedule/export.csv`, "_blank", "noopener,noreferrer");
  }

  function roleHeaders(extra: Record<string, string> = {}) {
    return {
      ...extra,
      "x-examforge-role": role,
    };
  }

  const scheduleInput = referenceData?.scheduleInput;
  const assignments = latestRun?.result.assignments ?? [];
  const conflicts = latestRun?.result.conflicts ?? [];
  const roomUtilization = latestRun?.result.report?.room_utilization as
    | { average_utilization?: number; rooms?: Array<{ room_id: string; average_utilization: number; exam_count: number }> }
    | undefined;
  const teacherWorkload = latestRun?.result.report?.teacher_workload as
    | { average_assignments?: number; teachers?: Array<{ teacher_id: string; assignment_count: number }> }
    | undefined;

  const lookups = useMemo(() => {
    return {
      courses: new Map(scheduleInput?.courses.map((item) => [item.id, item.name]) ?? []),
      rooms: new Map(scheduleInput?.rooms.map((item) => [item.id, item.name]) ?? []),
      slots: new Map(
        scheduleInput?.time_slots.map((item) => [
          item.id,
          `${item.date} ${item.start_time}-${item.end_time}`,
        ]) ?? [],
      ),
      teachers: new Map(scheduleInput?.teachers.map((item) => [item.id, item.name]) ?? []),
      groups: new Map(scheduleInput?.student_groups.map((item) => [item.id, item.name]) ?? []),
      tasks: new Map(scheduleInput?.exam_tasks.map((item) => [item.id, item]) ?? []),
    };
  }, [scheduleInput]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">EF</div>
          <div>
            <strong>ExamForge</strong>
            <span>Scheduling Operations</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {[
            ["概览", Activity],
            ["基础数据", Database],
            ["考试任务", BookOpen],
            ["排考运行", CalendarClock],
            ["冲突解释", AlertTriangle],
            ["资源分析", BarChart3],
            ["方案工作台", ClipboardList],
            ["审计", ShieldCheck],
          ].map(([label, Icon]) => (
            <a href="#" className="nav-item" key={label as string}>
              <Icon size={18} />
              <span>{label as string}</span>
            </a>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Enterprise Examination Command Center</p>
            <h1>{dashboard?.batch.name ?? "ExamForge 排考运营台"}</h1>
          </div>
          <button className="primary-button" onClick={runSchedule} disabled={runState === "loading"}>
            <Play size={18} />
            {runState === "loading" ? "运行中" : "运行排考"}
          </button>
          <label className="role-switcher">
            <span>角色</span>
            <select value={role} onChange={(event) => setRole(event.target.value as WorkspaceRole)}>
              <option value="admin">管理员</option>
              <option value="operator">排考员</option>
              <option value="viewer">只读</option>
            </select>
          </label>
        </header>

        {error ? <div className="alert">{error}</div> : null}

        <section className="metric-grid">
          <Metric icon={BookOpen} label="考试任务" value={dashboard?.metrics.examTaskCount ?? "--"} />
          <Metric icon={Users} label="教师资源" value={dashboard?.metrics.teacherCount ?? "--"} />
          <Metric icon={Building2} label="可用考场" value={dashboard?.metrics.roomCount ?? "--"} />
          <Metric icon={CalendarClock} label="时间段" value={dashboard?.metrics.timeSlotCount ?? "--"} />
          <Metric icon={AlertTriangle} label="冲突" value={latestRun?.run.conflictCount ?? dashboard?.metrics.conflictCount ?? "--"} tone="danger" />
          <Metric icon={Gauge} label="评分" value={latestRun?.run.score ?? dashboard?.metrics.score ?? "--"} tone="score" />
        </section>

        <section className="split">
          <Panel title="排考运行控制台" eyebrow="Scheduler">
            <div className="run-status">
              <div>
                <span>状态</span>
                <strong>{latestRun?.run.status ?? dashboard?.latestRun?.status ?? "未运行"}</strong>
              </div>
              <div>
                <span>耗时</span>
                <strong>{latestRun ? `${latestRun.run.elapsedMs} ms` : "--"}</strong>
              </div>
              <div>
                <span>安排数</span>
                <strong>{latestRun?.run.assignmentCount ?? "--"}</strong>
              </div>
            </div>
            <p className="muted">
              当前按钮会通过 Fastify API 调用 Python CP-SAT 调度器，并返回真实排考结果、冲突、评分和报告数据。
            </p>
            <ScheduleJobPanel
              jobs={scheduleJobs}
              jobState={jobState}
              onCreateJob={runScheduleJob}
            />
          </Panel>

          <Panel title="资源利用率" eyebrow="Capacity">
            <div className="bars">
              {(roomUtilization?.rooms ?? []).slice(0, 5).map((room) => (
                <div className="bar-row" key={room.room_id}>
                  <span>{lookups.rooms.get(room.room_id) ?? room.room_id}</span>
                  <div className="bar-track">
                    <div style={{ width: `${Math.min(100, room.average_utilization * 100)}%` }} />
                  </div>
                  <strong>{Math.round(room.average_utilization * 100)}%</strong>
                </div>
              ))}
              {!roomUtilization?.rooms?.length ? <p className="muted">运行排考后展示考场容量利用率。</p> : null}
            </div>
          </Panel>
        </section>

        <section className="data-grid">
          <Panel title="排考结果" eyebrow="Assignments">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>课程</th>
                    <th>时间</th>
                    <th>考场</th>
                    <th>监考教师</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((assignment) => {
                    const task = lookups.tasks.get(assignment.exam_task_id);
                    return (
                      <tr key={assignment.exam_task_id}>
                        <td>{task ? lookups.courses.get(task.course_id) : assignment.exam_task_id}</td>
                        <td>{lookups.slots.get(assignment.time_slot_id) ?? assignment.time_slot_id}</td>
                        <td>{lookups.rooms.get(assignment.room_id) ?? assignment.room_id}</td>
                        <td>{assignment.teacher_ids.map((id) => lookups.teachers.get(id) ?? id).join("、")}</td>
                      </tr>
                    );
                  })}
                  {!assignments.length ? (
                    <tr>
                      <td colSpan={4}>运行排考后展示结果。</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="冲突解释" eyebrow="Conflicts">
            <div className="conflict-list">
              {conflicts.slice(0, 6).map((conflict) => (
                <article key={`${conflict.type}-${conflict.affected_ids.join("-")}`}>
                  <strong>{conflict.type}</strong>
                  <p>{conflict.message}</p>
                  <span>{conflict.suggestion}</span>
                </article>
              ))}
              {!conflicts.length ? <p className="muted">当前没有硬约束冲突。</p> : null}
            </div>
          </Panel>
        </section>

        <Panel title="基础数据管理" eyebrow="Master Data">
          <ReferenceManager
            referenceData={referenceData}
            role={role}
            onRefresh={loadInitialData}
            onError={setError}
          />
        </Panel>

        <section className="split">
          <Panel title="排考运行历史" eyebrow="Run History">
            <RunHistory
              runs={runHistory}
              comparison={comparison}
              publishedSchedule={publishedSchedule}
              compareState={compareState}
              publishState={publishState}
              onCompare={compareRuns}
              onPublish={publishRun}
              onCreateDraft={createDraftFromRun}
              onRollback={rollbackPublishedSchedule}
            />
          </Panel>

          <Panel title="审计详情" eyebrow="Audit Trail">
            <AuditTrail events={auditEvents} />
          </Panel>
        </section>

        <Panel title="方案工作台" eyebrow="Draft Workspace">
          <ScheduleDraftWorkspace
            drafts={drafts}
            runs={runHistory}
            draft={currentDraft}
            comparison={draftComparison}
            suggestions={draftSuggestions}
            referenceData={referenceData}
            selectedAssignmentId={selectedDraftAssignmentId}
            draftForm={draftForm}
            draftState={draftState}
            suggestionState={suggestionState}
            onCreateDraft={createDraftFromRun}
            onLoadDraft={loadDraft}
            onSelectAssignment={setSelectedDraftAssignmentId}
            onDraftFormChange={setDraftForm}
            onSaveAdjustment={adjustDraftAssignment}
            onApplySuggestion={applyDraftSuggestion}
            onMoveAssignment={moveDraftAssignment}
            onLockAssignment={lockDraftAssignment}
            onUnlockAssignment={unlockDraftAssignment}
            onRebalanceDraft={rebalanceDraft}
            onPublishDraft={publishDraft}
            onDiscardDraft={discardDraft}
          />
        </Panel>

        <Panel title="教师不可用维护" eyebrow="Teacher Self-Service">
          <TeacherAvailabilityPanel
            referenceData={referenceData}
            teacherState={teacherState}
            onSave={updateTeacherUnavailable}
          />
        </Panel>

        <Panel title="已发布查询" eyebrow="Published Portal">
          <PublishedScheduleLookup
            referenceData={referenceData}
            teacherSchedule={teacherSchedule}
            studentSchedule={studentSchedule}
            queryState={queryState}
            notifications={notifications}
            notificationState={notificationState}
            onTeacherQuery={queryTeacherSchedule}
            onStudentQuery={queryStudentSchedule}
            onRefreshNotifications={loadNotifications}
            onExportCsv={downloadPublishedCsv}
          />
        </Panel>

        <section className="split">
          <Panel title="基础数据快照" eyebrow="Reference Data">
            <div className="snapshot-grid">
              <span>课程 {scheduleInput?.courses.length ?? "--"}</span>
              <span>学生群体 {scheduleInput?.student_groups.length ?? "--"}</span>
              <span>教师 {scheduleInput?.teachers.length ?? "--"}</span>
              <span>考场 {scheduleInput?.rooms.length ?? "--"}</span>
            </div>
          </Panel>
          <Panel title="教师工作量" eyebrow="Workload">
            <div className="workload-grid">
              {(teacherWorkload?.teachers ?? []).slice(0, 6).map((teacher) => (
                <div key={teacher.teacher_id}>
                  <span>{lookups.teachers.get(teacher.teacher_id) ?? teacher.teacher_id}</span>
                  <strong>{teacher.assignment_count}</strong>
                </div>
              ))}
              {!teacherWorkload?.teachers?.length ? <p className="muted">运行排考后展示教师监考分布。</p> : null}
            </div>
          </Panel>
        </section>

        <footer className="footer">
          API: {apiBase} · 状态：{state === "ready" ? "已连接" : state === "error" ? "连接失败" : "加载中"}
        </footer>
      </section>
    </main>
  );
}

function PublishedScheduleLookup({
  referenceData,
  teacherSchedule,
  studentSchedule,
  queryState,
  notifications,
  notificationState,
  onTeacherQuery,
  onStudentQuery,
  onRefreshNotifications,
  onExportCsv,
}: {
  referenceData: ReferenceDataResponse | null;
  teacherSchedule: PublishedScheduleAudienceResponse | null;
  studentSchedule: PublishedScheduleAudienceResponse | null;
  queryState: LoadState;
  notifications: PublishedScheduleNotificationsResponse | null;
  notificationState: LoadState;
  onTeacherQuery(id: string): Promise<void>;
  onStudentQuery(id: string): Promise<void>;
  onRefreshNotifications(): Promise<void>;
  onExportCsv(): void;
}) {
  const teachers = referenceData?.scheduleInput.teachers ?? [];
  const studentGroups = referenceData?.scheduleInput.student_groups ?? [];
  const [teacherId, setTeacherId] = useState("");
  const [studentGroupId, setStudentGroupId] = useState("");

  useEffect(() => {
    setTeacherId((current) => current || teachers[0]?.id || "");
    setStudentGroupId((current) => current || studentGroups[0]?.id || "");
  }, [teachers, studentGroups]);

  return (
    <div className="published-query">
      <div className="query-controls">
        <label>
          <span>教师</span>
          <select value={teacherId} onChange={(event) => setTeacherId(event.target.value)}>
            {teachers.map((teacher) => (
              <option value={teacher.id} key={teacher.id}>{teacher.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={!teacherId || queryState === "loading"}
          onClick={() => onTeacherQuery(teacherId)}
        >
          <Users size={16} />
          查询教师安排
        </button>
        <label>
          <span>学生群体</span>
          <select value={studentGroupId} onChange={(event) => setStudentGroupId(event.target.value)}>
            {studentGroups.map((group) => (
              <option value={group.id} key={group.id}>{group.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={!studentGroupId || queryState === "loading"}
          onClick={() => onStudentQuery(studentGroupId)}
        >
          <BookOpen size={16} />
          查询学生安排
        </button>
      </div>

      <div className="published-results">
        <ScheduleAudienceCards title="教师视图" schedule={teacherSchedule} />
        <ScheduleAudienceCards title="学生视图" schedule={studentSchedule} />
      </div>

      <div className="published-actions">
        <div className="action-row">
          <button
            type="button"
            className="secondary-button"
            disabled={notificationState === "loading"}
            onClick={() => onRefreshNotifications()}
            data-testid="published-notification-refresh"
          >
            <Bell size={16} />
            刷新通知
          </button>
          <button type="button" className="secondary-button" onClick={onExportCsv}>
            <Download size={16} />
            导出 CSV
          </button>
        </div>
        <div className="notification-list" data-testid="published-notification-list">
          {notifications?.notifications.slice(0, 6).map((notice) => (
            <article key={notice.id}>
              <strong>{notice.studentGroupName}</strong>
              <p>{notice.message}</p>
            </article>
          ))}
          {!notifications ? <p className="muted">发布方案后可预览面向学生群体的通知。</p> : null}
        </div>
      </div>
    </div>
  );
}

function ScheduleJobPanel({
  jobs,
  jobState,
  onCreateJob,
}: {
  jobs: ScheduleJobSummary[];
  jobState: LoadState;
  onCreateJob(): Promise<void>;
}) {
  return (
    <div className="job-panel" data-testid="schedule-job-panel">
      <div className="job-toolbar">
        <button
          type="button"
          className="secondary-button"
          disabled={jobState === "loading"}
          onClick={() => onCreateJob()}
          data-testid="schedule-job-create"
        >
          <Play size={16} />
          异步排考
        </button>
        <span>{jobs[0]?.status ?? "无后台作业"}</span>
      </div>
      <div className="job-list">
        {jobs.slice(0, 4).map((job) => (
          <article key={job.id}>
            <div>
              <strong>{job.status}</strong>
              <span>{job.runId ?? job.id.slice(0, 16)}</span>
            </div>
            <div className="progress-track" aria-label={`${job.progress}%`}>
              <div style={{ width: `${job.progress}%` }} />
            </div>
          </article>
        ))}
        {!jobs.length ? <p className="muted">后台作业会显示队列、运行进度和生成的运行版本。</p> : null}
      </div>
    </div>
  );
}

function TeacherAvailabilityPanel({
  referenceData,
  teacherState,
  onSave,
}: {
  referenceData: ReferenceDataResponse | null;
  teacherState: LoadState;
  onSave(teacherId: string, slotIds: string[]): Promise<void>;
}) {
  const teachers = referenceData?.scheduleInput.teachers ?? [];
  const slots = referenceData?.scheduleInput.time_slots ?? [];
  const [teacherId, setTeacherId] = useState("");
  const [slotIds, setSlotIds] = useState<string[]>([]);

  useEffect(() => {
    const nextTeacher = teachers.find((teacher) => teacher.id === teacherId) ?? teachers[0];
    setTeacherId(nextTeacher?.id ?? "");
    setSlotIds(nextTeacher?.unavailable_slot_ids ?? []);
  }, [teachers, teacherId]);

  function toggleSlot(slotId: string) {
    setSlotIds((current) => (
      current.includes(slotId)
        ? current.filter((item) => item !== slotId)
        : [...current, slotId]
    ));
  }

  return (
    <div className="teacher-availability" data-testid="teacher-availability-panel">
      <div className="teacher-toolbar">
        <label>
          <span>教师</span>
          <select
            value={teacherId}
            onChange={(event) => {
              const nextId = event.target.value;
              const nextTeacher = teachers.find((teacher) => teacher.id === nextId);
              setTeacherId(nextId);
              setSlotIds(nextTeacher?.unavailable_slot_ids ?? []);
            }}
          >
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={!teacherId || teacherState === "loading"}
          onClick={() => onSave(teacherId, slotIds)}
          data-testid="teacher-availability-save"
        >
          <Save size={16} />
          保存不可用
        </button>
      </div>
      <div className="slot-toggle-grid">
        {slots.map((slot) => (
          <label key={slot.id} className={slotIds.includes(slot.id) ? "slot-toggle active" : "slot-toggle"}>
            <input
              type="checkbox"
              checked={slotIds.includes(slot.id)}
              onChange={() => toggleSlot(slot.id)}
            />
            <span>{slot.date} {slot.start_time}-{slot.end_time}</span>
          </label>
        ))}
        {!slots.length ? <p className="muted">加载基础数据后维护教师不可用时段。</p> : null}
      </div>
    </div>
  );
}

function ScheduleAudienceCards({
  title,
  schedule,
}: {
  title: string;
  schedule: PublishedScheduleAudienceResponse | null;
}) {
  return (
    <div className="schedule-audience">
      <div className="audience-title">
        <span>{title}</span>
        <strong>{schedule?.viewer.name ?? "未查询"}</strong>
      </div>
      <div className="schedule-card-list">
        {schedule?.assignments.map((item) => (
          <article className="schedule-card" key={`${schedule.viewer.id}-${item.assignment.exam_task_id}`}>
            <div>
              <strong>{item.course?.name ?? item.assignment.exam_task_id}</strong>
              <span>{formatSlot(item.timeSlot)}</span>
            </div>
            <dl>
              <div><dt>考场</dt><dd>{item.room?.name ?? item.assignment.room_id}</dd></div>
              <div><dt>学生</dt><dd>{formatNames(item.studentGroups)}</dd></div>
              <div><dt>监考</dt><dd>{formatNames(item.teachers)}</dd></div>
            </dl>
          </article>
        ))}
        {schedule && schedule.assignments.length === 0 ? (
          <p className="muted">当前发布方案中没有匹配安排。</p>
        ) : null}
        {!schedule ? <p className="muted">选择对象后查询已发布安排。</p> : null}
      </div>
    </div>
  );
}

function RunHistory({
  runs,
  comparison,
  publishedSchedule,
  compareState,
  publishState,
  onCompare,
  onPublish,
  onCreateDraft,
  onRollback,
}: {
  runs: ScheduleRunSummary[];
  comparison: ScheduleRunComparisonResponse | null;
  publishedSchedule: PublishedScheduleResponse | null;
  compareState: LoadState;
  publishState: LoadState;
  onCompare(baseId: string, targetId: string): Promise<void>;
  onPublish(id: string): Promise<void>;
  onCreateDraft(id: string): Promise<void>;
  onRollback(): Promise<void>;
}) {
  const [baseId, setBaseId] = useState("");
  const [targetId, setTargetId] = useState("");

  useEffect(() => {
    if (runs.length >= 2) {
      setTargetId(runs[0].id);
      setBaseId(runs[1].id);
    } else if (runs.length === 1) {
      setTargetId(runs[0].id);
      setBaseId("");
    }
  }, [runs]);

  return (
    <div className="history-panel">
      <div className="history-list">
        {runs.slice(0, 6).map((run) => (
          <article key={run.id}>
            <div>
              <strong>{run.status}</strong>
              <span>{new Date(run.createdAt).toLocaleString()}</span>
              {publishedSchedule?.run.id === run.id ? <em>已发布</em> : null}
            </div>
            <dl>
              <div><dt>评分</dt><dd>{run.score}</dd></div>
              <div><dt>安排</dt><dd>{run.assignmentCount}</dd></div>
              <div><dt>冲突</dt><dd>{run.conflictCount}</dd></div>
            </dl>
            <button
              type="button"
              className="mini-button"
              disabled={publishState === "loading"}
              onClick={() => onPublish(run.id)}
            >
              发布
            </button>
            <button
              type="button"
              className="mini-button"
              disabled={publishState === "loading"}
              onClick={() => onCreateDraft(run.id)}
            >
              草稿
            </button>
          </article>
        ))}
        {!runs.length ? <p className="muted">运行排考后展示历史版本。</p> : null}
      </div>

      <div className="compare-box">
        <div className="compare-controls">
          <select value={baseId} onChange={(event) => setBaseId(event.target.value)}>
            <option value="">基准版本</option>
            {runs.map((run) => <option value={run.id} key={run.id}>{run.id}</option>)}
          </select>
          <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
            <option value="">目标版本</option>
            {runs.map((run) => <option value={run.id} key={run.id}>{run.id}</option>)}
          </select>
          <button
            type="button"
            className="secondary-button"
            disabled={!baseId || !targetId || compareState === "loading"}
            onClick={() => onCompare(baseId, targetId)}
          >
            <GitCompareArrows size={16} />
            对比
          </button>
        </div>

        {comparison ? (
          <div className="comparison-grid">
            <div><span>评分变化</span><strong>{formatDelta(comparison.deltas.score)}</strong></div>
            <div><span>安排变化</span><strong>{formatDelta(comparison.deltas.assignments)}</strong></div>
            <div><span>冲突变化</span><strong>{formatDelta(comparison.deltas.conflicts)}</strong></div>
            <div><span>新增安排</span><strong>{comparison.assignmentChanges.added.length}</strong></div>
          </div>
        ) : <p className="muted">选择两个运行版本后查看差异。</p>}
      </div>

      <div className="publish-box">
        <div>
          <span>当前发布</span>
          <strong>{publishedSchedule?.run.id ?? "暂无发布版本"}</strong>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={!publishedSchedule || publishState === "loading"}
          onClick={() => onRollback()}
        >
          回滚发布
        </button>
      </div>
    </div>
  );
}

function ScheduleDraftWorkspace({
  drafts,
  runs,
  draft,
  comparison,
  suggestions,
  referenceData,
  selectedAssignmentId,
  draftForm,
  draftState,
  suggestionState,
  onCreateDraft,
  onLoadDraft,
  onSelectAssignment,
  onDraftFormChange,
  onSaveAdjustment,
  onApplySuggestion,
  onMoveAssignment,
  onLockAssignment,
  onUnlockAssignment,
  onRebalanceDraft,
  onPublishDraft,
  onDiscardDraft,
}: {
  drafts: ScheduleDraftSummary[];
  runs: ScheduleRunSummary[];
  draft: ScheduleDraftDetailResponse | null;
  comparison: ScheduleDraftComparisonResponse | null;
  suggestions: ScheduleDraftAdjustmentSuggestionsResponse | null;
  referenceData: ReferenceDataResponse | null;
  selectedAssignmentId: string;
  draftForm: DraftAssignmentForm;
  draftState: LoadState;
  suggestionState: LoadState;
  onCreateDraft(id: string): Promise<void>;
  onLoadDraft(id: string): Promise<void>;
  onSelectAssignment(id: string): void;
  onDraftFormChange(form: DraftAssignmentForm): void;
  onSaveAdjustment(): Promise<void>;
  onApplySuggestion(suggestion: ScheduleDraftAdjustmentSuggestion): Promise<void>;
  onMoveAssignment(examTaskId: string, roomId: string, timeSlotId: string): Promise<void>;
  onLockAssignment(): Promise<void>;
  onUnlockAssignment(): Promise<void>;
  onRebalanceDraft(): Promise<void>;
  onPublishDraft(): Promise<void>;
  onDiscardDraft(): Promise<void>;
}) {
  const [sourceRunId, setSourceRunId] = useState("");
  const [draggedAssignmentId, setDraggedAssignmentId] = useState("");
  const [dragTargetKey, setDragTargetKey] = useState("");
  const draggedAssignmentIdRef = useRef("");
  const dragSourceKeyRef = useRef("");
  const scheduleInput = referenceData?.scheduleInput;
  const selectedAssignment = draft?.assignments.find((assignment) => (
    assignment.exam_task_id === selectedAssignmentId
  )) ?? null;
  const draftLocked = draft?.draft.status === "published" || draft?.draft.status === "discarded";
  const assignmentLocked = Boolean(selectedAssignmentId && draft?.lockedExamTaskIds?.includes(selectedAssignmentId));
  const canPublishDraft = draft?.draft.status === "validated" && draft.draft.conflictCount === 0;

  useEffect(() => {
    setSourceRunId((current) => current || runs[0]?.id || "");
  }, [runs]);

  const lookups = useMemo(() => ({
    courses: new Map(scheduleInput?.courses.map((item) => [item.id, item]) ?? []),
    rooms: new Map(scheduleInput?.rooms.map((item) => [item.id, item]) ?? []),
    slots: new Map(scheduleInput?.time_slots.map((item) => [item.id, item]) ?? []),
    teachers: new Map(scheduleInput?.teachers.map((item) => [item.id, item]) ?? []),
    groups: new Map(scheduleInput?.student_groups.map((item) => [item.id, item]) ?? []),
    tasks: new Map(scheduleInput?.exam_tasks.map((item) => [item.id, item]) ?? []),
  }), [scheduleInput]);

  function assignmentHasConflict(assignment: ScheduledExam) {
    return draft?.conflicts.some((conflict) => (
      conflict.affected_ids.includes(assignment.exam_task_id)
    )) ?? false;
  }

  function clearDragState() {
    draggedAssignmentIdRef.current = "";
    dragSourceKeyRef.current = "";
    setDraggedAssignmentId("");
    setDragTargetKey("");
  }

  function beginDrag(examTaskId: string, sourceKey: string) {
    draggedAssignmentIdRef.current = examTaskId;
    dragSourceKeyRef.current = sourceKey;
    setDraggedAssignmentId(examTaskId);
    onSelectAssignment(examTaskId);
  }

  function handleDrop(roomId: string, slotId: string, transferredAssignmentId = "") {
    const moving = transferredAssignmentId || draggedAssignmentIdRef.current || draggedAssignmentId;
    if (!moving || draftLocked) {
      return;
    }
    clearDragState();
    void onMoveAssignment(moving, roomId, slotId);
  }

  function handlePointerDrop(roomId: string, slotId: string) {
    const targetKey = `${slotId}-${roomId}`;
    if (!draggedAssignmentIdRef.current || draftLocked) {
      return;
    }
    if (dragSourceKeyRef.current === targetKey) {
      clearDragState();
      return;
    }
    handleDrop(roomId, slotId);
  }

  return (
    <div className="draft-workspace" data-testid="schedule-draft-workspace">
      <div className="draft-rail">
        <div className="draft-create">
          <label>
            <span>来源运行</span>
            <select value={sourceRunId} onChange={(event) => setSourceRunId(event.target.value)}>
              <option value="">选择运行版本</option>
              {runs.map((run) => (
                <option value={run.id} key={run.id}>
                  {run.status} · {run.score} · {run.id.slice(0, 12)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={!sourceRunId || draftState === "loading"}
            onClick={() => onCreateDraft(sourceRunId)}
          >
            <ClipboardList size={16} />
            创建草稿
          </button>
        </div>

        <div className="draft-list">
          {drafts.map((item) => (
            <button
              type="button"
              key={item.id}
              data-testid={`draft-row-${item.id}`}
              className={draft?.draft.id === item.id ? "draft-row active" : "draft-row"}
              onClick={() => onLoadDraft(item.id)}
            >
              <strong>{item.status}</strong>
              <span>{item.id.slice(0, 18)}</span>
              <em>{item.conflictCount} 冲突 · {item.score} 分</em>
            </button>
          ))}
          {!drafts.length ? <p className="muted">从运行历史创建草稿后开始人工调整。</p> : null}
        </div>
      </div>

      <div className="draft-main">
        <div className="draft-summary">
          <div><span>状态</span><strong>{draft?.draft.status ?? "未选择"}</strong></div>
          <div><span>评分</span><strong>{draft?.draft.score ?? "--"}</strong></div>
          <div><span>冲突</span><strong>{draft?.draft.conflictCount ?? "--"}</strong></div>
          <div><span>安排</span><strong>{draft?.draft.assignmentCount ?? "--"}</strong></div>
          <div><span>锁定</span><strong>{draft?.lockedExamTaskIds?.length ?? 0}</strong></div>
          <button
            type="button"
            className="secondary-button"
            disabled={!draft || draftLocked || draftState === "loading"}
            onClick={onRebalanceDraft}
            data-testid="draft-rebalance"
          >
            <RotateCcw size={17} />
            局部再平衡
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!canPublishDraft || draftState === "loading"}
            onClick={onPublishDraft}
          >
            <ShieldCheck size={17} />
            发布草稿
          </button>
        </div>

        <div className="draft-confirmation">
          <div className="confirmation-metrics">
            <div>
              <span>相对来源变化</span>
              <strong>{comparison?.summary.changedFromSource ?? "--"}</strong>
            </div>
            <div>
              <span>相对发布变化</span>
              <strong>{comparison?.summary.changedFromPublished ?? "--"}</strong>
            </div>
            <div>
              <span>硬冲突</span>
              <strong>{comparison?.summary.hardConflictCount ?? draft?.draft.conflictCount ?? "--"}</strong>
            </div>
            <div>
              <span>最近调整</span>
              <strong>{draft?.changeEvents.length ?? "--"}</strong>
            </div>
          </div>
          <div className="governance-actions">
            <p className="muted">
              {draft?.draft.conflictCount
                ? "存在硬冲突时不能发布，请先修复草稿安排。"
                : draftLocked
                  ? "已发布或已废弃草稿仅保留审计与对比，不再允许调整。"
                  : "发布前请核对评分、变化数量和最近调整记录。"}
            </p>
            <button
              type="button"
              className="danger-button"
              disabled={!draft || draftLocked || draftState === "loading"}
              onClick={onDiscardDraft}
            >
              废弃草稿
            </button>
          </div>
        </div>

        <div className="schedule-matrix" role="grid" aria-label="排考草稿矩阵">
          <div className="matrix-corner">时间 / 考场</div>
          {scheduleInput?.rooms.map((room) => (
            <div className="matrix-head" key={room.id}>{room.name}</div>
          ))}
          {scheduleInput?.time_slots.map((slot) => (
            <div className="matrix-row" key={slot.id}>
              <div className="matrix-slot">
                <strong>{slot.date}</strong>
                <span>{slot.start_time}-{slot.end_time}</span>
              </div>
              {scheduleInput.rooms.map((room) => {
                const assignment = draft?.assignments.find((item) => (
                  item.room_id === room.id && item.time_slot_id === slot.id
                ));
                const task = assignment ? lookups.tasks.get(assignment.exam_task_id) : null;
                const course = task ? lookups.courses.get(task.course_id) : null;
                return (
                  <button
                    type="button"
                    key={`${slot.id}-${room.id}`}
                    data-testid={`draft-cell-${slot.id}-${room.id}`}
                    data-exam-task-id={assignment?.exam_task_id}
                    className={[
                      "matrix-cell",
                      assignment ? "filled" : "",
                      assignment?.exam_task_id === selectedAssignmentId ? "selected" : "",
                      assignment && assignmentHasConflict(assignment) ? "conflicted" : "",
                      assignment && draft?.lockedExamTaskIds?.includes(assignment.exam_task_id) ? "locked" : "",
                      dragTargetKey === `${slot.id}-${room.id}` ? "drop-target" : "",
                    ].join(" ")}
                    draggable={Boolean(assignment && !draftLocked)}
                    aria-label={assignment ? undefined : `${slot.date} ${slot.start_time}-${slot.end_time} ${room.name} 空考位`}
                    onDragStart={(event) => {
                      if (assignment && !draftLocked) {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", assignment.exam_task_id);
                        beginDrag(assignment.exam_task_id, `${slot.id}-${room.id}`);
                      }
                    }}
                    onDragEnd={clearDragState}
                    onDragOver={(event) => {
                      if ((draggedAssignmentIdRef.current || draggedAssignmentId) && !draftLocked) {
                        event.preventDefault();
                        setDragTargetKey(`${slot.id}-${room.id}`);
                      }
                    }}
                    onPointerDown={(event) => {
                      if (event.button === 0 && assignment && !draftLocked) {
                        beginDrag(assignment.exam_task_id, `${slot.id}-${room.id}`);
                      }
                    }}
                    onPointerEnter={() => {
                      if (draggedAssignmentIdRef.current && !draftLocked) {
                        setDragTargetKey(`${slot.id}-${room.id}`);
                      }
                    }}
                    onPointerUp={() => handlePointerDrop(room.id, slot.id)}
                    onDragLeave={() => setDragTargetKey("")}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDrop(room.id, slot.id, event.dataTransfer.getData("text/plain"));
                    }}
                    onClick={() => assignment ? onSelectAssignment(assignment.exam_task_id) : undefined}
                  >
                    {assignment && task ? (
                      <>
                        <Move size={14} aria-hidden="true" />
                        <strong>{course?.name ?? task.course_id}</strong>
                        <span>{task.student_group_ids.map((id) => lookups.groups.get(id)?.name ?? id).join("、")}</span>
                        <em>{assignment.teacher_ids.map((id) => lookups.teachers.get(id)?.name ?? id).join("、")}</em>
                      </>
                    ) : <span>空</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {!scheduleInput ? <p className="muted">基础数据加载后展示矩阵。</p> : null}
        </div>
      </div>

      <div className="draft-inspector">
        <div className="inspector-title">
          <span>Selected Assignment</span>
          <strong>{selectedAssignmentId || "未选择考试"}</strong>
        </div>
        {selectedAssignment ? (
          <>
            <div className="form-grid compact">
              <label>
                <span>时间段</span>
                <select
                  value={draftForm.time_slot_id}
                  onChange={(event) => onDraftFormChange({
                    ...draftForm,
                    time_slot_id: event.target.value,
                  })}
                >
                  {scheduleInput?.time_slots.map((slot) => (
                    <option value={slot.id} key={slot.id}>
                      {slot.date} {slot.start_time}-{slot.end_time}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>考场</span>
                <select
                  value={draftForm.room_id}
                  onChange={(event) => onDraftFormChange({
                    ...draftForm,
                    room_id: event.target.value,
                  })}
                >
                  {scheduleInput?.rooms.map((room) => (
                    <option value={room.id} key={room.id}>{room.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>监考教师 ID</span>
                <input
                  value={draftForm.teacher_ids}
                  onChange={(event) => onDraftFormChange({
                    ...draftForm,
                    teacher_ids: event.target.value,
                  })}
                />
              </label>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={draftState === "loading" || draftLocked || assignmentLocked}
              onClick={onSaveAdjustment}
            >
              <Save size={16} />
              保存调整并校验
            </button>
            <div className="lock-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={draftState === "loading" || draftLocked || assignmentLocked}
                onClick={onLockAssignment}
                data-testid="draft-lock-assignment"
              >
                <Lock size={16} />
                锁定考试
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={draftState === "loading" || draftLocked || !assignmentLocked}
                onClick={onUnlockAssignment}
                data-testid="draft-unlock-assignment"
              >
                <Unlock size={16} />
                解锁考试
              </button>
              <span data-testid="draft-lock-state">{assignmentLocked ? "已锁定" : "未锁定"}</span>
            </div>
          </>
        ) : <p className="muted">选择矩阵中的考试卡片后调整时间、考场和监考教师。</p>}

        <div className="suggestion-panel" data-testid="draft-suggestion-panel">
          <div className="suggestion-title">
            <Lightbulb size={16} />
            <strong>局部调整建议</strong>
            <span>{suggestionState === "loading" ? "计算中" : `${suggestions?.suggestions.length ?? 0} 项`}</span>
          </div>
          {suggestions?.suggestions.slice(0, 4).map((suggestion) => {
            const room = lookups.rooms.get(suggestion.assignment.room_id);
            const slot = lookups.slots.get(suggestion.assignment.time_slot_id);
            return (
              <article key={[
                suggestion.assignment.room_id,
                suggestion.assignment.time_slot_id,
                suggestion.assignment.teacher_ids.join("-"),
              ].join("|")}>
                <div>
                  <strong>{room?.name ?? suggestion.assignment.room_id}</strong>
                  <span>{slot ? `${slot.date} ${slot.start_time}-${slot.end_time}` : suggestion.assignment.time_slot_id}</span>
                </div>
                <p>{suggestion.reasons.join("；")}</p>
                <footer>
                  <span>{suggestion.hardConflictCount} 冲突 · {suggestion.score} 分</span>
                  <button
                    type="button"
                    className="secondary-button"
                    data-testid="draft-suggestion-apply"
                    disabled={draftState === "loading" || draftLocked || suggestion.hardConflictCount > 0}
                    onClick={() => onApplySuggestion(suggestion)}
                  >
                    应用
                  </button>
                </footer>
              </article>
            );
          })}
          {suggestionState !== "loading" && !suggestions?.suggestions.length ? (
            <p className="muted">选择可编辑草稿中的考试后显示候选安排。</p>
          ) : null}
        </div>

        <div className="conflict-list draft-conflicts">
          {draft?.conflicts.slice(0, 6).map((conflict) => (
            <article key={`${conflict.type}-${conflict.affected_ids.join("-")}`}>
              <strong>{conflict.type}</strong>
              <p>{conflict.message}</p>
              <span>{conflict.suggestion}</span>
            </article>
          ))}
          {draft && draft.conflicts.length === 0 ? <p className="muted">当前草稿没有硬约束冲突。</p> : null}
        </div>

        <div className="draft-events">
          {draft?.changeEvents.slice(0, 10).map((event) => (
            <article key={event.id}>
              <strong>{event.examTaskId}</strong>
              <span>{new Date(event.createdAt).toLocaleString()}</span>
              <p>{event.before.room_id}/{event.before.time_slot_id} → {event.after.room_id}/{event.after.time_slot_id}</p>
            </article>
          ))}
          {draft && draft.changeEvents.length === 0 ? <p className="muted">尚无人工调整记录。</p> : null}
        </div>
      </div>
    </div>
  );
}

function AuditTrail({ events }: { events: AuditEventSummary[] }) {
  return (
    <div className="audit-list">
      {events.slice(0, 8).map((event) => (
        <article key={event.id}>
          <History size={16} />
          <div>
            <strong>{event.action}</strong>
            <span>{event.entityType} · {event.entityId}</span>
            <p>{new Date(event.createdAt).toLocaleString()} · {event.actor}</p>
          </div>
        </article>
      ))}
      {!events.length ? <p className="muted">暂无审计事件。</p> : null}
    </div>
  );
}

function ReferenceManager({
  referenceData,
  role,
  onRefresh,
  onError,
}: {
  referenceData: ReferenceDataResponse | null;
  role: WorkspaceRole;
  onRefresh(): Promise<void>;
  onError(message: string | null): void;
}) {
  const [resource, setResource] = useState<EditableResource>("courses");
  const [mode, setMode] = useState<"create" | "edit">("edit");
  const [form, setForm] = useState<FormState>(referenceForms.courses.defaults);
  const [importText, setImportText] = useState(() => sampleImportText("courses"));
  const [saving, setSaving] = useState(false);
  const config = referenceForms[resource];
  const records = getEditableRecords(referenceData, resource);
  const selectedId = form.id;

  useEffect(() => {
    const nextRecords = getEditableRecords(referenceData, resource);
    const first = nextRecords[0];
    setMode(first ? "edit" : "create");
    setForm(first ? recordToForm(resource, first) : referenceForms[resource].defaults);
    setImportText(sampleImportText(resource));
  }, [referenceData, resource]);

  function selectResource(nextResource: EditableResource) {
    setResource(nextResource);
  }

  function selectRecord(record: ReferenceRecord) {
    setMode("edit");
    setForm(recordToForm(resource, record));
  }

  function createDraft() {
    setMode("create");
    setForm(referenceForms[resource].defaults);
  }

  function referenceRoleHeaders(extra: Record<string, string> = {}) {
    return {
      ...extra,
      "x-examforge-role": role,
    };
  }

  async function saveRecord() {
    setSaving(true);
    onError(null);
    try {
      const payload = formToPayload(resource, form);
      const endpoint = mode === "create"
        ? `${apiBase}/api/reference-data/${resource}`
        : `${apiBase}/api/reference-data/${resource}/${encodeURIComponent(form.id)}`;
      const response = await fetch(endpoint, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: referenceRoleHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(mode === "create" ? payload : omitId(payload)),
      });

      if (!response.ok) {
        throw new Error("基础数据保存失败");
      }

      const result = await response.json() as { record: ReferenceRecord };
      setMode("edit");
      setForm(recordToForm(resource, result.record));
      await onRefresh();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "基础数据保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecord() {
    if (mode !== "edit" || !form.id) {
      return;
    }
    setSaving(true);
    onError(null);
    try {
      const response = await fetch(
        `${apiBase}/api/reference-data/${resource}/${encodeURIComponent(form.id)}`,
        { method: "DELETE", headers: referenceRoleHeaders() },
      );
      if (!response.ok) {
        throw new Error("基础数据删除失败");
      }
      await onRefresh();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "基础数据删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function importRecords() {
    setSaving(true);
    onError(null);
    try {
      const parsed = JSON.parse(importText) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("导入内容必须是 JSON 数组");
      }
      const response = await fetch(`${apiBase}/api/reference-data/${resource}/import`, {
        method: "POST",
        headers: referenceRoleHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ records: parsed }),
      });
      if (!response.ok) {
        throw new Error("基础数据导入失败");
      }
      await onRefresh();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "基础数据导入失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="reference-manager">
      <div className="resource-tabs">
        {(Object.keys(referenceForms) as EditableResource[]).map((item) => (
          <button
            key={item}
            type="button"
            className={item === resource ? "active" : ""}
            onClick={() => selectResource(item)}
          >
            {referenceForms[item].label}
          </button>
        ))}
      </div>

      <div className="reference-layout">
        <div className="record-list">
          <button type="button" className="record-create" onClick={createDraft}>
            <Plus size={16} />
            <span>新增{config.label}</span>
          </button>
          {records.map((record) => (
            <button
              key={record.id}
              type="button"
              className={mode === "edit" && selectedId === record.id ? "record-row active" : "record-row"}
              onClick={() => selectRecord(record)}
            >
              <span>{recordTitle(resource, record)}</span>
              <strong>{record.id}</strong>
            </button>
          ))}
        </div>

        <div className="record-editor">
          <div className="editor-title">
            <div>
              <span>{mode === "create" ? "Create" : "Update"}</span>
              <strong>{config.label}</strong>
            </div>
            <button type="button" className="secondary-button" onClick={saveRecord} disabled={saving}>
              {saving ? <Check size={16} /> : <Save size={16} />}
              {saving ? "保存中" : "保存"}
            </button>
            <button
              type="button"
              className="danger-button"
              onClick={deleteRecord}
              disabled={saving || mode !== "edit"}
            >
              删除
            </button>
          </div>

          <div className="form-grid">
            {config.fields.map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  value={form[key] ?? ""}
                  disabled={mode === "edit" && key === "id"}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))}
                />
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="import-panel">
        <div className="import-title">
          <div>
            <span>Bulk Import</span>
            <strong>{config.label} JSON 导入</strong>
          </div>
          <button type="button" className="secondary-button" onClick={importRecords} disabled={saving}>
            导入覆盖
          </button>
        </div>
        <textarea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function getEditableRecords(
  referenceData: ReferenceDataResponse | null,
  resource: EditableResource,
): ReferenceRecord[] {
  if (!referenceData) {
    return [];
  }
  const collections = {
    "student-groups": referenceData.scheduleInput.student_groups,
    teachers: referenceData.scheduleInput.teachers,
    courses: referenceData.scheduleInput.courses,
    rooms: referenceData.scheduleInput.rooms,
    "time-slots": referenceData.scheduleInput.time_slots,
    "exam-tasks": referenceData.scheduleInput.exam_tasks,
  };
  return collections[resource];
}

function recordToForm(resource: EditableResource, record: ReferenceRecord): FormState {
  if (resource === "student-groups") {
    const group = record as StudentGroup;
    return {
      id: group.id,
      name: group.name,
      size: String(group.size),
      department_id: group.department_id,
    };
  }
  if (resource === "courses") {
    const course = record as Course;
    return {
      id: course.id,
      name: course.name,
      department_id: course.department_id,
      exam_type: course.exam_type,
    };
  }
  if (resource === "teachers") {
    const teacher = record as Teacher;
    return {
      id: teacher.id,
      name: teacher.name,
      department_id: teacher.department_id,
      unavailable_slot_ids: teacher.unavailable_slot_ids.join(","),
    };
  }
  if (resource === "rooms") {
    const room = record as Room;
    return {
      id: room.id,
      name: room.name,
      building_id: room.building_id,
      capacity: String(room.capacity),
      room_type: room.room_type,
      equipment_tags: room.equipment_tags.join(","),
    };
  }
  if (resource === "time-slots") {
    const slot = record as TimeSlot;
    return {
      id: slot.id,
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
      period_index: String(slot.period_index),
    };
  }
  const task = record as ExamTask;
  return {
    id: task.id,
    course_id: task.course_id,
    student_group_ids: task.student_group_ids.join(","),
    expected_count: String(task.expected_count),
    duration_minutes: String(task.duration_minutes),
    required_room_type: task.required_room_type,
    required_equipment_tags: task.required_equipment_tags.join(","),
    allowed_slot_ids: task.allowed_slot_ids.join(","),
    invigilator_count: String(task.invigilator_count),
  };
}

function formToPayload(resource: EditableResource, form: FormState): ReferenceRecord {
  if (resource === "student-groups") {
    return {
      id: form.id,
      name: form.name,
      size: Number(form.size),
      department_id: form.department_id,
    };
  }
  if (resource === "courses") {
    return {
      id: form.id,
      name: form.name,
      department_id: form.department_id,
      exam_type: form.exam_type as Course["exam_type"],
    };
  }
  if (resource === "teachers") {
    return {
      id: form.id,
      name: form.name,
      department_id: form.department_id,
      unavailable_slot_ids: splitList(form.unavailable_slot_ids),
    };
  }
  if (resource === "rooms") {
    return {
      id: form.id,
      name: form.name,
      building_id: form.building_id,
      capacity: Number(form.capacity),
      room_type: form.room_type as Room["room_type"],
      equipment_tags: splitList(form.equipment_tags),
    };
  }
  if (resource === "time-slots") {
    return {
      id: form.id,
      date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      period_index: Number(form.period_index),
    };
  }
  return {
    id: form.id,
    course_id: form.course_id,
    student_group_ids: splitList(form.student_group_ids),
    expected_count: Number(form.expected_count),
    duration_minutes: Number(form.duration_minutes),
    required_room_type: form.required_room_type as ExamTask["required_room_type"],
    required_equipment_tags: splitList(form.required_equipment_tags),
    allowed_slot_ids: splitList(form.allowed_slot_ids),
    invigilator_count: Number(form.invigilator_count),
  };
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function recordTitle(resource: EditableResource, record: ReferenceRecord) {
  if ("name" in record) {
    return record.name;
  }
  if (resource === "time-slots") {
    const slot = record as TimeSlot;
    return `${slot.date} ${slot.start_time}-${slot.end_time}`;
  }
  const task = record as ExamTask;
  return `${task.course_id} · ${task.expected_count} 人`;
}

function sampleImportText(resource: EditableResource) {
  const samples: Record<EditableResource, ReferenceRecord[]> = {
    courses: [{
      id: "c-import",
      name: "导入课程",
      department_id: "cs",
      exam_type: "written",
    }],
    teachers: [{
      id: "t-import",
      name: "导入教师",
      department_id: "cs",
      unavailable_slot_ids: [],
    }],
    rooms: [{
      id: "r-import",
      name: "导入考场",
      building_id: "main",
      capacity: 80,
      room_type: "standard",
      equipment_tags: [],
    }],
    "student-groups": [{
      id: "g-import",
      name: "导入学生群体",
      size: 60,
      department_id: "cs",
    }],
    "time-slots": [{
      id: "slot-import",
      date: "2026-06-21",
      start_time: "09:00",
      end_time: "11:00",
      period_index: 20,
    }],
    "exam-tasks": [{
      id: "task-import",
      course_id: "c-data-structures",
      student_group_ids: ["g-cs-2301"],
      expected_count: 60,
      duration_minutes: 120,
      required_room_type: "standard",
      required_equipment_tags: [],
      allowed_slot_ids: [],
      invigilator_count: 2,
    }],
  };
  return JSON.stringify(samples[resource], null, 2);
}

function omitId<T extends { id: string }>(value: T): Omit<T, "id"> {
  const { id: _id, ...rest } = value;
  return rest;
}

function formatDelta(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function formatSlot(slot: PublishedScheduleAudienceResponse["assignments"][number]["timeSlot"]) {
  return slot ? `${slot.date} ${slot.start_time}-${slot.end_time}` : "时间待确认";
}

function formatNames(items: Array<{ name: string }>) {
  return items.map((item) => item.name).join("、") || "未分配";
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  tone?: "danger" | "score";
}) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
