"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  CalendarClock,
  ClipboardList,
  Database,
  Gauge,
  Play,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PublishedScheduleNotificationsResponse,
  PublishedScheduleAudienceResponse,
  PublishedScheduleResponse,
  ScheduleDraftAdjustmentSuggestion,
  ScheduleDraftAdjustmentSuggestionsResponse,
  ScheduleRunComparisonResponse,
  ScheduleDraftComparisonResponse,
  ScheduleDraftDetailResponse,
  ScheduleDraftRescheduleResponse,
  ScheduleRunResponse,
  ScheduledExam,
} from "@examforge/shared";
import type { LoadState } from "../components/shared/load-state";
import { Metric } from "../components/shared/metric";
import { PanelSection as Panel } from "../components/shared/panel-section";
import { AsyncJobPanel } from "../features/async-jobs/async-job-panel";
import { useScheduleJobsQuery } from "../features/async-jobs/queries";
import { DraftWorkspace, type DraftAssignmentForm } from "../features/draft-workspace/draft-workspace";
import { PublishedScheduleViewer } from "../features/published-schedule/published-schedule-viewer";
import { ReferenceDataManager } from "../features/reference-data/reference-data-manager";
import { AuditEventsPanel } from "../features/run-history/audit-events-panel";
import { RunHistoryPanel } from "../features/run-history/run-history-panel";
import { TeacherUnavailablePanel } from "../features/teacher-unavailable/teacher-unavailable-panel";
import { ApiClientError, apiBase, apiClient } from "../lib/api-client";
import { queryKeys } from "../lib/query-keys";
import type { WorkspaceRole } from "../lib/roles";


