import type {
  AudienceScope,
  AudienceScopeErrorCode,
  AuthContext,
  CurrentTeacherAvailabilityResponse,
  CurrentPublishedScheduleResponse,
  PublishedScheduleAssignmentView,
  Teacher,
} from "@examforge/shared";
import type { PlatformRepository } from "../repository.js";
import { PublicationService } from "./publication-service.js";

export class AudienceScopeError extends Error {
  constructor(readonly code: AudienceScopeErrorCode) {
    super(code === "audience_scope_missing"
      ? "The current user has no audience scope."
      : "The current user audience scope is invalid.");
    this.name = "AudienceScopeError";
  }
}

export class AudienceScopeService {
  private readonly publicationService: PublicationService;

  constructor(private readonly repository: PlatformRepository) {
    this.publicationService = new PublicationService(repository);
  }

  async getAudience(context: AuthContext): Promise<AudienceScope> {
    const isTeacher = context.user.roles.includes("teacher");
    const isStudent = context.user.roles.includes("student");
    if (!isTeacher && !isStudent) {
      throw new AudienceScopeError("audience_scope_missing");
    }
    if (isTeacher && isStudent) {
      throw new AudienceScopeError("audience_scope_invalid");
    }
    const scope = await this.repository.getAudienceScope(context.user.id);
    if (!scope) {
      throw new AudienceScopeError("audience_scope_missing");
    }
    if (scope === "invalid"
      || (isTeacher && scope.kind !== "teacher")
      || (isStudent && scope.kind !== "student")) {
      throw new AudienceScopeError("audience_scope_invalid");
    }
    return scope;
  }

  async getCurrentPublishedSchedule(
    context: AuthContext,
  ): Promise<CurrentPublishedScheduleResponse | null> {
    const audience = await this.getAudience(context);
    if (audience.kind === "teacher") {
      const result = await this.publicationService.getAudience("teacher", audience.teacher.id);
      if (result.status === "not_published") {
        return null;
      }
      if (result.status === "viewer_not_found") {
        throw new AudienceScopeError("audience_scope_invalid");
      }
      return {
        kind: "teacher",
        audience,
        batch: result.response.batch,
        run: result.response.run,
        assignments: result.response.assignments,
      };
    }

    const views = await Promise.all(audience.studentGroups.map((group) => (
      this.publicationService.getAudience("student_group", group.id)
    )));
    if (views.some((view) => view.status === "not_published")) {
      return null;
    }
    if (views.some((view) => view.status === "viewer_not_found")) {
      throw new AudienceScopeError("audience_scope_invalid");
    }
    const publishedViews = views.filter((view) => view.status === "ok");
    const first = publishedViews[0];
    if (!first) {
      throw new AudienceScopeError("audience_scope_missing");
    }
    const assignments = new Map<string, PublishedScheduleAssignmentView>();
    for (const view of publishedViews) {
      for (const assignment of view.response.assignments) {
        assignments.set(assignment.assignment.exam_task_id, assignment);
      }
    }
    return {
      kind: "student",
      audience,
      batch: first.response.batch,
      run: first.response.run,
      assignments: [...assignments.values()].sort(compareAssignmentViews),
    };
  }

  async updateCurrentTeacherUnavailableSlots(
    context: AuthContext,
    unavailableSlotIds: string[],
  ): Promise<Teacher> {
    const audience = await this.getAudience(context);
    if (audience.kind !== "teacher") {
      throw new AudienceScopeError("audience_scope_invalid");
    }
    const updated = await this.repository.updateReferenceRecord("teachers", audience.teacher.id, {
      unavailable_slot_ids: unavailableSlotIds,
    });
    if (!updated || !("unavailable_slot_ids" in updated)) {
      throw new AudienceScopeError("audience_scope_invalid");
    }
    await this.repository.recordAuditEvent?.(
      "teacher.unavailable_slots_updated",
      "teacher",
      audience.teacher.id,
      { unavailableSlotIds },
      context.user.username,
    );
    return updated;
  }

  async getCurrentTeacherAvailability(
    context: AuthContext,
  ): Promise<CurrentTeacherAvailabilityResponse> {
    const audience = await this.getAudience(context);
    if (audience.kind !== "teacher") {
      throw new AudienceScopeError("audience_scope_invalid");
    }
    const referenceData = await this.repository.getReferenceData();
    return {
      teacher: audience.teacher,
      timeSlots: referenceData.scheduleInput.time_slots,
    };
  }
}

function compareAssignmentViews(
  left: PublishedScheduleAssignmentView,
  right: PublishedScheduleAssignmentView,
) {
  return (left.timeSlot?.date ?? "").localeCompare(right.timeSlot?.date ?? "")
    || (left.timeSlot?.start_time ?? "").localeCompare(right.timeSlot?.start_time ?? "")
    || left.assignment.exam_task_id.localeCompare(right.assignment.exam_task_id);
}
