"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AudienceRoutePage } from "../../components/layout/route-page";
import { PanelQueryError } from "../../components/shared/panel-query-error";
import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";
import { buildAudienceScheduleModel, toggleUnavailableSlot } from "./audience-page-model";
import { AudienceScheduleList, NextAssignment } from "./audience-schedule-list";
import { audienceQueries } from "./queries";
import styles from "./audience-pages.module.css";

export function TeacherSchedulePage() {
  const queryClient = useQueryClient();
  const audienceQuery = useQuery(audienceQueries.current());
  const scheduleQuery = useQuery(audienceQueries.schedule());
  const availabilityQuery = useQuery(audienceQueries.teacherAvailability());
  const [selectedSlots, setSelectedSlots] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (availabilityQuery.data) {
      setSelectedSlots(availabilityQuery.data.teacher.unavailable_slot_ids);
    }
  }, [availabilityQuery.data]);

  const schedule = scheduleQuery.data?.kind === "teacher" ? scheduleQuery.data : null;
  const model = useMemo(
    () => buildAudienceScheduleModel(schedule?.assignments ?? [], new Date()),
    [schedule?.assignments],
  );
  const saveMutation = useMutation({
    mutationFn: () => apiClient.updateCurrentTeacherUnavailableSlots(selectedSlots),
    onSuccess: async (response) => {
      setSelectedSlots(response.teacher.unavailable_slot_ids);
      setSaveError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.currentAudience, exact: true }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.currentTeacherAvailability,
          exact: true,
        }),
      ]);
    },
    onError: (error) => setSaveError(error instanceof Error ? error.message : "保存失败"),
  });

  const failed = audienceQuery.isError || scheduleQuery.isError || availabilityQuery.isError;
  return (
    <AudienceRoutePage title="我的监考" context="本人日程 · 不可用时段">
      {failed ? (
        <PanelQueryError
          message="本人监考日程读取失败"
          retrying={audienceQuery.isFetching || scheduleQuery.isFetching || availabilityQuery.isFetching}
          onRetry={() => Promise.all([
            audienceQuery.refetch(),
            scheduleQuery.refetch(),
            availabilityQuery.refetch(),
          ])}
        />
      ) : audienceQuery.isLoading || scheduleQuery.isLoading || availabilityQuery.isLoading ? (
        <p className={styles.empty} aria-live="polite">正在读取本人监考安排…</p>
      ) : audienceQuery.data?.kind !== "teacher" ? (
        <div className="alert" role="alert">当前账户没有有效的教师受众范围。</div>
      ) : (
        <>
          <section className={styles.introBand}>
            <div>
              <span>教师工作台</span>
              <h2>{audienceQuery.data.teacher.name}</h2>
              <p>仅展示与当前账号绑定的监考安排。</p>
            </div>
            <dl>
              <div><dt>已发布任务</dt><dd>{schedule?.assignments.length ?? 0}</dd></div>
              <div><dt>不可用时段</dt><dd>{selectedSlots.length}</dd></div>
              <div><dt>发布版本</dt><dd>{schedule?.run.id ?? "尚未发布"}</dd></div>
            </dl>
          </section>
          {schedule ? (
            <>
              <NextAssignment assignment={model.nextAssignment} label="下一场监考" />
              <AudienceScheduleList days={model.days} emptyText="当前发布版本没有您的监考任务。" />
            </>
          ) : (
            <p className={styles.empty}>排考结果尚未发布，请稍后查看。</p>
          )}
          {availabilityQuery.data ? (
            <form
              className={styles.availability}
              onSubmit={(event) => {
                event.preventDefault();
                saveMutation.mutate();
              }}
            >
              <header>
                <div>
                  <CalendarOff size={20} aria-hidden="true" />
                  <div><h2>不可用时段</h2><p>勾选您无法承担监考的时段。</p></div>
                </div>
                <button className="primary-button" type="submit" disabled={saveMutation.isPending}>
                  <Save size={16} aria-hidden="true" />
                  {saveMutation.isPending ? "保存中" : "保存变更"}
                </button>
              </header>
              {saveError ? <div className="alert" role="alert">{saveError}</div> : null}
              <div className={styles.slotList}>
                {availabilityQuery.data.timeSlots.map((slot) => (
                  <label key={slot.id}>
                    <input
                      type="checkbox"
                      checked={selectedSlots.includes(slot.id)}
                      onChange={(event) => setSelectedSlots((current) => toggleUnavailableSlot(
                        current,
                        slot.id,
                        event.target.checked,
                        availabilityQuery.data.timeSlots,
                      ))}
                    />
                    <span>{slot.date}</span>
                    <strong>{slot.start_time}–{slot.end_time}</strong>
                  </label>
                ))}
              </div>
            </form>
          ) : null}
        </>
      )}
    </AudienceRoutePage>
  );
}