export function OperationsConsole() {
  const [latestRun, setLatestRun] = useState<ScheduleRunResponse | null>(null);
  const [comparison, setComparison] = useState<ScheduleRunComparisonResponse | null>(null);
  const [notifications, setNotifications] = useState<PublishedScheduleNotificationsResponse | null>(null);
  const [currentDraft, setCurrentDraft] = useState<ScheduleDraftDetailResponse | null>(null);
  const [draftComparison, setDraftComparison] = useState<ScheduleDraftComparisonResponse | null>(null);
  const [draftSuggestions, setDraftSuggestions] = useState<ScheduleDraftAdjustmentSuggestionsResponse | null>(null);
  const [draftReschedule, setDraftReschedule] = useState<ScheduleDraftRescheduleResponse | null>(null);
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
  const [rescheduleState, setRescheduleState] = useState<LoadState>("idle");
  const [publishState, setPublishState] = useState<LoadState>("idle");
  const [queryState, setQueryState] = useState<LoadState>("idle");
  const [jobState, setJobState] = useState<LoadState>("idle");
  const [teacherState, setTeacherState] = useState<LoadState>("idle");
  const [notificationState, setNotificationState] = useState<LoadState>("idle");
  const [role, setRole] = useState<WorkspaceRole>("admin");
  const [error, setError] = useState<string | null>(null);
  const latestCompletedJobRunIdRef = useRef<string | null>(null);
  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => apiClient.getDashboard(),
  });
  const referenceDataQuery = useQuery({
    queryKey: queryKeys.referenceData,
    queryFn: () => apiClient.getReferenceData(),
  });
  const scheduleRunsQuery = useQuery({
    queryKey: queryKeys.scheduleRuns,
    queryFn: () => apiClient.listScheduleRuns(),
  });
  const auditEventsQuery = useQuery({
    queryKey: queryKeys.auditEvents,
    queryFn: () => apiClient.listAuditEvents(),
  });
  const publishedScheduleQuery = useQuery<PublishedScheduleResponse | null>({
    queryKey: queryKeys.publishedSchedule,
    queryFn: async () => {
      try {
        return await apiClient.getPublishedSchedule();
      } catch (reason) {
        if (statusOf(reason) === 404) {
          return null;
        }
        throw reason;
      }
    },
    retry: false,
  });
  const draftsQuery = useQuery({
    queryKey: queryKeys.scheduleDrafts,
    queryFn: () => apiClient.listScheduleDrafts(),
  });
  const scheduleJobsQuery = useScheduleJobsQuery();
  const dashboard = dashboardQuery.data ?? null;
  const referenceData = referenceDataQuery.data ?? null;
  const runHistory = scheduleRunsQuery.data?.runs ?? [];
  const auditEvents = auditEventsQuery.data?.events ?? [];
  const publishedSchedule = publishedScheduleQuery.data ?? null;
  const drafts = draftsQuery.data?.drafts ?? [];
  const scheduleJobs = scheduleJobsQuery.data?.jobs ?? [];

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    if (!scheduleJobsQuery.data) {
      return;
    }
    const latestCompleted = scheduleJobsQuery.data.jobs.find((job) => job.status === "completed" && job.runId);
    if (latestCompleted?.runId && latestCompletedJobRunIdRef.current !== latestCompleted.runId) {
      latestCompletedJobRunIdRef.current = latestCompleted.runId;
      void apiClient.getScheduleRun(latestCompleted.runId).then(setLatestRun).catch(() => undefined);
      void loadOperationalHistory();
    }
  }, [scheduleJobsQuery.data]);

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
      const [dashboardResult, referenceResult] = await Promise.all([
        dashboardQuery.refetch(),
        referenceDataQuery.refetch(),
      ]);
      if (dashboardResult.error || referenceResult.error || !dashboardResult.data || !referenceResult.data) {
        throw dashboardResult.error ?? referenceResult.error ?? new Error("API 响应异常");
      }
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
      const payload = await apiClient.createScheduleRun(role);
      setLatestRun(payload);
      await refreshDashboard();
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
      await apiClient.createScheduleJob(role);
      await scheduleJobsQuery.refetch();
      setJobState("ready");
    } catch (reason) {
      setError(statusOf(reason) === 403 ? "当前角色没有异步排考权限" : reason instanceof Error ? reason.message : "异步排考启动失败");
      setJobState("error");
    }
  }

  async function loadOperationalHistory() {
    const [, , publishedResult] = await Promise.allSettled([
      scheduleRunsQuery.refetch(),
      auditEventsQuery.refetch(),
      publishedScheduleQuery.refetch(),
      draftsQuery.refetch(),
      scheduleJobsQuery.refetch(),
    ]);

    if (publishedResult.status === "fulfilled" && !publishedResult.value.error && publishedResult.value.data) {
      await loadNotifications();
    } else if (publishedResult.status === "fulfilled" && !publishedResult.value.error && !publishedResult.value.data) {
      setNotifications(null);
      setTeacherSchedule(null);
      setStudentSchedule(null);
    }
  }

  async function compareRuns(baseId: string, targetId: string) {
    setCompareState("loading");
    setError(null);
    try {
      setComparison(await apiClient.compareScheduleRuns(baseId, targetId));
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
      await apiClient.publishScheduleRun(id, role);
      await loadOperationalHistory();
      await refreshDashboard();
      setPublishState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "方案发布失败");
      setPublishState("error");
    }
  }

  async function createDraftFromRun(id: string) {
    setDraftState("loading");
    setDraftReschedule(null);
    setRescheduleState("idle");
    setError(null);
    try {
      const payload = await apiClient.createDraftFromRun(id, role);
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
    setDraftReschedule(null);
    setRescheduleState("idle");
    setError(null);
    try {
      const payload = await apiClient.getScheduleDraft(id);
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
    setDraftReschedule(null);
    setRescheduleState("idle");
    setError(null);
    try {
      const payload = await apiClient.updateScheduleDraftAssignment(
        currentDraft.draft.id,
        examTaskId,
        patch,
        role,
      );
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
    await mutateDraft(() => apiClient.lockScheduleDraftAssignment(
      currentDraft.draft.id,
      selectedDraftAssignmentId,
      role,
    ), "考试锁定失败");
  }

  async function unlockDraftAssignment() {
    if (!currentDraft || !selectedDraftAssignmentId) {
      return;
    }
    await mutateDraft(() => apiClient.unlockScheduleDraftAssignment(
      currentDraft.draft.id,
      selectedDraftAssignmentId,
      role,
    ), "考试解锁失败");
  }

  async function rebalanceDraft() {
    if (!currentDraft) {
      return;
    }
    await mutateDraft(() => apiClient.rebalanceScheduleDraft(currentDraft.draft.id, role), "局部再平衡失败");
  }

  async function rescheduleDraft() {
    if (!currentDraft) {
      return;
    }
    setRescheduleState("loading");
    setDraftReschedule(null);
    setError(null);
    try {
      const payload = await apiClient.rescheduleScheduleDraft(currentDraft.draft.id, role);
      setLatestRun(payload);
      setDraftReschedule(payload);
      await refreshDashboard();
      await loadOperationalHistory();
      setRescheduleState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "增量重排失败");
      setRescheduleState("error");
    }
  }

  async function mutateDraft(
    mutation: () => Promise<ScheduleDraftDetailResponse>,
    message: string,
  ) {
    setDraftState("loading");
    setDraftReschedule(null);
    setRescheduleState("idle");
    setError(null);
    try {
      const payload = await mutation();
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
      setDraftSuggestions(await apiClient.getScheduleDraftSuggestions(id, examTaskId));
      setSuggestionState("ready");
    } catch (reason) {
      setDraftSuggestions(null);
      setSuggestionState(statusOf(reason) === 404 ? "idle" : "error");
    }
  }

  async function publishDraft() {
    if (!currentDraft) {
      return;
    }
    setDraftState("loading");
    setDraftReschedule(null);
    setRescheduleState("idle");
    setError(null);
    try {
      const payload = await apiClient.publishScheduleDraft(currentDraft.draft.id, role);
      setCurrentDraft((current) => current ? {
        ...current,
        draft: payload.draft,
      } : current);
      await loadDraftComparison(payload.draft.id);
      await loadOperationalHistory();
      setDraftState("ready");
    } catch (reason) {
      setError(statusOf(reason) === 409 ? "草稿仍有硬冲突，不能发布" : reason instanceof Error ? reason.message : "草稿发布失败");
      setDraftState("error");
    }
  }

  async function discardDraft() {
    if (!currentDraft) {
      return;
    }
    setDraftState("loading");
    setDraftReschedule(null);
    setRescheduleState("idle");
    setError(null);
    try {
      const payload = await apiClient.discardScheduleDraft(currentDraft.draft.id, role);
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
    try {
      setDraftComparison(await apiClient.compareScheduleDraft(id));
    } catch {
      setDraftComparison(null);
    }
  }

  async function rollbackPublishedSchedule() {
    setPublishState("loading");
    setError(null);
    try {
      await apiClient.rollbackPublishedSchedule(role);
      await loadOperationalHistory();
      await refreshDashboard();
      setPublishState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "方案回滚失败");
      setPublishState("error");
    }
  }

  async function queryTeacherSchedule(teacherId: string) {
    await queryPublishedSchedule(
      () => apiClient.getPublishedTeacherSchedule(teacherId),
      setTeacherSchedule,
      "教师安排查询失败",
    );
  }

  async function queryStudentSchedule(studentGroupId: string) {
    await queryPublishedSchedule(
      () => apiClient.getPublishedStudentSchedule(studentGroupId),
      setStudentSchedule,
      "学生安排查询失败",
    );
  }

  async function queryPublishedSchedule(
    query: () => Promise<PublishedScheduleAudienceResponse>,
    setter: (payload: PublishedScheduleAudienceResponse | null) => void,
    message: string,
  ) {
    setQueryState("loading");
    setError(null);
    try {
      setter(await query());
      setQueryState("ready");
    } catch (reason) {
      setError(statusOf(reason) === 404 ? "暂无已发布方案" : reason instanceof Error ? reason.message : message);
      setter(null);
      setQueryState("error");
    }
  }

  async function updateTeacherUnavailable(teacherId: string, slotIds: string[]) {
    setTeacherState("loading");
    setError(null);
    try {
      await apiClient.updateTeacherUnavailableSlots(teacherId, slotIds, role);
      await loadInitialData();
      setTeacherState("ready");
    } catch (reason) {
      setError(statusOf(reason) === 403 ? "当前角色没有维护教师不可用时段权限" : reason instanceof Error ? reason.message : "教师不可用时段保存失败");
      setTeacherState("error");
    }
  }

  async function loadNotifications() {
    setNotificationState("loading");
    try {
      setNotifications(await apiClient.getPublishedScheduleNotifications());
      setNotificationState("ready");
    } catch (reason) {
      setNotifications(null);
      setNotificationState(statusOf(reason) === 404 ? "idle" : "error");
    }
  }

  async function downloadPublishedCsv() {
    setNotificationState("loading");
    setError(null);
    try {
      const blob = await apiClient.downloadPublishedScheduleCsv(role);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "published-schedule.csv";
      link.click();
      URL.revokeObjectURL(url);
      setNotificationState("ready");
    } catch (reason) {
      setError(statusOf(reason) === 403 ? "当前角色没有导出已发布方案权限" : reason instanceof Error ? reason.message : "CSV 导出失败");
      setNotificationState("error");
    }
  }

  async function refreshDashboard() {
    const result = await dashboardQuery.refetch();
    return result.data;
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
            <AsyncJobPanel
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
          <ReferenceDataManager
            referenceData={referenceData}
            role={role}
            onRefresh={loadInitialData}
            onError={setError}
          />
        </Panel>

        <section className="split">
          <Panel title="排考运行历史" eyebrow="Run History">
            <RunHistoryPanel
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
            <AuditEventsPanel events={auditEvents} />
          </Panel>
        </section>

        <Panel title="方案工作台" eyebrow="Draft Workspace">
          <DraftWorkspace
            drafts={drafts}
            runs={runHistory}
            draft={currentDraft}
            comparison={draftComparison}
            suggestions={draftSuggestions}
            reschedule={draftReschedule}
            referenceData={referenceData}
            selectedAssignmentId={selectedDraftAssignmentId}
            draftForm={draftForm}
            draftState={draftState}
            suggestionState={suggestionState}
            rescheduleState={rescheduleState}
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
            onRescheduleDraft={rescheduleDraft}
            onPublishDraft={publishDraft}
            onDiscardDraft={discardDraft}
          />
        </Panel>

        <Panel title="教师不可用维护" eyebrow="Teacher Self-Service">
          <TeacherUnavailablePanel
            referenceData={referenceData}
            teacherState={teacherState}
            onSave={updateTeacherUnavailable}
          />
        </Panel>

        <Panel title="已发布查询" eyebrow="Published Portal">
          <PublishedScheduleViewer
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

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function statusOf(reason: unknown) {
  return reason instanceof ApiClientError ? reason.status : null;
}
