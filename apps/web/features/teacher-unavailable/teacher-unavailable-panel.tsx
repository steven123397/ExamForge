import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReferenceDataResponse } from "@examforge/shared";
import type { LoadState } from "../../components/shared/load-state";

export function TeacherUnavailablePanel({
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
