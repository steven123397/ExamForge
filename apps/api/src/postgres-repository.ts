import {
  auditEvents,
  conflictRecords,
  constraintProfiles,
  constraintProfileVersions,
  createDbSession,
  courses,
  draftChangeEvents,
  draftConflictRecords,
  draftExamInvigilators,
  draftScheduledExams,
  examBatches,
  examTaskStudentGroups,
  examTasks,
  rooms,
  resolveDefaultConstraintProfile,
  resolveConstraintProfile as resolveDbConstraintProfile,
  scheduleDrafts,
  ScheduleJobStore,
  scheduledExamInvigilators,
  scheduledExams,
  scheduleRuns,
  sessions,
  studentGroups,
  teacherUnavailableSlots,
  teachers,
  timeSlots,
  userStudentGroupScopes,
  userTeacherScopes,
  userRoles,
  users,
  type ExamForgeDbClient,
  type ExamForgeDatabase,
} from "@examforge/db";
import type {
  ClaimScheduleJobCommand,
  CompleteScheduleJobCommand,
  FailScheduleJobAttemptCommand,
  ScheduleJobClaimResult,
  ScheduleJobExecutionTransitionResult,
  ScheduleJobCancellationResult,
  ListScheduleJobEventsOptions,
  ScheduleJobEventCursorResult,
  ConstraintProfileMutationContext,
  CreateConstraintProfilePersistenceCommand,
  CreateConstraintProfileVersionPersistenceCommand,
  SetConstraintProfileDefaultPersistenceCommand,
  SetConstraintProfileStatusPersistenceCommand,
  ResolvedConstraintProfile,
} from "@examforge/scheduling-application";
import {
  type ConstraintProfile,
  type ConstraintProfileRecord,
  type AuditEventFilter,
  type AuditEventListResponse,
  type AuditEventSummary,
  type AudienceScope,
  type DashboardResponse,
  type PublishedScheduleResponse,
  type ReferenceDeleteResponse,
  type ReferenceImportResponse,
  type ReferenceRecord,
  type ReferenceDataResponse,
  type ReferenceResource,
  type ScheduleDraftAdjustmentSuggestionsResponse,
  type ScheduleDraftChangeEvent,
  type ScheduleDraftComparisonResponse,
  type ScheduleDraftDetailResponse,
  type ScheduleDraftDiscardResponse,
  type ScheduleDraftListResponse,
  type ScheduleDraftPublishResponse,
  type ScheduleDraftSummary,
  type ScheduleJobSummary,
  type ScheduleJobListQuery,
  type ScheduleJobListResponse,
  type ScheduleJobDetailResponse,
  type ScheduleJobEventEnvelope,
  type ScheduleRunComparisonResponse,
  type ScheduleRunListQuery,
  type ScheduleRunListResponse,
  type ScheduleRollbackResponse,
  type ScheduleResult,
  type ScheduleRunResponse,
  type ScheduleRunSummary,
  type ScheduledExam,
  type UserRole,
} from "@examforge/shared";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getCurrentAuthContext } from "./auth/request-context.js";
import {
  buildDraftComparison,
  buildDraftAdjustmentSuggestions,
  buildDraftScheduleResult,
  buildRunComparison,
  isScheduleResultPublishable,
  validateDraftAssignments,
  validateReferenceDelete,
  validateReferenceRecord,
  type CreateScheduleJobCommand,
  type CreateScheduleJobResult,
  type AuthSessionRecord,
  type AuthSessionWithUser,
  type AuthUserRecord,
  type CreateAuthSessionCommand,
  type CreateAuthUserCommand,
  type PlatformRepository,
  type PublishScheduleRunResult,
  type ScheduleRunPersistenceContext,
  type ScheduleJobTransitionResult,
  type TransitionScheduleJobCommand,
} from "./repository.js";

const scheduleDraftLockNamespace = 20_260_711;

type BatchRow = typeof examBatches.$inferSelect;
type RunRow = typeof scheduleRuns.$inferSelect;
type AuditEventRow = typeof auditEvents.$inferSelect;
type StudentGroupRow = typeof studentGroups.$inferSelect;
type TeacherRow = typeof teachers.$inferSelect;
type CourseRow = typeof courses.$inferSelect;
type RoomRow = typeof rooms.$inferSelect;
type TimeSlotRow = typeof timeSlots.$inferSelect;
type ExamTaskRow = typeof examTasks.$inferSelect;
type DraftRow = typeof scheduleDrafts.$inferSelect;
type DraftChangeEventRow = typeof draftChangeEvents.$inferSelect;
type UserRow = typeof users.$inferSelect;
type ConstraintProfileRow = typeof constraintProfiles.$inferSelect;
type ConstraintProfileVersionRow = typeof constraintProfileVersions.$inferSelect;

export class PostgresPlatformRepository implements PlatformRepository {
  readonly storageMode = "postgres" as const;
  private readonly scheduleJobStore: ScheduleJobStore;

  constructor(private readonly client: ExamForgeDbClient) {
    this.scheduleJobStore = new ScheduleJobStore(client);
  }

  async getDashboard(): Promise<DashboardResponse> {
    const referenceData = await this.getReferenceData();
    const latestRun = await this.getLatestRunSummary(referenceData.batch.id);

    return {
      batch: referenceData.batch,
      metrics: {
        examTaskCount: referenceData.scheduleInput.exam_tasks.length,
        teacherCount: referenceData.scheduleInput.teachers.length,
        roomCount: referenceData.scheduleInput.rooms.length,
        timeSlotCount: referenceData.scheduleInput.time_slots.length,
        conflictCount: latestRun?.conflictCount ?? 0,
        score: latestRun?.score ?? null,
      },
      latestRun,
    };
  }

  async getReferenceData(): Promise<ReferenceDataResponse> {
    const batch = await this.getActiveBatch();
    const [
      studentGroupRows,
      teacherRows,
      courseRows,
      roomRows,
      timeSlotRows,
      examTaskRows,
      teacherUnavailableSlotRows,
      examTaskStudentGroupRows,
    ] = await Promise.all([
      this.client.db.select().from(studentGroups),
      this.client.db.select().from(teachers),
      this.client.db.select().from(courses),
      this.client.db.select().from(rooms),
      this.client.db.select().from(timeSlots).where(eq(timeSlots.batchId, batch.id)),
      this.client.db.select().from(examTasks).where(eq(examTasks.batchId, batch.id)),
      this.client.db.select().from(teacherUnavailableSlots),
      this.client.db.select().from(examTaskStudentGroups),
    ]);
    const activeSlotIds = new Set(timeSlotRows.map((slot) => slot.id));
    const activeTaskIds = new Set(examTaskRows.map((task) => task.id));
    const unavailableSlotsByTeacher = groupRelationRows(
      teacherUnavailableSlotRows.filter((row) => activeSlotIds.has(row.timeSlotId)),
      "teacherId",
      "timeSlotId",
    );
    const studentGroupsByExamTask = groupRelationRows(
      examTaskStudentGroupRows.filter((row) => activeTaskIds.has(row.examTaskId)),
      "examTaskId",
      "studentGroupId",
    );

    return {
      batch: this.toBatchSummary(batch),
      scheduleInput: {
        student_groups: studentGroupRows.map((group) => ({
          id: group.id,
          name: group.name,
          size: group.size,
          department_id: group.departmentId,
        })),
        teachers: teacherRows.map((teacher) => ({
          id: teacher.id,
          name: teacher.name,
          department_id: teacher.departmentId,
          unavailable_slot_ids: unavailableSlotsByTeacher.get(teacher.id) ?? [],
        })),
        courses: courseRows.map((course) => ({
          id: course.id,
          name: course.name,
          department_id: course.departmentId,
          exam_type: course.type,
        })),
        rooms: roomRows.map((room) => ({
          id: room.id,
          name: room.name,
          building_id: room.buildingId,
          capacity: room.capacity,
          room_type: room.type,
          equipment_tags: room.equipmentTags,
        })),
        time_slots: timeSlotRows.map((slot) => ({
          id: slot.id,
          date: slot.date,
          start_time: slot.startTime,
          end_time: slot.endTime,
          period_index: slot.periodIndex,
        })),
        exam_tasks: examTaskRows.map((task) => ({
          id: task.id,
          course_id: task.courseId,
          student_group_ids: studentGroupsByExamTask.get(task.id) ?? [],
          expected_count: task.expectedCount,
          duration_minutes: task.durationMinutes,
          required_room_type: task.requiredRoomType,
          required_equipment_tags: task.requiredEquipmentTags,
          allowed_slot_ids: task.allowedSlotIds,
          invigilator_count: task.invigilatorCount,
        })),
        constraint_profile: batch.constraintProfile as ConstraintProfile,
        fixed_assignments: [],
        reschedule_context: null,
      },
    };
  }

  async listConstraintProfiles(includeDisabled: boolean): Promise<ConstraintProfileRecord[]> {
    const profileRows = includeDisabled
      ? await this.client.db.select().from(constraintProfiles).orderBy(
        desc(constraintProfiles.isDefault),
        asc(constraintProfiles.name),
        asc(constraintProfiles.id),
      )
      : await this.client.db.select().from(constraintProfiles)
        .where(eq(constraintProfiles.status, "active"))
        .orderBy(
          desc(constraintProfiles.isDefault),
          asc(constraintProfiles.name),
          asc(constraintProfiles.id),
        );
    if (profileRows.length === 0) {
      return [];
    }
    const versionRows = await this.client.db.select()
      .from(constraintProfileVersions)
      .where(inArray(
        constraintProfileVersions.profileId,
        profileRows.map((profile) => profile.id),
      ))
      .orderBy(
        asc(constraintProfileVersions.profileId),
        asc(constraintProfileVersions.versionNumber),
      );
    return profileRows.map((profile) => this.toConstraintProfileRecord(
      profile,
      versionRows.filter((version) => version.profileId === profile.id),
    ));
  }

