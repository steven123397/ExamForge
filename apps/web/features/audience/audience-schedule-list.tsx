import { CalendarDays, Clock3, MapPin, UsersRound } from "lucide-react";
import type { PublishedScheduleAssignmentView } from "@examforge/shared";
import type { AudienceScheduleDay } from "./audience-page-model";
import styles from "./audience-pages.module.css";

export function AudienceScheduleList({
  days,
  emptyText,
}: {
  days: AudienceScheduleDay[];
  emptyText: string;
}) {
  if (!days.length) return <p className={styles.empty}>{emptyText}</p>;
  return (
    <div className={styles.scheduleDays}>
      {days.map((day) => (
        <section className={styles.scheduleDay} key={day.date}>
          <header>
            <CalendarDays size={18} aria-hidden="true" />
            <div>
              <span>{formatWeekday(day.date)}</span>
              <h2>{formatDate(day.date)}</h2>
            </div>
            <strong>{day.assignments.length} 场</strong>
          </header>
          <div className={styles.assignmentList}>
            {day.assignments.map((assignment) => (
              <ScheduleItem assignment={assignment} key={assignment.assignment.exam_task_id} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ScheduleItem({ assignment }: { assignment: PublishedScheduleAssignmentView }) {
  return (
    <article className={styles.assignment}>
      <div className={styles.assignmentMain}>
        <span>{assignment.course?.exam_type === "computer" ? "机考" : "考试"}</span>
        <h3>{assignment.course?.name ?? assignment.assignment.exam_task_id}</h3>
        <p>{assignment.studentGroups.map((group) => group.name).join(" · ") || "班级待确认"}</p>
      </div>
      <dl>
        <div>
          <dt><Clock3 size={15} aria-hidden="true" />时间</dt>
          <dd>{formatTime(assignment)}</dd>
        </div>
        <div>
          <dt><MapPin size={15} aria-hidden="true" />考场</dt>
          <dd>{assignment.room?.name ?? "待分配"}</dd>
        </div>
        <div>
          <dt><UsersRound size={15} aria-hidden="true" />人数</dt>
          <dd>{assignment.examTask?.expected_count ?? "--"}</dd>
        </div>
      </dl>
    </article>
  );
}

export function NextAssignment({
  assignment,
  label,
}: {
  assignment: PublishedScheduleAssignmentView | null;
  label: string;
}) {
  return (
    <section className={styles.next} aria-label={label}>
      <p>{label}</p>
      {assignment ? (
        <>
          <h2>{assignment.course?.name ?? assignment.assignment.exam_task_id}</h2>
          <div>
            <span><CalendarDays size={16} aria-hidden="true" />{formatDate(assignment.timeSlot?.date)}</span>
            <span><Clock3 size={16} aria-hidden="true" />{formatTime(assignment)}</span>
            <span><MapPin size={16} aria-hidden="true" />{assignment.room?.name ?? "考场待定"}</span>
          </div>
        </>
      ) : <h2>本批次暂无后续安排</h2>}
    </section>
  );
}

function formatTime(assignment: PublishedScheduleAssignmentView) {
  const slot = assignment.timeSlot;
  return slot ? `${slot.start_time}–${slot.end_time}` : "时间待定";
}

function formatDate(date?: string) {
  if (!date || date === "日期待定") return date ?? "日期待定";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function formatWeekday(date: string) {
  if (date === "日期待定") return "待安排";
  return new Intl.DateTimeFormat("zh-CN", { weekday: "long" })
    .format(new Date(`${date}T00:00:00`));
}
