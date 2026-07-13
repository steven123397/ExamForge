"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { AudienceRoutePage } from "../../components/layout/route-page";
import { PanelQueryError } from "../../components/shared/panel-query-error";
import { buildAudienceScheduleModel } from "./audience-page-model";
import { AudienceScheduleList, NextAssignment } from "./audience-schedule-list";
import { audienceQueries } from "./queries";
import styles from "./audience-pages.module.css";

export function StudentSchedulePage() {
  const audienceQuery = useQuery(audienceQueries.current());
  const scheduleQuery = useQuery(audienceQueries.schedule());
  const schedule = scheduleQuery.data?.kind === "student" ? scheduleQuery.data : null;
  const model = useMemo(
    () => buildAudienceScheduleModel(schedule?.assignments ?? [], new Date()),
    [schedule?.assignments],
  );
  const failed = audienceQuery.isError || scheduleQuery.isError;

  return (
    <AudienceRoutePage title="我的考试" context="所属班级 · 已发布日程">
      {failed ? (
        <PanelQueryError
          message="本人考试日程读取失败"
          retrying={audienceQuery.isFetching || scheduleQuery.isFetching}
          onRetry={() => Promise.all([audienceQuery.refetch(), scheduleQuery.refetch()])}
        />
      ) : audienceQuery.isLoading || scheduleQuery.isLoading ? (
        <p className={styles.empty} aria-live="polite">正在读取本人考试安排…</p>
      ) : audienceQuery.data?.kind !== "student" ? (
        <div className="alert" role="alert">当前账户没有有效的学生受众范围。</div>
      ) : (
        <>
          <section className={styles.introBand}>
            <div>
              <span>学生工作台</span>
              <h2>{audienceQuery.data.studentGroups.map((group) => group.name).join(" · ")}</h2>
              <p>此处仅包含与您所属班级相关的已发布考试。</p>
            </div>
            <dl>
              <div><dt>考试场次</dt><dd>{schedule?.assignments.length ?? 0}</dd></div>
              <div><dt>所属班级</dt><dd>{audienceQuery.data.studentGroups.length}</dd></div>
              <div><dt>发布版本</dt><dd>{schedule?.run.id ?? "尚未发布"}</dd></div>
            </dl>
          </section>
          {schedule ? (
            <>
              <NextAssignment assignment={model.nextAssignment} label="下一场考试" />
              <AudienceScheduleList days={model.days} emptyText="当前发布版本没有您的考试任务。" />
            </>
          ) : (
            <p className={styles.empty}>排考结果尚未发布，请稍后查看。</p>
          )}
        </>
      )}
    </AudienceRoutePage>
  );
}
