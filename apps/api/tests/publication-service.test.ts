import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryPlatformRepository } from "../src/repository.js";
import { PublicationService } from "../src/services/publication-service.js";
import { buildCompleteScheduleResult } from "./test-fixtures.js";

describe("publication service", () => {
  it("records the authenticated actor and published run in CSV export audits", async () => {
    const { repository, service, runId } = await createPublicationFixture();

    const exported = await service.exportCsv("operator");

    assert.ok(exported);
    assert.match(exported.csv, /^course,time_slot,room,teachers/);
    const audit = await repository.listAuditEvents({
      actor: "operator",
      entityType: "schedule_run",
      entityId: runId,
      limit: 10,
    });
    const event = audit.events.find((item) => item.action === "published_schedule.exported");
    assert.ok(event);
    assert.equal(event.actor, "operator");
    assert.equal(event.entityType, "schedule_run");
    assert.equal(event.entityId, runId);
    assert.deepEqual(event.payload, {
      batchId: exported.published.batch.id,
      format: "csv",
    });
  });

  it("returns explicit audience outcomes and preserves rollback behavior", async () => {
    const { service } = await createPublicationFixture();

    const audience = await service.getAudience("teacher", "t-zhang");
    assert.equal(audience.status, "ok");
    if (audience.status === "ok") {
      assert.ok(audience.response.assignments.length > 0);
    }
    assert.deepEqual(
      await service.getAudience("teacher", "missing-teacher"),
      { status: "viewer_not_found" },
    );

    const rolledBack = await service.rollback();
    if (rolledBack === "publication_conflict") {
      assert.fail("in-memory rollback must not conflict");
    }
    assert.ok(rolledBack.previousRun);
    assert.equal((await service.getPublishedSchedule()), null);
    assert.deepEqual(
      await service.getAudience("teacher", "t-zhang"),
      { status: "not_published" },
    );
  });
});

async function createPublicationFixture() {
  const repository = new InMemoryPlatformRepository();
  const referenceData = await repository.getReferenceData();
  const run = await repository.createScheduleRun(
    buildCompleteScheduleResult(referenceData.scheduleInput),
  );
  const service = new PublicationService(repository);
  const published = await service.publishRun(run.run.id);
  assert.ok(published);
  return {
    repository,
    service,
    runId: run.run.id,
  };
}
