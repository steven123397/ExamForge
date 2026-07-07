import { Bell, BookOpen, Download, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  PublishedScheduleAudienceResponse,
  PublishedScheduleNotificationsResponse,
  ReferenceDataResponse,
} from "@examforge/shared";
import type { LoadState } from "../../components/shared/load-state";

export function PublishedScheduleViewer({
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

function formatSlot(slot: PublishedScheduleAudienceResponse["assignments"][number]["timeSlot"]) {
  return slot ? `${slot.date} ${slot.start_time}-${slot.end_time}` : "时间待确认";
}

function formatNames(items: Array<{ name: string }>) {
  return items.map((item) => item.name).join("、") || "未分配";
}