  async getConstraintProfile(id: string): Promise<ConstraintProfileRecord | null> {
    return this.loadConstraintProfile(this.client.db, id);
  }

  resolveConstraintProfile(versionId?: string): Promise<ResolvedConstraintProfile> {
    return resolveDbConstraintProfile(this.client.db, versionId);
  }

  async createConstraintProfile(
    command: CreateConstraintProfilePersistenceCommand,
  ): Promise<ConstraintProfileRecord> {
    return this.client.db.transaction(async (tx) => {
      const profileId = `constraint-profile-${randomUUID()}`;
      const versionId = `${profileId}-v1`;
      const now = new Date();
      await tx.insert(constraintProfiles).values({
        id: profileId,
        name: command.name,
        status: "active",
        ownerUserId: command.context.actor.userId,
        currentVersionId: versionId,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      });
      await tx.insert(constraintProfileVersions).values({
        id: versionId,
        profileId,
        versionNumber: 1,
        schemaVersion: 1,
        digest: command.digest,
        config: command.config,
        createdByUserId: command.context.actor.userId,
        createdAt: now,
      });
      await this.insertConstraintProfileAudit(tx, command.context, {
        action: "constraint_profile.created",
        profileId,
        payload: {
          currentVersionId: versionId,
          digest: command.digest,
          result: "created",
        },
      });
      const profile = await this.loadConstraintProfile(tx, profileId);
      if (!profile) {
        throw new Error("Created constraint profile could not be reloaded.");
      }
      return profile;
    });
  }

  async createConstraintProfileVersion(
    command: CreateConstraintProfileVersionPersistenceCommand,
  ) {
    return this.client.db.transaction(async (tx) => {
      const [profile] = await tx.select().from(constraintProfiles)
        .where(eq(constraintProfiles.id, command.profileId))
        .limit(1)
        .for("update");
      if (!profile) {
        return { resolution: "not_found" as const };
      }
      if (profile.currentVersionId !== command.expectedCurrentVersionId) {
        return { resolution: "version_conflict" as const };
      }
      const [currentVersion] = await tx.select().from(constraintProfileVersions)
        .where(eq(constraintProfileVersions.id, profile.currentVersionId))
        .limit(1);
      if (!currentVersion) {
        throw new Error(`Constraint profile ${profile.id} has no current version.`);
      }
      const versionNumber = currentVersion.versionNumber + 1;
      const versionId = `${profile.id}-v${versionNumber}-${randomUUID()}`;
      const now = new Date();
      await tx.insert(constraintProfileVersions).values({
        id: versionId,
        profileId: profile.id,
        versionNumber,
        schemaVersion: 1,
        digest: command.digest,
        config: command.config,
        createdByUserId: command.context.actor.userId,
        createdAt: now,
      });
      const [updated] = await tx.update(constraintProfiles).set({
        currentVersionId: versionId,
        updatedAt: now,
      }).where(and(
        eq(constraintProfiles.id, profile.id),
        eq(constraintProfiles.currentVersionId, command.expectedCurrentVersionId),
      )).returning();
      if (!updated) {
        return { resolution: "version_conflict" as const };
      }
      await this.insertConstraintProfileAudit(tx, command.context, {
        action: "constraint_profile.version_created",
        profileId: profile.id,
        payload: {
          previousVersionId: profile.currentVersionId,
          currentVersionId: versionId,
          versionNumber,
          digest: command.digest,
          result: "created",
        },
      });
      const result = await this.loadConstraintProfile(tx, profile.id);
      if (!result) {
        throw new Error("Versioned constraint profile could not be reloaded.");
      }
      return { resolution: "created" as const, profile: result };
    });
  }

  async setConstraintProfileStatus(command: SetConstraintProfileStatusPersistenceCommand) {
    return this.client.db.transaction(async (tx) => {
      const [profile] = await tx.select().from(constraintProfiles)
        .where(eq(constraintProfiles.id, command.profileId))
        .limit(1)
        .for("update");
      if (!profile) {
        return { resolution: "not_found" as const };
      }
      if (profile.isDefault && command.status === "disabled") {
        return { resolution: "default_cannot_be_disabled" as const };
      }
      await tx.update(constraintProfiles).set({
        status: command.status,
        updatedAt: new Date(),
      }).where(eq(constraintProfiles.id, profile.id));
      await this.insertConstraintProfileAudit(tx, command.context, {
        action: "constraint_profile.status_changed",
        profileId: profile.id,
        payload: {
          previousStatus: profile.status,
          status: command.status,
          result: "updated",
        },
      });
      const result = await this.loadConstraintProfile(tx, profile.id);
      if (!result) {
        throw new Error("Updated constraint profile could not be reloaded.");
      }
      return { resolution: "updated" as const, profile: result };
    });
  }

