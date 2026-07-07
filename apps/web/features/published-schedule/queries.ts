import { apiClient } from "../../lib/api-client";
import { queryKeys } from "../../lib/query-keys";

export const publishedScheduleQueries = {
  schedule: () => ({
    queryKey: queryKeys.publishedSchedule,
    queryFn: () => apiClient.getPublishedSchedule(),
  }),
  notifications: () => ({
    queryKey: queryKeys.publishedScheduleNotifications,
    queryFn: () => apiClient.getPublishedScheduleNotifications(),
  }),
  teacherSchedule: (teacherId: string) => ({
    queryKey: queryKeys.publishedTeacherSchedule(teacherId),
    queryFn: () => apiClient.getPublishedTeacherSchedule(teacherId),
  }),
  studentSchedule: (studentGroupId: string) => ({
    queryKey: queryKeys.publishedStudentSchedule(studentGroupId),
    queryFn: () => apiClient.getPublishedStudentSchedule(studentGroupId),
  }),
};
