import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryPlatformRepository } from "../src/repository.js";
import { DraftService } from "../src/services/draft-service.js";
import { buildCompleteScheduleResult } from "./test-fixtures.js";

describe("draft service", () => {
  it("rejects updates to drafts that are no longer editable", async () => {
    const { repository, service, draftId } = await createDraftFixture();
    const published = await service.publish(draftId);
    assert.notEqual(published, null);
    assert.notEqual(published, "conflict");
    assert.notEqual(published, "not_publishable");
    let repositoryUpdateCalls = 0;
    const updateAssignment = repository.updateScheduleDraftAssignment.bind(repository);
    repository.updateScheduleDraftAssignment = (...args) => {
      repositoryUpdateCalls += 1;
      return updateAssignment(...args);
    };

    const updated = await service.updateAssignment(draftId, "e-data-structures", {
      room_id: "r-101",
    });

    assert.equal(updated, "not_editable");
    assert.equal(repositoryUpdateCalls, 0);
  });

  it("rejects updates to locked assignments", async () => {
    const { repository, service, draftId } = await createDraftFixture();
    const locked = await service.lockAssignment(draftId, "e-data-structures");
    assert.ok(locked);
    let repositoryUpdateCalls = 0;
    const updateAssignment = repository.updateScheduleDraftAssignment.bind(repository);
    repository.updateScheduleDraftAssignment = (...args) => {
      repositoryUpdateCalls += 1;
      return updateAssignment(...args);
    };

    const updated = await service.updateAssignment(draftId, "e-data-structures", {
      room_id: "r-101",
    });

    assert.equal(updated, "assignment_locked");
    assert.equal(repositoryUpdateCalls, 0);
  });

  it("blocks publishing drafts that contain hard conflicts", async () => {
    const { repository, service, draftId } = await createDraftFixture();
    const updated = await service.updateAssignment(draftId, "e-database", {
      room_id: "r-101",
      time_slot_id: "s-001",
      teacher_ids: ["t-zhang"],
    });
    assert.ok(updated && updated !== "not_editable" && updated !== "assignment_locked");
    assert.ok(updated.conflicts.some((conflict) => conflict.severity === "error"));
    assert.equal(await service.publish(draftId), "conflict");
  });

  it("preserves publish and discard state transitions", async () => {
    const first = await createDraftFixture();
    const published = await first.service.publish(first.draftId);
    assert.ok(
      published
      && published !== "conflict"
      && published !== "publication_conflict"
      && published !== "not_publishable",
    );
    assert.equal(published.draft.status, "published");

    const second = await createDraftFixture();
    const discarded = await second.service.discard(second.draftId);
    assert.ok(discarded && discarded !== "not_discardable");
    assert.equal(discarded.draft.status, "discarded");
  });

  it("does not validate, lock, or unlock terminal drafts", async () => {
    const { service, draftId } = await createDraftFixture();
    const published = await service.publish(draftId);
    assert.ok(
      published
      && published !== "conflict"
      && published !== "publication_conflict"
      && published !== "not_publishable",
    );

    assert.equal(await service.validate(draftId), "not_editable");
    assert.equal(
      await service.lockAssignment(draftId, "e-data-structures"),
      "not_editable",
    );
    assert.equal(
      await service.unlockAssignment(draftId, "e-data-structures"),
      "not_editable",
    );
    assert.equal(await service.publish(draftId), "not_publishable");
  });
});

async function createDraftFixture() {
  const repository = new InMemoryPlatformRepository();
  const referenceData = await repository.getReferenceData();
  const run = await repository.createScheduleRun(
    buildCompleteScheduleResult(referenceData.scheduleInput),
  );
  const service = new DraftService(repository);
  const draft = await service.createFromRun(run.run.id);
  assert.ok(draft);
  return {
    repository,
    service,
    draftId: draft.draft.id,
  };
}