  async setDefaultConstraintProfile(command: SetConstraintProfileDefaultPersistenceCommand) {
    return this.client.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(2026071304)`);
      const [profile] = await tx.select().from(constraintProfiles)
        .where(eq(constraintProfiles.id, command.profileId))
        .limit(1)
        .for("update");
      if (!profile) {
        return { resolution: "not_found" as const };
      }
      if (profile.status !== "active") {
        return { resolution: "inactive" as const };
      }
      const [previousDefault] = await tx.select({ id: constraintProfiles.id })
        .from(constraintProfiles)
        .where(eq(constraintProfiles.isDefault, true))
        .limit(1);
      const now = new Date();
      await tx.update(constraintProfiles).set({
        isDefault: false,
        updatedAt: now,
      }).where(eq(constraintProfiles.isDefault, true));
      await tx.update(constraintProfiles).set({
        isDefault: true,
        updatedAt: now,
      }).where(eq(constraintProfiles.id, profile.id));
      await this.insertConstraintProfileAudit(tx, command.context, {
        action: "constraint_profile.default_changed",
        profileId: profile.id,
        payload: {
          previousDefaultProfileId: previousDefault?.id ?? null,
          defaultProfileId: profile.id,
          result: "updated",
        },
      });
      const result = await this.loadConstraintProfile(tx, profile.id);
      if (!result) {
        throw new Error("Default constraint profile could not be reloaded.");
      }
      return { resolution: "updated" as const, profile: result };
    });
  }

  async createReferenceRecord(
    resource: ReferenceResource,
    record: ReferenceRecord,
  ): Promise<ReferenceRecord> {
    const batch = await this.getActiveBatch();
    validateReferenceRecord(resource, record, (await this.getReferenceData()).scheduleInput);
    const data = record as Record<string, unknown>;

    switch (resource) {
      case "student-groups": {
        const [row] = await this.client.db.insert(studentGroups).values({
          id: data.id as string,
          name: data.name as string,
          size: data.size as number,
          departmentId: data.department_id as string,
        }).returning();
        return this.toStudentGroup(row);
      }
      case "teachers": {
        const [row] = await this.client.db.transaction(async (tx) => {
          const [teacher] = await tx.insert(teachers).values({
            id: data.id as string,
            name: data.name as string,
            departmentId: data.department_id as string,
          }).returning();
          const unavailableSlotIds = data.unavailable_slot_ids as string[];
          if (unavailableSlotIds.length > 0) {
            await tx.insert(teacherUnavailableSlots).values(
              unavailableSlotIds.map((timeSlotId) => ({
                teacherId: teacher.id,
                timeSlotId,
              })),
            ).onConflictDoNothing();
          }
          return [teacher];
        });
        return {
          ...this.toTeacher(row),
          unavailable_slot_ids: data.unavailable_slot_ids as string[],
        };
      }
      case "courses": {
        const [row] = await this.client.db.insert(courses).values({
          id: data.id as string,
          name: data.name as string,
          departmentId: data.department_id as string,
          type: data.exam_type as "written" | "computer" | "oral",
        }).returning();
        return this.toCourse(row);
      }
      case "rooms": {
        const [row] = await this.client.db.insert(rooms).values({
          id: data.id as string,
          name: data.name as string,
          buildingId: data.building_id as string,
          capacity: data.capacity as number,
          type: data.room_type as "standard" | "computer_lab" | "language_lab",
          equipmentTags: data.equipment_tags as string[],
        }).returning();
        return this.toRoom(row);
      }
      case "time-slots": {
        const [row] = await this.client.db.insert(timeSlots).values({
          id: data.id as string,
          batchId: batch.id,
          date: data.date as string,
          startTime: data.start_time as string,
          endTime: data.end_time as string,
          periodIndex: data.period_index as number,
        }).returning();
        return this.toTimeSlot(row);
      }
      case "exam-tasks": {
        const [row] = await this.client.db.transaction(async (tx) => {
          const [task] = await tx.insert(examTasks).values({
            id: data.id as string,
            batchId: batch.id,
            courseId: data.course_id as string,
            expectedCount: data.expected_count as number,
            durationMinutes: data.duration_minutes as number,
            requiredRoomType: data.required_room_type as "standard" | "computer_lab" | "language_lab",
            requiredEquipmentTags: data.required_equipment_tags as string[],
            allowedSlotIds: data.allowed_slot_ids as string[],
            invigilatorCount: data.invigilator_count as number,
          }).returning();
          const studentGroupIds = data.student_group_ids as string[];
          if (studentGroupIds.length > 0) {
            await tx.insert(examTaskStudentGroups).values(
              studentGroupIds.map((studentGroupId) => ({
                examTaskId: task.id,
                studentGroupId,
              })),
            ).onConflictDoNothing();
          }
          return [task];
        });
        return {
          ...this.toExamTask(row),
          student_group_ids: data.student_group_ids as string[],
        };
      }
    }
  }

  async updateReferenceRecord(
    resource: ReferenceResource,
    id: string,
    patch: Partial<ReferenceRecord>,
  ): Promise<ReferenceRecord | null> {
    const referenceData = await this.getReferenceData();
    const existing = this.findReferenceRecord(referenceData, resource, id);
    if (!existing) {
      return null;
    }
    validateReferenceRecord(resource, {
      ...existing,
      ...patch,
      id,
    } as ReferenceRecord, referenceData.scheduleInput);

    const data = patch as Record<string, unknown>;

    switch (resource) {
      case "student-groups": {
        const [row] = await this.client.db.update(studentGroups).set(stripUndefined({
          name: data.name as string | undefined,
          size: data.size as number | undefined,
          departmentId: data.department_id as string | undefined,
        })).where(eq(studentGroups.id, id)).returning();
        return row ? this.toStudentGroup(row) : null;
      }
      case "teachers": {
        const [row] = await this.client.db.transaction(async (tx) => {
          const scalarPatch = stripUndefined({
            name: data.name as string | undefined,
            departmentId: data.department_id as string | undefined,
          });
          const [teacher] = Object.keys(scalarPatch).length > 0
            ? await tx.update(teachers).set(scalarPatch).where(eq(teachers.id, id)).returning()
            : await tx.select().from(teachers).where(eq(teachers.id, id)).limit(1);
          if (teacher && data.unavailable_slot_ids) {
            await tx.delete(teacherUnavailableSlots).where(eq(teacherUnavailableSlots.teacherId, id));
            const unavailableSlotIds = data.unavailable_slot_ids as string[];
            if (unavailableSlotIds.length > 0) {
              await tx.insert(teacherUnavailableSlots).values(
                unavailableSlotIds.map((timeSlotId) => ({
                  teacherId: id,
                  timeSlotId,
                })),
              ).onConflictDoNothing();
            }
          }
          return [teacher];
        });
        return row ? {
          ...this.toTeacher(row),
          unavailable_slot_ids: data.unavailable_slot_ids as string[] | undefined
            ?? (existing as ReferenceDataResponse["scheduleInput"]["teachers"][number]).unavailable_slot_ids,
        } : null;
      }
      case "courses": {
        const [row] = await this.client.db.update(courses).set(stripUndefined({
          name: data.name as string | undefined,
          departmentId: data.department_id as string | undefined,
          type: data.exam_type as "written" | "computer" | "oral" | undefined,
        })).where(eq(courses.id, id)).returning();
        return row ? this.toCourse(row) : null;
      }
      case "rooms": {
        const [row] = await this.client.db.update(rooms).set(stripUndefined({
          name: data.name as string | undefined,
          buildingId: data.building_id as string | undefined,
          capacity: data.capacity as number | undefined,
          type: data.room_type as "standard" | "computer_lab" | "language_lab" | undefined,
          equipmentTags: data.equipment_tags as string[] | undefined,
        })).where(eq(rooms.id, id)).returning();
        return row ? this.toRoom(row) : null;
      }
      case "time-slots": {
        const [row] = await this.client.db.update(timeSlots).set(stripUndefined({
          date: data.date as string | undefined,
          startTime: data.start_time as string | undefined,
          endTime: data.end_time as string | undefined,
          periodIndex: data.period_index as number | undefined,
        })).where(eq(timeSlots.id, id)).returning();
        return row ? this.toTimeSlot(row) : null;
      }
      case "exam-tasks": {
        const [row] = await this.client.db.transaction(async (tx) => {
          const [task] = await tx.update(examTasks).set(stripUndefined({
            courseId: data.course_id as string | undefined,
            expectedCount: data.expected_count as number | undefined,
            durationMinutes: data.duration_minutes as number | undefined,
            requiredRoomType: data.required_room_type as "standard" | "computer_lab" | "language_lab" | undefined,
            requiredEquipmentTags: data.required_equipment_tags as string[] | undefined,
            allowedSlotIds: data.allowed_slot_ids as string[] | undefined,
            invigilatorCount: data.invigilator_count as number | undefined,
          })).where(eq(examTasks.id, id)).returning();
          if (task && data.student_group_ids) {
            await tx.delete(examTaskStudentGroups).where(eq(examTaskStudentGroups.examTaskId, id));
            const studentGroupIds = data.student_group_ids as string[];
            if (studentGroupIds.length > 0) {
              await tx.insert(examTaskStudentGroups).values(
                studentGroupIds.map((studentGroupId) => ({
                  examTaskId: id,
                  studentGroupId,
                })),
              ).onConflictDoNothing();
            }
          }
          return [task];
        });
        return row ? {
          ...this.toExamTask(row),
          student_group_ids: data.student_group_ids as string[] | undefined
            ?? (existing as ReferenceDataResponse["scheduleInput"]["exam_tasks"][number]).student_group_ids,
        } : null;
      }
    }
  }

  async importReferenceRecords(
    resource: ReferenceResource,
    records: ReferenceRecord[],
  ): Promise<ReferenceImportResponse> {
    const imported: ReferenceRecord[] = [];
    for (const record of records) {
      const updated = await this.updateReferenceRecord(
        resource,
        record.id,
        omitReferenceId(record),
      );
      imported.push(updated ?? await this.createReferenceRecord(resource, record));
    }
    return { resource, records: imported };
  }

  async deleteReferenceRecord(
    resource: ReferenceResource,
    id: string,
  ): Promise<ReferenceDeleteResponse | null> {
    const referenceData = await this.getReferenceData();
    const existing = this.findReferenceRecord(referenceData, resource, id);
    if (!existing) {
      return null;
    }
    validateReferenceDelete(resource, id, referenceData.scheduleInput);

    switch (resource) {
      case "student-groups":
        await this.client.db.delete(studentGroups).where(eq(studentGroups.id, id));
        break;
      case "teachers":
        await this.client.db.delete(teachers).where(eq(teachers.id, id));
        break;
      case "courses":
        await this.client.db.delete(courses).where(eq(courses.id, id));
        break;
      case "rooms":
        await this.client.db.delete(rooms).where(eq(rooms.id, id));
        break;
      case "time-slots":
        await this.client.db.delete(timeSlots).where(eq(timeSlots.id, id));
        break;
      case "exam-tasks":
        await this.client.db.delete(examTasks).where(eq(examTasks.id, id));
        break;
    }

    return {
      resource,
      deleted: existing,
    };
  }

  async createScheduleRun(
    result: ScheduleResult,
    context?: ScheduleRunPersistenceContext,
  ): Promise<ScheduleRunResponse> {
    const batch = await this.getActiveBatch();
    return this.withDatabaseTransaction(async (db) => {
      const strategy = context ?? await this.defaultScheduleRunPersistenceContext(db);
      return this.insertScheduleRun(db, result, batch.id, strategy);
    });
  }

  async getScheduleRun(id: string): Promise<ScheduleRunResponse | null> {
    const [run] = await this.client.db
      .select()
      .from(scheduleRuns)
      .where(eq(scheduleRuns.id, id))
      .limit(1);

    if (!run) {
      return null;
    }

    const [assignmentRows, conflictRows] = await Promise.all([
      this.client.db
        .select()
        .from(scheduledExams)
        .where(eq(scheduledExams.runId, id)),
      this.client.db
        .select()
        .from(conflictRecords)
        .where(eq(conflictRecords.runId, id)),
    ]);
    const invigilatorRows = assignmentRows.length > 0
      ? await this.client.db
        .select()
        .from(scheduledExamInvigilators)
        .where(inArray(
          scheduledExamInvigilators.scheduledExamId,
          assignmentRows.map((assignment) => assignment.id),
        ))
        .orderBy(
          scheduledExamInvigilators.scheduledExamId,
          scheduledExamInvigilators.position,
        )
      : [];
    const teacherIdsByScheduledExam = groupRelationRows(
      invigilatorRows,
      "scheduledExamId",
      "teacherId",
      false,
    );
    const report = run.report as Record<string, unknown>;
    const diagnostics = Array.isArray(report.diagnostics)
      ? report.diagnostics as ScheduleResult["diagnostics"]
      : [];

    return {
      run: this.toRunSummary(run),
      result: {
        assignments: assignmentRows.map((assignment) => ({
          exam_task_id: assignment.examTaskId,
          room_id: assignment.roomId,
          time_slot_id: assignment.timeSlotId,
          teacher_ids: teacherIdsByScheduledExam.get(assignment.id) ?? [],
        })),
        conflicts: conflictRows.map((conflict) => ({
          type: conflict.type,
          severity: conflict.severity,
          affected_ids: conflict.affectedIds,
          message: conflict.message,
          suggestion: conflict.suggestion,
        })),
        score: run.scoreBreakdown,
        statistics: run.statistics as ScheduleResult["statistics"],
        diagnostics,
        report,
      },
    };
  }

  async listScheduleRuns(query: ScheduleRunListQuery = {
    page: 1,
    pageSize: 20,
  }): Promise<ScheduleRunListResponse> {
    const where = query.status ? eq(scheduleRuns.status, query.status) : undefined;
    const [rows, totalRows] = await Promise.all([
      this.client.db
        .select()
        .from(scheduleRuns)
        .where(where)
        .orderBy(desc(scheduleRuns.createdAt), desc(scheduleRuns.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.client.db
        .select({ count: sql<number>`count(*)::int` })
        .from(scheduleRuns)
        .where(where),
    ]);
    const total = totalRows[0]?.count ?? 0;

    return {
      runs: rows.map((run) => this.toRunSummary(run)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      pageCount: Math.ceil(total / query.pageSize),
    };
  }

  async compareScheduleRuns(
    baseId: string,
    targetId: string,
  ): Promise<ScheduleRunComparisonResponse | null> {
    const [base, target] = await Promise.all([
      this.getScheduleRun(baseId),
      this.getScheduleRun(targetId),
    ]);

    return base && target ? buildRunComparison(base, target) : null;
  }

  async createScheduleDraftFromRun(id: string): Promise<ScheduleDraftDetailResponse | null> {
    const source = await this.getScheduleRun(id);
    if (!source) {
      return null;
    }
    const batch = await this.getActiveBatch();
    const referenceData = await this.getReferenceData();
    const draftId = `draft-${randomUUID()}`;
    const now = new Date();
    const assignments = structuredClone(source.result.assignments);
    const conflicts = validateDraftAssignments(referenceData.scheduleInput, assignments);
    const draft: ScheduleDraftSummary = {
      id: draftId,
      batchId: batch.id,
      sourceRunId: id,
      basePublishedRunId: batch.publishedRunId,
      status: conflicts.length > 0 ? "blocked" : "validated",
      score: scoreDraft(conflicts.length),
      conflictCount: conflicts.length,
      assignmentCount: assignments.length,
      createdBy: "admin",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    await this.client.db.transaction(async (tx) => {
      await tx.insert(scheduleDrafts).values({
        id: draft.id,
        batchId: draft.batchId,
        sourceRunId: draft.sourceRunId,
        basePublishedRunId: draft.basePublishedRunId,
        status: draft.status,
        score: draft.score,
        conflictCount: draft.conflictCount,
        assignmentCount: draft.assignmentCount,
        createdBy: draft.createdBy,
        createdAt: now,
        updatedAt: now,
      });
      if (assignments.length > 0) {
        const draftScheduledExamRows = assignments.map((assignment, index) => ({
          id: `${draftId}-exam-${index + 1}`,
          draftId,
          examTaskId: assignment.exam_task_id,
          roomId: assignment.room_id,
          timeSlotId: assignment.time_slot_id,
          locked: false,
          updatedAt: now,
        }));
        await tx.insert(draftScheduledExams).values(draftScheduledExamRows);
        const invigilatorRows = draftScheduledExamRows.flatMap((row, index) => (
          assignments[index].teacher_ids.map((teacherId, teacherIndex) => ({
            draftScheduledExamId: row.id,
            position: teacherIndex + 1,
            teacherId,
          }))
        ));
        if (invigilatorRows.length > 0) {
          await tx.insert(draftExamInvigilators).values(invigilatorRows);
        }
      }
      if (conflicts.length > 0) {
        await tx.insert(draftConflictRecords).values(conflicts.map((conflict, index) => ({
          id: `${draftId}-conflict-${index + 1}`,
          draftId,
          type: conflict.type,
          severity: conflict.severity,
          affectedIds: conflict.affected_ids,
          message: conflict.message,
          suggestion: conflict.suggestion,
        })));
      }
      await tx.insert(auditEvents).values({
        id: `audit-${randomUUID()}`,
        ...this.auditActorValues("system"),
        action: "schedule_draft.created",
        entityType: "schedule_draft",
        entityId: draftId,
        payload: {
          sourceRunId: id,
          assignmentCount: assignments.length,
          conflictCount: conflicts.length,
        },
      });
    });

    return {
      draft,
      assignments,
      conflicts,
      changeEvents: [],
      lockedExamTaskIds: [],
    };
  }

  async listScheduleDrafts(): Promise<ScheduleDraftListResponse> {
    const rows = await this.client.db
      .select()
      .from(scheduleDrafts)
      .orderBy(desc(scheduleDrafts.updatedAt))
      .limit(30);
    return {
      drafts: rows.map((row) => this.toDraftSummary(row)),
    };
  }

  async getScheduleDraft(id: string): Promise<ScheduleDraftDetailResponse | null> {
    const [draft] = await this.client.db
      .select()
      .from(scheduleDrafts)
      .where(eq(scheduleDrafts.id, id))
      .limit(1);
    if (!draft) {
      return null;
    }

    const [assignmentRows, conflictRows, changeRows] = await Promise.all([
      this.client.db.select().from(draftScheduledExams).where(eq(draftScheduledExams.draftId, id)),
      this.client.db.select().from(draftConflictRecords).where(eq(draftConflictRecords.draftId, id)),
      this.client.db
        .select()
        .from(draftChangeEvents)
        .where(eq(draftChangeEvents.draftId, id))
        .orderBy(desc(draftChangeEvents.createdAt)),
    ]);
    const invigilatorRows = assignmentRows.length > 0
      ? await this.client.db
        .select()
        .from(draftExamInvigilators)
        .where(inArray(
          draftExamInvigilators.draftScheduledExamId,
          assignmentRows.map((assignment) => assignment.id),
        ))
        .orderBy(
          draftExamInvigilators.draftScheduledExamId,
          draftExamInvigilators.position,
        )
      : [];
    const teacherIdsByDraftExam = groupRelationRows(
      invigilatorRows,
      "draftScheduledExamId",
      "teacherId",
      false,
    );

    return {
      draft: this.toDraftSummary(draft),
      assignments: assignmentRows.map((assignment) => ({
        exam_task_id: assignment.examTaskId,
        room_id: assignment.roomId,
        time_slot_id: assignment.timeSlotId,
        teacher_ids: teacherIdsByDraftExam.get(assignment.id) ?? [],
      })),
      conflicts: conflictRows.map((conflict) => ({
        type: conflict.type,
        severity: conflict.severity,
        affected_ids: conflict.affectedIds,
        message: conflict.message,
        suggestion: conflict.suggestion,
      })),
      changeEvents: changeRows.map((event) => this.toDraftChangeEvent(event)),
      lockedExamTaskIds: assignmentRows
        .filter((assignment) => assignment.locked)
        .map((assignment) => assignment.examTaskId)
        .sort(),
    };
  }

  async updateScheduleDraftAssignment(
    id: string,
    examTaskId: string,
    patch: Partial<ScheduledExam>,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | "assignment_locked" | null> {
    return this.withScheduleDraftLock(id, (repository) => (
      repository.updateScheduleDraftAssignmentUnlocked(id, examTaskId, patch)
    ));
  }

  private async updateScheduleDraftAssignmentUnlocked(
    id: string,
    examTaskId: string,
    patch: Partial<ScheduledExam>,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | "assignment_locked" | null> {
    const current = await this.getScheduleDraft(id);
    if (!current) {
      return null;
    }
    if (current.draft.status === "published" || current.draft.status === "discarded") {
      return "not_editable";
    }
    if ((current.lockedExamTaskIds ?? []).includes(examTaskId)) {
      return "assignment_locked";
    }
    const index = current.assignments.findIndex((assignment) => (
      assignment.exam_task_id === examTaskId
    ));
    if (index === -1) {
      return null;
    }

    const referenceData = await this.getReferenceData();
    const before = structuredClone(current.assignments[index]);
    const after = {
      ...before,
      ...patch,
      exam_task_id: examTaskId,
    };
    const assignments = [...current.assignments];
    assignments[index] = after;
    const conflicts = validateDraftAssignments(referenceData.scheduleInput, assignments);
    const updatedAt = new Date();
    const status = conflicts.length > 0 ? "blocked" : "validated";
    const score = scoreDraft(conflicts.length);
    const changeId = `draft-change-${randomUUID()}`;

    await this.client.db.transaction(async (tx) => {
      const [updatedAssignment] = await tx.update(draftScheduledExams)
        .set({
          roomId: after.room_id,
          timeSlotId: after.time_slot_id,
          updatedAt,
        })
        .where(and(
          eq(draftScheduledExams.draftId, id),
          eq(draftScheduledExams.examTaskId, examTaskId),
        ))
        .returning();
      if (updatedAssignment) {
        await tx.delete(draftExamInvigilators)
          .where(eq(draftExamInvigilators.draftScheduledExamId, updatedAssignment.id));
        if (after.teacher_ids.length > 0) {
          await tx.insert(draftExamInvigilators).values(
            after.teacher_ids.map((teacherId, index) => ({
              draftScheduledExamId: updatedAssignment.id,
              position: index + 1,
              teacherId,
            })),
          );
        }
      }
      await tx.delete(draftConflictRecords).where(eq(draftConflictRecords.draftId, id));
      if (conflicts.length > 0) {
        await tx.insert(draftConflictRecords).values(conflicts.map((conflict, conflictIndex) => ({
          id: `${id}-conflict-${updatedAt.getTime()}-${conflictIndex + 1}`,
          draftId: id,
          type: conflict.type,
          severity: conflict.severity,
          affectedIds: conflict.affected_ids,
          message: conflict.message,
          suggestion: conflict.suggestion,
        })));
      }
      await tx.insert(draftChangeEvents).values({
        id: changeId,
        draftId: id,
        examTaskId,
        before,
        after,
        ...this.auditActorValues("admin"),
        createdAt: updatedAt,
      });
      await tx.update(scheduleDrafts)
        .set({
          status,
          score,
          conflictCount: conflicts.length,
          assignmentCount: assignments.length,
          updatedAt,
        })
        .where(eq(scheduleDrafts.id, id));
      await tx.insert(auditEvents).values({
        id: `audit-${randomUUID()}`,
        ...this.auditActorValues("system"),
        action: "schedule_draft.assignment_updated",
        entityType: "schedule_draft",
        entityId: id,
        payload: {
          examTaskId,
          before,
          after,
          conflictCount: conflicts.length,
        },
      });
    });

    return this.getScheduleDraft(id);
  }

  async validateScheduleDraft(id: string): Promise<ScheduleDraftDetailResponse | "not_editable" | null> {
    return this.withScheduleDraftLock(id, (repository) => repository.validateScheduleDraftUnlocked(id));
  }

  private async validateScheduleDraftUnlocked(
    id: string,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | null> {
    const current = await this.getScheduleDraft(id);
    if (!current) {
      return null;
    }
    if (current.draft.status === "published" || current.draft.status === "discarded") {
      return "not_editable";
    }
    const referenceData = await this.getReferenceData();
    const conflicts = validateDraftAssignments(referenceData.scheduleInput, current.assignments);
    const updatedAt = new Date();
    const validated = await this.client.db.transaction(async (tx) => {
      const [updatedDraft] = await tx.update(scheduleDrafts)
        .set({
          status: conflicts.length > 0 ? "blocked" : "validated",
          score: scoreDraft(conflicts.length),
          conflictCount: conflicts.length,
          updatedAt,
        })
        .where(and(
          eq(scheduleDrafts.id, id),
          inArray(scheduleDrafts.status, ["editing", "validated", "blocked"]),
        ))
        .returning();
      if (!updatedDraft) {
        return false;
      }
      await tx.delete(draftConflictRecords).where(eq(draftConflictRecords.draftId, id));
      if (conflicts.length > 0) {
        await tx.insert(draftConflictRecords).values(conflicts.map((conflict, index) => ({
          id: `${id}-conflict-${updatedAt.getTime()}-${index + 1}`,
          draftId: id,
          type: conflict.type,
          severity: conflict.severity,
          affectedIds: conflict.affected_ids,
          message: conflict.message,
          suggestion: conflict.suggestion,
        })));
      }
      await tx.insert(auditEvents).values({
        id: `audit-${randomUUID()}`,
        ...this.auditActorValues("system"),
        action: "schedule_draft.validated",
        entityType: "schedule_draft",
        entityId: id,
        payload: { conflictCount: conflicts.length },
      });
      return true;
    });
    if (!validated) {
      return this.getScheduleDraft(id);
    }
    return this.getScheduleDraft(id);
  }

  async compareScheduleDraft(id: string): Promise<ScheduleDraftComparisonResponse | null> {
    const current = await this.getScheduleDraft(id);
    const source = current ? await this.getScheduleRun(current.draft.sourceRunId) : null;
    const published = await this.getPublishedSchedule();
    return current && source ? buildDraftComparison(current, source, published) : null;
  }

  async suggestScheduleDraftAssignment(
    id: string,
    examTaskId: string,
  ): Promise<ScheduleDraftAdjustmentSuggestionsResponse | null> {
    const [current, referenceData] = await Promise.all([
      this.getScheduleDraft(id),
      this.getReferenceData(),
    ]);
    return current
      ? (current.lockedExamTaskIds ?? []).includes(examTaskId)
        ? { draft: current.draft, examTaskId, suggestions: [] }
        : buildDraftAdjustmentSuggestions(referenceData.scheduleInput, current, examTaskId)
      : null;
  }

  async lockScheduleDraftAssignment(
    id: string,
    examTaskId: string,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | null> {
    return this.withScheduleDraftLock(id, (repository) => (
      repository.lockScheduleDraftAssignmentUnlocked(id, examTaskId)
    ));
  }

  private async lockScheduleDraftAssignmentUnlocked(
    id: string,
    examTaskId: string,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | null> {
    const current = await this.getScheduleDraft(id);
    if (!current || !current.assignments.some((assignment) => assignment.exam_task_id === examTaskId)) {
      return null;
    }
    if (current.draft.status === "published" || current.draft.status === "discarded") {
      return "not_editable";
    }
    const [updated] = await this.client.db.update(draftScheduledExams)
      .set({ locked: true, updatedAt: new Date() })
      .where(and(
        eq(draftScheduledExams.draftId, id),
        eq(draftScheduledExams.examTaskId, examTaskId),
      ))
      .returning();
    if (!updated) {
      return null;
    }
    await this.recordAuditEvent("schedule_draft.assignment_locked", "schedule_draft", id, { examTaskId });
    return this.getScheduleDraft(id);
  }

  async unlockScheduleDraftAssignment(
    id: string,
    examTaskId: string,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | null> {
    return this.withScheduleDraftLock(id, (repository) => (
      repository.unlockScheduleDraftAssignmentUnlocked(id, examTaskId)
    ));
  }

  private async unlockScheduleDraftAssignmentUnlocked(
    id: string,
    examTaskId: string,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | null> {
    const current = await this.getScheduleDraft(id);
    if (!current || !current.assignments.some((assignment) => assignment.exam_task_id === examTaskId)) {
      return null;
    }
    if (current.draft.status === "published" || current.draft.status === "discarded") {
      return "not_editable";
    }
    const [updated] = await this.client.db.update(draftScheduledExams)
      .set({ locked: false, updatedAt: new Date() })
      .where(and(
        eq(draftScheduledExams.draftId, id),
        eq(draftScheduledExams.examTaskId, examTaskId),
      ))
      .returning();
    if (!updated) {
      return null;
    }
    await this.recordAuditEvent("schedule_draft.assignment_unlocked", "schedule_draft", id, { examTaskId });
    return this.getScheduleDraft(id);
  }

  async rebalanceScheduleDraft(id: string): Promise<ScheduleDraftDetailResponse | "not_editable" | null> {
    return this.withScheduleDraftLock(id, (repository) => repository.rebalanceScheduleDraftUnlocked(id));
  }

  private async rebalanceScheduleDraftUnlocked(
    id: string,
  ): Promise<ScheduleDraftDetailResponse | "not_editable" | null> {
    const current = await this.getScheduleDraft(id);
    if (!current) {
      return null;
    }
    if (current.draft.status === "published" || current.draft.status === "discarded") {
      return "not_editable";
    }

    const referenceData = await this.getReferenceData();
    const locked = new Set(current.lockedExamTaskIds ?? []);
    let detail = current;
    const conflictedExamIds = new Set(detail.conflicts.flatMap((conflict) => conflict.affected_ids));
    for (const assignment of [...detail.assignments]) {
      if (locked.has(assignment.exam_task_id) || !conflictedExamIds.has(assignment.exam_task_id)) {
        continue;
      }
      const candidate = buildDraftAdjustmentSuggestions(
        referenceData.scheduleInput,
        detail,
        assignment.exam_task_id,
      )?.suggestions.find((suggestion) => suggestion.hardConflictCount === 0);
      if (!candidate) {
        continue;
      }
      const updated = await this.updateScheduleDraftAssignmentUnlocked(id, assignment.exam_task_id, {
        room_id: candidate.assignment.room_id,
        time_slot_id: candidate.assignment.time_slot_id,
        teacher_ids: candidate.assignment.teacher_ids,
      });
      if (updated && updated !== "not_editable" && updated !== "assignment_locked") {
        detail = updated;
      }
    }
    await this.recordAuditEvent("schedule_draft.rebalanced", "schedule_draft", id, {
      lockedExamTaskIds: [...locked],
      conflictCount: detail.conflicts.length,
    });
    return detail;
  }

  async publishScheduleDraft(id: string): Promise<ScheduleDraftPublishResponse | "conflict" | "not_publishable" | null> {
    return this.withScheduleDraftLock(id, (repository) => repository.publishScheduleDraftUnlocked(id));
  }

  private async publishScheduleDraftUnlocked(
    id: string,
  ): Promise<ScheduleDraftPublishResponse | "conflict" | "not_publishable" | null> {
    const existing = await this.getScheduleDraft(id);
    if (!existing) {
      return null;
    }
    if (existing.draft.status === "published" || existing.draft.status === "discarded") {
      return "not_publishable";
    }
    const current = await this.validateScheduleDraftUnlocked(id);
    if (!current) {
      return null;
    }
    if (current === "not_editable") {
      return "not_publishable";
    }
    if (current.conflicts.some((conflict) => conflict.severity === "error")) {
      return "conflict";
    }
    const batch = await this.getActiveBatch();
    const runId = `run-${randomUUID()}`;
    const createdAt = new Date();
    const result = buildDraftScheduleResult(current);
    const run: ScheduleRunSummary = {
      id: runId,
      status: "feasible",
      createdAt: createdAt.toISOString(),
      elapsedMs: 0,
      score: current.draft.score,
      conflictCount: current.conflicts.length,
      assignmentCount: current.assignments.length,
    };

    const publishedDraft = await this.client.db.transaction(async (tx) => {
      const strategy = await resolveDefaultConstraintProfile(tx);
      const [claimedDraft] = await tx.update(scheduleDrafts)
        .set({
          status: "published",
          updatedAt: createdAt,
        })
        .where(and(
          eq(scheduleDrafts.id, id),
          inArray(scheduleDrafts.status, ["editing", "validated", "blocked"]),
        ))
        .returning();
      if (!claimedDraft) {
        return null;
      }
      await tx.insert(scheduleRuns).values({
        id: runId,
        batchId: batch.id,
        status: run.status,
        score: run.score,
        scoreBreakdown: result.score,
        conflictCount: run.conflictCount,
        assignmentCount: run.assignmentCount,
        elapsedMs: run.elapsedMs,
        statistics: result.statistics,
        report: result.report ?? {},
        constraintProfileVersionId: strategy.versionId,
        constraintProfileSnapshot: strategy.snapshot,
        schedulerVersion: "0.1.0",
        scoringContractVersion: result.score.scoring_contract_version,
        normalizedScore: result.score.normalized_score,
        createdAt,
      });
      if (current.assignments.length > 0) {
        const scheduledExamRows = current.assignments.map((assignment, index) => ({
          id: `${runId}-exam-${index + 1}`,
          runId,
          examTaskId: assignment.exam_task_id,
          roomId: assignment.room_id,
          timeSlotId: assignment.time_slot_id,
        }));
        await tx.insert(scheduledExams).values(scheduledExamRows);
        const invigilatorRows = scheduledExamRows.flatMap((row, index) => (
          current.assignments[index].teacher_ids.map((teacherId, teacherIndex) => ({
            scheduledExamId: row.id,
            position: teacherIndex + 1,
            teacherId,
          }))
        ));
        if (invigilatorRows.length > 0) {
          await tx.insert(scheduledExamInvigilators).values(invigilatorRows);
        }
      }
      await tx.update(examBatches)
        .set({
          status: "published",
          publishedRunId: runId,
        })
        .where(eq(examBatches.id, batch.id));
      await tx.insert(auditEvents).values({
        id: `audit-${randomUUID()}`,
        ...this.auditActorValues("system"),
        action: "schedule_draft.published",
        entityType: "schedule_draft",
        entityId: id,
        payload: {
          runId,
          sourceRunId: current.draft.sourceRunId,
          score: current.draft.score,
        },
      });
      return claimedDraft;
    });
    if (!publishedDraft) {
      return "not_publishable";
    }

    const updatedBatch = {
      ...batch,
      status: "published" as const,
      publishedRunId: runId,
    };
    return {
      batch: this.toBatchSummary(updatedBatch),
      draft: {
        ...current.draft,
        status: "published",
        updatedAt: createdAt.toISOString(),
      },
      run,
      result,
    };
  }

  async discardScheduleDraft(id: string): Promise<ScheduleDraftDiscardResponse | "not_discardable" | null> {
    return this.withScheduleDraftLock(id, (repository) => repository.discardScheduleDraftUnlocked(id));
  }

  private async discardScheduleDraftUnlocked(
    id: string,
  ): Promise<ScheduleDraftDiscardResponse | "not_discardable" | null> {
    const current = await this.getScheduleDraft(id);
    if (!current) {
      return null;
    }
    if (current.draft.status === "published" || current.draft.status === "discarded") {
      return "not_discardable";
    }
    const updatedAt = new Date();
    const updated = await this.client.db.transaction(async (tx) => {
      const [draft] = await tx.update(scheduleDrafts)
        .set({
          status: "discarded",
          updatedAt,
        })
        .where(and(
          eq(scheduleDrafts.id, id),
          inArray(scheduleDrafts.status, ["editing", "validated", "blocked"]),
        ))
        .returning();
      if (!draft) {
        return null;
      }
      await tx.insert(auditEvents).values({
        id: `audit-${randomUUID()}`,
        ...this.auditActorValues("system"),
        action: "schedule_draft.discarded",
        entityType: "schedule_draft",
        entityId: id,
        payload: {
          sourceRunId: current.draft.sourceRunId,
          conflictCount: current.draft.conflictCount,
          assignmentCount: current.draft.assignmentCount,
        },
      });
      return draft;
    });
    return updated ? { draft: this.toDraftSummary(updated) } : "not_discardable";
  }

  async listAuditEvents(filter: AuditEventFilter = {}): Promise<AuditEventListResponse> {
    const from = filter.from ?? filter.since;
    const to = filter.to ?? filter.until;
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? filter.limit ?? 20;
    const conditions = [
      filter.entityType ? eq(auditEvents.entityType, filter.entityType) : undefined,
      filter.entityId ? eq(auditEvents.entityId, filter.entityId) : undefined,
      filter.actor ? eq(auditEvents.actor, filter.actor) : undefined,
      filter.action ? eq(auditEvents.action, filter.action) : undefined,
      filter.traceId
        ? sql`${auditEvents.payload} ->> 'traceId' = ${filter.traceId}`
        : undefined,
      from ? gte(auditEvents.createdAt, new Date(from)) : undefined,
      to ? lte(auditEvents.createdAt, new Date(to)) : undefined,
    ].filter((condition) => condition !== undefined);
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totalRows] = await Promise.all([
      this.client.db
        .select()
        .from(auditEvents)
        .where(where)
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.client.db
        .select({ count: sql<number>`count(*)::int` })
        .from(auditEvents)
        .where(where),
    ]);
    const total = totalRows[0]?.count ?? 0;

    return {
      events: rows.map((event) => this.toAuditEvent(event)),
      page,
      pageSize,
      total,
      pageCount: Math.ceil(total / pageSize),
    };
  }

  async publishScheduleRun(id: string): Promise<PublishScheduleRunResult> {
    const [response, referenceData] = await Promise.all([
      this.getScheduleRun(id),
      this.getReferenceData(),
    ]);
    if (!response) {
      return null;
    }
    if (!isScheduleResultPublishable(referenceData.scheduleInput, response.result)) {
      return "not_publishable";
    }
    const batch = await this.getActiveBatch();
    const [updatedBatch] = await this.client.db
      .update(examBatches)
      .set({
        status: "published",
        publishedRunId: id,
      })
      .where(eq(examBatches.id, batch.id))
      .returning();

    await this.recordAuditEvent("schedule_run.published", "schedule_run", id, {
      batchId: batch.id,
      score: response.run.score,
      status: response.run.status,
    });

    return {
      batch: this.toBatchSummary(updatedBatch),
      run: response.run,
      result: response.result,
    };
  }

  async getPublishedSchedule(): Promise<PublishedScheduleResponse | null> {
    const batch = await this.getActiveBatch();
    if (!batch.publishedRunId) {
      return null;
    }
    const response = await this.getScheduleRun(batch.publishedRunId);
    return response ? {
      batch: this.toBatchSummary(batch),
      run: response.run,
      result: response.result,
    } : null;
  }

  async rollbackPublishedSchedule(): Promise<ScheduleRollbackResponse> {
    const batch = await this.getActiveBatch();
    const previousRun = batch.publishedRunId
      ? (await this.getScheduleRun(batch.publishedRunId))?.run ?? null
      : null;
    const [updatedBatch] = await this.client.db
      .update(examBatches)
      .set({
        status: "ready",
        publishedRunId: null,
      })
      .where(eq(examBatches.id, batch.id))
      .returning();

    await this.recordAuditEvent("schedule_run.rollback", "exam_batch", batch.id, {
      previousRunId: previousRun?.id ?? null,
    });

    return {
      batch: this.toBatchSummary(updatedBatch),
      previousRun,
    };
  }

  async createScheduleJob(command: CreateScheduleJobCommand): Promise<CreateScheduleJobResult> {
    return this.scheduleJobStore.createScheduleJob(command);
  }

  async listScheduleJobs(query?: ScheduleJobListQuery): Promise<ScheduleJobListResponse> {
    return this.scheduleJobStore.listScheduleJobs(query);
  }

  async getScheduleJob(id: string): Promise<ScheduleJobSummary | null> {
    return this.scheduleJobStore.getScheduleJob(id);
  }

  async getScheduleJobDetail(id: string): Promise<ScheduleJobDetailResponse | null> {
    return this.scheduleJobStore.getScheduleJobDetail(id);
  }

  async requestScheduleJobCancellation(id: string): Promise<ScheduleJobCancellationResult> {
    return this.scheduleJobStore.requestScheduleJobCancellation(id);
  }

  async isScheduleJobCancellationRequested(id: string): Promise<boolean> {
    return this.scheduleJobStore.isScheduleJobCancellationRequested(id);
  }

  async listScheduleJobEvents(
    jobId: string,
    options: ListScheduleJobEventsOptions = {},
  ): Promise<ScheduleJobEventEnvelope[]> {
    return this.scheduleJobStore.listScheduleJobEvents(jobId, options);
  }

  async resolveScheduleJobEventCursor(
    jobId: string,
    eventId: string,
  ): Promise<ScheduleJobEventCursorResult> {
    return this.scheduleJobStore.resolveScheduleJobEventCursor(jobId, eventId);
  }

  async claimScheduleJob(
    id: string,
    command: ClaimScheduleJobCommand = {},
  ): Promise<ScheduleJobClaimResult> {
    return this.scheduleJobStore.claimScheduleJob(id, command);
  }

  async failScheduleJobAttempt(
    id: string,
    command: FailScheduleJobAttemptCommand,
  ): Promise<ScheduleJobExecutionTransitionResult> {
    return this.scheduleJobStore.failScheduleJobAttempt(id, command);
  }

  async transitionScheduleJob(
    id: string,
    command: TransitionScheduleJobCommand,
  ): Promise<ScheduleJobTransitionResult> {
    return this.scheduleJobStore.transitionScheduleJob(id, command);
  }

  async completeScheduleJob(
    id: string,
    command: CompleteScheduleJobCommand,
  ): Promise<ScheduleJobExecutionTransitionResult> {
    return this.scheduleJobStore.completeScheduleJob(id, command);
  }

  async createAuthUser(command: CreateAuthUserCommand): Promise<AuthUserRecord> {
    await this.client.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: command.id,
        username: command.username,
        displayName: command.displayName,
        active: command.active,
        passwordHash: command.password.hash,
        passwordSalt: command.password.salt,
        scryptN: command.password.n,
        scryptR: command.password.r,
        scryptP: command.password.p,
        scryptKeyLength: command.password.keyLength,
      });
      if (command.roles.length > 0) {
        await tx.insert(userRoles).values(command.roles.map((role) => ({
          userId: command.id,
          roleId: role,
        })));
      }
    });
    return structuredClone(command);
  }

  async findAuthUserByUsername(username: string): Promise<AuthUserRecord | null> {
    const [user] = await this.client.db
      .select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    return user ? this.loadAuthUser(user) : null;
  }

  async createAuthSession(command: CreateAuthSessionCommand): Promise<AuthSessionRecord> {
    const [session] = await this.client.db.insert(sessions).values({
      id: command.id,
      userId: command.userId,
      tokenDigest: command.tokenDigest,
      createdAt: new Date(command.createdAt),
      expiresAt: new Date(command.expiresAt),
      lastSeenAt: new Date(command.createdAt),
      userAgent: command.userAgent,
      ipAddress: command.ipAddress,
    }).returning();
    return this.toAuthSession(session);
  }

  async findAuthSessionByTokenDigest(tokenDigest: string): Promise<AuthSessionWithUser | null> {
    const [session] = await this.client.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenDigest, tokenDigest))
      .limit(1);
    if (!session) {
      return null;
    }
    const [user] = await this.client.db
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1);
    if (!user) {
      return null;
    }
    return {
      session: this.toAuthSession(session),
      user: await this.loadAuthUser(user),
    };
  }

  async revokeAuthSession(id: string, revokedAt: string): Promise<boolean> {
    const rows = await this.client.db.update(sessions).set({
      revokedAt: new Date(revokedAt),
    }).where(and(
      eq(sessions.id, id),
      // Drizzle keeps this update idempotent at the application boundary.
      isNull(sessions.revokedAt),
    )).returning({ id: sessions.id });
    return rows.length > 0;
  }

  async getAudienceScope(userId: string): Promise<AudienceScope | "invalid" | null> {
    const [teacherScopeRows, studentScopeRows, referenceData] = await Promise.all([
      this.client.db.select({ teacherId: userTeacherScopes.teacherId })
        .from(userTeacherScopes)
        .where(eq(userTeacherScopes.userId, userId)),
      this.client.db.select({ studentGroupId: userStudentGroupScopes.studentGroupId })
        .from(userStudentGroupScopes)
        .where(eq(userStudentGroupScopes.userId, userId))
        .orderBy(asc(userStudentGroupScopes.studentGroupId)),
      this.getReferenceData(),
    ]);
    if (teacherScopeRows.length > 0 && studentScopeRows.length > 0) {
      return "invalid";
    }
    const teacherId = teacherScopeRows[0]?.teacherId;
    if (teacherId) {
      const teacher = referenceData.scheduleInput.teachers.find((item) => item.id === teacherId);
      return teacher ? { kind: "teacher", teacher } : "invalid";
    }
    if (studentScopeRows.length > 0) {
      const groups = studentScopeRows.map(({ studentGroupId }) => (
        referenceData.scheduleInput.student_groups.find((item) => item.id === studentGroupId)
      )).filter((group) => group !== undefined);
      return groups.length === studentScopeRows.length
        ? { kind: "student", studentGroups: groups }
        : "invalid";
    }
    return null;
  }

  async setTeacherAudienceScope(userId: string, teacherId: string): Promise<void> {
    await this.client.db.transaction(async (tx) => {
      await tx.delete(userStudentGroupScopes).where(eq(userStudentGroupScopes.userId, userId));
      await tx.insert(userTeacherScopes).values({ userId, teacherId }).onConflictDoUpdate({
        target: userTeacherScopes.userId,
        set: { teacherId },
      });
    });
  }

  async addStudentGroupAudienceScope(userId: string, studentGroupId: string): Promise<void> {
    await this.client.db.transaction(async (tx) => {
      await tx.delete(userTeacherScopes).where(eq(userTeacherScopes.userId, userId));
      await tx.insert(userStudentGroupScopes).values({ userId, studentGroupId }).onConflictDoNothing();
    });
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async checkReadiness(): Promise<void> {
    await this.client.pool.query("SELECT 1");
  }

  private async getActiveBatch(): Promise<BatchRow> {
    const [batch] = await this.client.db
      .select()
      .from(examBatches)
      .orderBy(desc(examBatches.createdAt))
      .limit(1);

    if (!batch) {
      throw new Error("No exam batch found. Run the database seed script first.");
    }

    return batch;
  }

  private async getLatestRunSummary(batchId: string): Promise<ScheduleRunSummary | null> {
    const [run] = await this.client.db
      .select()
      .from(scheduleRuns)
      .where(eq(scheduleRuns.batchId, batchId))
      .orderBy(desc(scheduleRuns.createdAt))
      .limit(1);

    return run ? this.toRunSummary(run) : null;
  }

  private async withScheduleDraftLock<T>(
    id: string,
    operation: (repository: PostgresPlatformRepository) => Promise<T>,
  ): Promise<T> {
    const connection = await this.client.pool.connect();
    const session = createDbSession(connection);
    const repository = new PostgresPlatformRepository({
      ...this.client,
      db: session.db,
    });
    let locked = false;
    try {
      await connection.query("SELECT pg_advisory_lock($1, hashtext($2))", [
        scheduleDraftLockNamespace,
        id,
      ]);
      locked = true;
      return await operation(repository);
    } finally {
      try {
        await session.drain();
        if (locked) {
          await connection.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
            scheduleDraftLockNamespace,
            id,
          ]);
        }
      } finally {
        connection.release();
      }
    }
  }

  private toBatchSummary(batch: BatchRow): ReferenceDataResponse["batch"] {
    return {
      id: batch.id,
      name: batch.name,
      status: batch.status,
      startDate: batch.startDate,
      endDate: batch.endDate,
    };
  }

  private toStudentGroup(group: StudentGroupRow): ReferenceDataResponse["scheduleInput"]["student_groups"][number] {
    return {
      id: group.id,
      name: group.name,
      size: group.size,
      department_id: group.departmentId,
    };
  }

  private toTeacher(teacher: TeacherRow): ReferenceDataResponse["scheduleInput"]["teachers"][number] {
    return {
      id: teacher.id,
      name: teacher.name,
      department_id: teacher.departmentId,
      unavailable_slot_ids: [],
    };
  }

  private toCourse(course: CourseRow): ReferenceDataResponse["scheduleInput"]["courses"][number] {
    return {
      id: course.id,
      name: course.name,
      department_id: course.departmentId,
      exam_type: course.type,
    };
  }

  private toRoom(room: RoomRow): ReferenceDataResponse["scheduleInput"]["rooms"][number] {
    return {
      id: room.id,
      name: room.name,
      building_id: room.buildingId,
      capacity: room.capacity,
      room_type: room.type,
      equipment_tags: room.equipmentTags,
    };
  }

  private toTimeSlot(slot: TimeSlotRow): ReferenceDataResponse["scheduleInput"]["time_slots"][number] {
    return {
      id: slot.id,
      date: slot.date,
      start_time: slot.startTime,
      end_time: slot.endTime,
      period_index: slot.periodIndex,
    };
  }

  private toExamTask(task: ExamTaskRow): ReferenceDataResponse["scheduleInput"]["exam_tasks"][number] {
    return {
      id: task.id,
      course_id: task.courseId,
      student_group_ids: [],
      expected_count: task.expectedCount,
      duration_minutes: task.durationMinutes,
      required_room_type: task.requiredRoomType,
      required_equipment_tags: task.requiredEquipmentTags,
      allowed_slot_ids: task.allowedSlotIds,
      invigilator_count: task.invigilatorCount,
    };
  }

  private toRunSummary(run: RunRow): ScheduleRunSummary {
    return {
      id: run.id,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      elapsedMs: run.elapsedMs,
      score: run.score,
      normalizedScore: run.normalizedScore,
      conflictCount: run.conflictCount,
      assignmentCount: run.assignmentCount,
      constraintProfileVersionId: run.constraintProfileVersionId,
      constraintProfileSnapshot: run.constraintProfileSnapshot.schemaVersion === 1
        ? run.constraintProfileSnapshot
        : null,
      schedulerVersion: run.schedulerVersion,
      scoringContractVersion: run.scoringContractVersion,
    };
  }

  private toAuditEvent(event: AuditEventRow): AuditEventSummary {
    return {
      id: event.id,
      actor: event.actor,
      actorUserId: event.actorUserId,
      actorRoles: event.actorRoles as UserRole[],
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      payload: event.payload as Record<string, unknown>,
      createdAt: event.createdAt.toISOString(),
    };
  }

  private async loadConstraintProfile(
    db: ExamForgeDatabase,
    id: string,
  ): Promise<ConstraintProfileRecord | null> {
    const [profile] = await db.select().from(constraintProfiles)
      .where(eq(constraintProfiles.id, id))
      .limit(1);
    if (!profile) {
      return null;
    }
    const versions = await db.select().from(constraintProfileVersions)
      .where(eq(constraintProfileVersions.profileId, id))
      .orderBy(asc(constraintProfileVersions.versionNumber));
    return this.toConstraintProfileRecord(profile, versions);
  }

  private toConstraintProfileRecord(
    profile: ConstraintProfileRow,
    versions: ConstraintProfileVersionRow[],
  ): ConstraintProfileRecord {
    if (versions.length === 0) {
      throw new Error(`Constraint profile ${profile.id} has no versions.`);
    }
    return {
      id: profile.id,
      name: profile.name,
      status: profile.status,
      ownerUserId: profile.ownerUserId,
      currentVersionId: profile.currentVersionId,
      isDefault: profile.isDefault,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      versions: versions.map((version) => ({
        id: version.id,
        profileId: version.profileId,
        versionNumber: version.versionNumber,
        schemaVersion: version.schemaVersion,
        digest: version.digest,
        config: version.config,
        createdByUserId: version.createdByUserId,
        createdAt: version.createdAt.toISOString(),
      })),
    };
  }

  private async insertConstraintProfileAudit(
    db: ExamForgeDatabase,
    context: ConstraintProfileMutationContext,
    event: {
      action: string;
      profileId: string;
      payload: Record<string, unknown>;
    },
  ) {
    await db.insert(auditEvents).values({
      id: `audit-${randomUUID()}`,
      actor: context.actor.username,
      actorUserId: context.actor.userId,
      actorRoles: context.actor.roles,
      action: event.action,
      entityType: "constraint_profile",
      entityId: event.profileId,
      payload: {
        ...event.payload,
        traceId: context.traceId,
        actorUserId: context.actor.userId,
      },
    });
  }

  private toDraftSummary(draft: DraftRow): ScheduleDraftSummary {
    return {
      id: draft.id,
      batchId: draft.batchId,
      sourceRunId: draft.sourceRunId,
      basePublishedRunId: draft.basePublishedRunId,
      status: draft.status,
      score: draft.score,
      conflictCount: draft.conflictCount,
      assignmentCount: draft.assignmentCount,
      createdBy: draft.createdBy,
      createdAt: draft.createdAt.toISOString(),
      updatedAt: draft.updatedAt.toISOString(),
    };
  }

  private toDraftChangeEvent(event: DraftChangeEventRow): ScheduleDraftChangeEvent {
    return {
      id: event.id,
      draftId: event.draftId,
      examTaskId: event.examTaskId,
      before: event.before as ScheduledExam,
      after: event.after as ScheduledExam,
      actor: event.actor,
      createdAt: event.createdAt.toISOString(),
    };
  }

  private async withDatabaseTransaction<T>(
    operation: (db: ExamForgeDatabase) => Promise<T>,
  ): Promise<T> {
    const connection = await this.client.pool.connect();
    const session = createDbSession(connection);
    try {
      await connection.query("BEGIN");
      const result = await operation(session.db);
      await session.drain();
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      await session.drain();
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }

  private async insertScheduleRun(
    db: ExamForgeDatabase,
    result: ScheduleResult,
    batchId: string,
    context: ScheduleRunPersistenceContext,
  ): Promise<ScheduleRunResponse> {
    const id = `run-${randomUUID()}`;
    const createdAt = new Date();
    const run: ScheduleRunSummary = {
      id,
      status: result.statistics.status,
      createdAt: createdAt.toISOString(),
      elapsedMs: result.statistics.elapsed_ms,
      score: result.score.total_score,
      normalizedScore: result.score.normalized_score,
      conflictCount: result.conflicts.length,
      assignmentCount: result.assignments.length,
      constraintProfileVersionId: context.constraintProfileVersionId,
      constraintProfileSnapshot: context.constraintProfileSnapshot,
      schedulerVersion: context.schedulerVersion,
      scoringContractVersion: result.score.scoring_contract_version,
    };
    await db.insert(scheduleRuns).values({
      id,
      batchId,
      status: result.statistics.status,
      score: result.score.total_score,
      scoreBreakdown: result.score,
      conflictCount: result.conflicts.length,
      assignmentCount: result.assignments.length,
      elapsedMs: result.statistics.elapsed_ms,
      statistics: result.statistics,
      report: result.report ?? {},
      constraintProfileVersionId: context.constraintProfileVersionId,
      constraintProfileSnapshot: context.constraintProfileSnapshot,
      schedulerVersion: context.schedulerVersion,
      scoringContractVersion: result.score.scoring_contract_version,
      normalizedScore: result.score.normalized_score,
      createdAt,
    });
    if (result.assignments.length > 0) {
      const scheduledExamRows = result.assignments.map((assignment, index) => ({
        id: `${id}-exam-${index + 1}`,
        runId: id,
        examTaskId: assignment.exam_task_id,
        roomId: assignment.room_id,
        timeSlotId: assignment.time_slot_id,
      }));
      await db.insert(scheduledExams).values(scheduledExamRows);
      const invigilatorRows = scheduledExamRows.flatMap((row, index) => (
        result.assignments[index].teacher_ids.map((teacherId, teacherIndex) => ({
          scheduledExamId: row.id,
          position: teacherIndex + 1,
          teacherId,
        }))
      ));
      if (invigilatorRows.length > 0) {
        await db.insert(scheduledExamInvigilators).values(invigilatorRows);
      }
    }
    if (result.conflicts.length > 0) {
      await db.insert(conflictRecords).values(
        result.conflicts.map((conflict, index) => ({
          id: `${id}-conflict-${index + 1}`,
          runId: id,
          type: conflict.type,
          severity: conflict.severity,
          affectedIds: conflict.affected_ids,
          message: conflict.message,
          suggestion: conflict.suggestion,
        })),
      );
    }
    await db.insert(auditEvents).values({
      id: `audit-${randomUUID()}`,
      ...this.auditActorValues("system"),
      action: "schedule_run.created",
      entityType: "schedule_run",
      entityId: id,
      payload: {
        batchId,
        status: result.statistics.status,
        score: result.score.total_score,
        assignmentCount: result.assignments.length,
        conflictCount: result.conflicts.length,
      },
    });
    return { run, result };
  }

  private async defaultScheduleRunPersistenceContext(
    db: ExamForgeDatabase,
  ): Promise<ScheduleRunPersistenceContext> {
    const strategy = await resolveDefaultConstraintProfile(db);
    return {
      constraintProfileVersionId: strategy.versionId,
      constraintProfileSnapshot: strategy.snapshot,
      schedulerVersion: "unknown",
    };
  }

  private async loadAuthUser(user: UserRow): Promise<AuthUserRecord> {
    const roleRows = await this.client.db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, user.id));
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      active: user.active,
      roles: roleRows.map((row) => row.roleId as UserRole).sort(),
      password: {
        hash: user.passwordHash,
        salt: user.passwordSalt,
        n: user.scryptN,
        r: user.scryptR,
        p: user.scryptP,
        keyLength: user.scryptKeyLength,
      },
    };
  }

  private toAuthSession(session: typeof sessions.$inferSelect): AuthSessionRecord {
    return {
      id: session.id,
      userId: session.userId,
      tokenDigest: session.tokenDigest,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      revokedAt: session.revokedAt?.toISOString() ?? null,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
    };
  }

  private findReferenceRecord(
    referenceData: ReferenceDataResponse,
    resource: ReferenceResource,
    id: string,
  ): ReferenceRecord | null {
    const collections = {
      "student-groups": referenceData.scheduleInput.student_groups,
      teachers: referenceData.scheduleInput.teachers,
      courses: referenceData.scheduleInput.courses,
      rooms: referenceData.scheduleInput.rooms,
      "time-slots": referenceData.scheduleInput.time_slots,
      "exam-tasks": referenceData.scheduleInput.exam_tasks,
    };
    return collections[resource].find((record) => record.id === id) ?? null;
  }

  async recordAuditEvent(
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
    actor = "system",
  ) {
    await this.client.db.insert(auditEvents).values({
      id: `audit-${randomUUID()}`,
      ...this.auditActorValues(actor),
      action,
      entityType,
      entityId,
      payload,
    });
  }

  private auditActorValues(fallbackActor: string) {
    const context = getCurrentAuthContext();
    return {
      actor: context?.user.username ?? fallbackActor,
      actorUserId: context?.user.id ?? null,
      actorRoles: context?.user.roles ?? [],
    };
  }

}

function groupRelationRows<T, K extends keyof T, V extends keyof T>(
  rows: T[],
  keyField: K,
  valueField: V,
  sortValues = true,
) {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const key = String(row[keyField]);
    const value = String(row[valueField]);
    const values = grouped.get(key) ?? [];
    values.push(value);
    grouped.set(key, values);
  }
  if (sortValues) {
    for (const values of grouped.values()) {
      values.sort();
    }
  }
  return grouped;
}

function omitReferenceId(record: ReferenceRecord): Partial<ReferenceRecord> {
  const { id: _id, ...rest } = record;
  return rest as Partial<ReferenceRecord>;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

function scoreDraft(conflictCount: number) {
  return Math.max(0, 100 - conflictCount * 20);
}
