import type {
  PublishedScheduleAudienceResponse,
} from "@examforge/shared";
import type { PlatformRepository } from "../repository.js";
import {
  buildPublishedScheduleAudience,
  buildPublishedScheduleCsv,
  buildPublicPublishedSchedule,
  buildPublicPublishedScheduleNotifications,
} from "./published-schedule-service.js";

export type PublishedAudienceResult =
  | { status: "not_published" }
  | { status: "viewer_not_found" }
  | { status: "ok"; response: PublishedScheduleAudienceResponse };

export class PublicationService {
  constructor(private readonly repository: PlatformRepository) {}

  publishRun(id: string) {
    return this.repository.publishScheduleRun(id);
  }

  getPublishedSchedule() {
    return this.repository.getPublishedSchedule();
  }

  async getPublicPublishedSchedule() {
    const [referenceData, published] = await Promise.all([
      this.repository.getReferenceData(),
      this.repository.getPublishedSchedule(),
    ]);
    return published
      ? buildPublicPublishedSchedule(referenceData, published)
      : null;
  }

  rollback() {
    return this.repository.rollbackPublishedSchedule();
  }

  async exportCsv(actor: string) {
    const [referenceData, published] = await Promise.all([
      this.repository.getReferenceData(),
      this.repository.getPublishedSchedule(),
    ]);
    if (!published) {
      return null;
    }
    await this.repository.recordAuditEvent?.(
      "published_schedule.exported",
      "schedule_run",
      published.run.id,
      {
        batchId: published.batch.id,
        format: "csv",
      },
      actor,
    );
    return {
      published,
      csv: buildPublishedScheduleCsv(referenceData, published),
    };
  }

  async getPublicNotifications() {
    const [referenceData, published] = await Promise.all([
      this.repository.getReferenceData(),
      this.repository.getPublishedSchedule(),
    ]);
    return published
      ? buildPublicPublishedScheduleNotifications(referenceData, published)
      : null;
  }

  async getAudience(
    viewerType: "teacher" | "student_group",
    viewerId: string,
  ): Promise<PublishedAudienceResult> {
    const [referenceData, published] = await Promise.all([
      this.repository.getReferenceData(),
      this.repository.getPublishedSchedule(),
    ]);
    if (!published) {
      return { status: "not_published" };
    }
    const response = buildPublishedScheduleAudience(
      referenceData,
      published,
      viewerType,
      viewerId,
    );
    return response
      ? { status: "ok", response }
      : { status: "viewer_not_found" };
  }
}
