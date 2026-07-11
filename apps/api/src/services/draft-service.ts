import type { ScheduledExam } from "@examforge/shared";
import type { PlatformRepository } from "../repository.js";

export class DraftService {
  constructor(private readonly repository: PlatformRepository) {}

  createFromRun(runId: string) {
    return this.repository.createScheduleDraftFromRun(runId);
  }

  list() {
    return this.repository.listScheduleDrafts();
  }

  get(id: string) {
    return this.repository.getScheduleDraft(id);
  }

  async updateAssignment(id: string, examTaskId: string, patch: Partial<ScheduledExam>) {
    const current = await this.repository.getScheduleDraft(id);
    if (!current) {
      return null;
    }
    if (isTerminal(current.draft.status)) {
      return "not_editable" as const;
    }
    if ((current.lockedExamTaskIds ?? []).includes(examTaskId)) {
      return "assignment_locked" as const;
    }
    return this.repository.updateScheduleDraftAssignment(id, examTaskId, patch);
  }

  async validate(id: string) {
    const current = await this.repository.getScheduleDraft(id);
    if (!current) {
      return null;
    }
    if (isTerminal(current.draft.status)) {
      return "not_editable" as const;
    }
    return this.repository.validateScheduleDraft(id);
  }

  compare(id: string) {
    return this.repository.compareScheduleDraft(id);
  }

  suggestAssignment(id: string, examTaskId: string) {
    return this.repository.suggestScheduleDraftAssignment(id, examTaskId);
  }

  async lockAssignment(id: string, examTaskId: string) {
    const current = await this.repository.getScheduleDraft(id);
    if (!current) {
      return null;
    }
    if (isTerminal(current.draft.status)) {
      return "not_editable" as const;
    }
    return this.repository.lockScheduleDraftAssignment(id, examTaskId);
  }

  async unlockAssignment(id: string, examTaskId: string) {
    const current = await this.repository.getScheduleDraft(id);
    if (!current) {
      return null;
    }
    if (isTerminal(current.draft.status)) {
      return "not_editable" as const;
    }
    return this.repository.unlockScheduleDraftAssignment(id, examTaskId);
  }

  async rebalance(id: string) {
    const current = await this.repository.getScheduleDraft(id);
    if (!current) {
      return null;
    }
    if (isTerminal(current.draft.status)) {
      return "not_editable" as const;
    }
    return this.repository.rebalanceScheduleDraft(id);
  }

  async publish(id: string) {
    const current = await this.repository.getScheduleDraft(id);
    if (!current) {
      return null;
    }
    if (isTerminal(current.draft.status)) {
      return "not_publishable" as const;
    }
    return this.repository.publishScheduleDraft(id);
  }

  async discard(id: string) {
    const current = await this.repository.getScheduleDraft(id);
    if (!current) {
      return null;
    }
    if (isTerminal(current.draft.status)) {
      return "not_discardable" as const;
    }
    return this.repository.discardScheduleDraft(id);
  }
}

function isTerminal(status: string) {
  return status === "published" || status === "discarded";
}
