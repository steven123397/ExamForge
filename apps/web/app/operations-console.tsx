"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  CalendarClock,
  Check,
  GitCompareArrows,
  Database,
  Gauge,
  History,
  Plus,
  Play,
  Save,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  DashboardResponse,
  AuditEventSummary,
  ReferenceDataResponse,
  ScheduleRunComparisonResponse,
  ScheduleRunResponse,
  ScheduleRunSummary,
  Course,
  Room,
  Teacher,
} from "@examforge/shared";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type LoadState = "idle" | "loading" | "ready" | "error";
type EditableResource = "courses" | "teachers" | "rooms";
type FormState = Record<string, string>;

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
} as const;

export function OperationsConsole() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [referenceData, setReferenceData] = useState<ReferenceDataResponse | null>(null);
  const [latestRun, setLatestRun] = useState<ScheduleRunResponse | null>(null);
  const [runHistory, setRunHistory] = useState<ScheduleRunSummary[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventSummary[]>([]);
  const [comparison, setComparison] = useState<ScheduleRunComparisonResponse | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [runState, setRunState] = useState<LoadState>("idle");
  const [compareState, setCompareState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadInitialData();
  }, []);

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

  async function loadOperationalHistory() {
    const [runsResponse, auditResponse] = await Promise.all([
      fetch(`${apiBase}/api/schedule-runs`, { cache: "no-store" }),
      fetch(`${apiBase}/api/audit-events`, { cache: "no-store" }),
    ]);

    if (runsResponse.ok) {
      const payload = (await runsResponse.json()) as { runs: ScheduleRunSummary[] };
      setRunHistory(payload.runs);
    }
    if (auditResponse.ok) {
      const payload = (await auditResponse.json()) as { events: AuditEventSummary[] };
      setAuditEvents(payload.events);
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
            onRefresh={loadInitialData}
            onError={setError}
          />
        </Panel>

        <section className="split">
          <Panel title="排考运行历史" eyebrow="Run History">
            <RunHistory
              runs={runHistory}
              comparison={comparison}
              compareState={compareState}
              onCompare={compareRuns}
            />
          </Panel>

          <Panel title="审计详情" eyebrow="Audit Trail">
            <AuditTrail events={auditEvents} />
          </Panel>
        </section>

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

function RunHistory({
  runs,
  comparison,
  compareState,
  onCompare,
}: {
  runs: ScheduleRunSummary[];
  comparison: ScheduleRunComparisonResponse | null;
  compareState: LoadState;
  onCompare(baseId: string, targetId: string): Promise<void>;
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
            </div>
            <dl>
              <div><dt>评分</dt><dd>{run.score}</dd></div>
              <div><dt>安排</dt><dd>{run.assignmentCount}</dd></div>
              <div><dt>冲突</dt><dd>{run.conflictCount}</dd></div>
            </dl>
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
  onRefresh,
  onError,
}: {
  referenceData: ReferenceDataResponse | null;
  onRefresh(): Promise<void>;
  onError(message: string | null): void;
}) {
  const [resource, setResource] = useState<EditableResource>("courses");
  const [mode, setMode] = useState<"create" | "edit">("edit");
  const [form, setForm] = useState<FormState>(referenceForms.courses.defaults);
  const [saving, setSaving] = useState(false);
  const config = referenceForms[resource];
  const records = getEditableRecords(referenceData, resource);
  const selectedId = form.id;

  useEffect(() => {
    const nextRecords = getEditableRecords(referenceData, resource);
    const first = nextRecords[0];
    setMode(first ? "edit" : "create");
    setForm(first ? recordToForm(resource, first) : referenceForms[resource].defaults);
  }, [referenceData, resource]);

  function selectResource(nextResource: EditableResource) {
    setResource(nextResource);
  }

  function selectRecord(record: Course | Teacher | Room) {
    setMode("edit");
    setForm(recordToForm(resource, record));
  }

  function createDraft() {
    setMode("create");
    setForm(referenceForms[resource].defaults);
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
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(mode === "create" ? payload : omitId(payload)),
      });

      if (!response.ok) {
        throw new Error("基础数据保存失败");
      }

      const result = await response.json() as { record: Course | Teacher | Room };
      setMode("edit");
      setForm(recordToForm(resource, result.record));
      await onRefresh();
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "基础数据保存失败");
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
              <span>{record.name}</span>
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
    </div>
  );
}

function getEditableRecords(
  referenceData: ReferenceDataResponse | null,
  resource: EditableResource,
): Array<Course | Teacher | Room> {
  if (!referenceData) {
    return [];
  }
  return referenceData.scheduleInput[resource];
}

function recordToForm(resource: EditableResource, record: Course | Teacher | Room): FormState {
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

function formToPayload(resource: EditableResource, form: FormState) {
  if (resource === "courses") {
    return {
      id: form.id,
      name: form.name,
      department_id: form.department_id,
      exam_type: form.exam_type,
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
  return {
    id: form.id,
    name: form.name,
    building_id: form.building_id,
    capacity: Number(form.capacity),
    room_type: form.room_type,
    equipment_tags: splitList(form.equipment_tags),
  };
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function omitId<T extends { id: string }>(value: T): Omit<T, "id"> {
  const { id: _id, ...rest } = value;
  return rest;
}

function formatDelta(value: number) {
  return value > 0 ? `+${value}` : String(value);
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
