"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Building2,
  CalendarClock,
  Database,
  Gauge,
  Play,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  DashboardResponse,
  ReferenceDataResponse,
  ScheduleRunResponse,
} from "@examforge/shared";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

type LoadState = "idle" | "loading" | "ready" | "error";

export function OperationsConsole() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [referenceData, setReferenceData] = useState<ReferenceDataResponse | null>(null);
  const [latestRun, setLatestRun] = useState<ScheduleRunResponse | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [runState, setRunState] = useState<LoadState>("idle");
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
      setRunState("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "排考运行失败");
      setRunState("error");
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
