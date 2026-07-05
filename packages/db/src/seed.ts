import { demoBatch, demoScheduleInput } from "@examforge/shared";

const payload = {
  batch: demoBatch,
  counts: {
    studentGroups: demoScheduleInput.student_groups.length,
    teachers: demoScheduleInput.teachers.length,
    courses: demoScheduleInput.courses.length,
    rooms: demoScheduleInput.rooms.length,
    timeSlots: demoScheduleInput.time_slots.length,
    examTasks: demoScheduleInput.exam_tasks.length,
  },
};

console.log(JSON.stringify(payload, null, 2));
