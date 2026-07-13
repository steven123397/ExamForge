import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConstraintProfile, ConstraintProfileRecord } from "@examforge/shared";
import {
  ConstraintProfileConflictError,
  ConstraintProfileService,
  ConstraintProfileValidationError,
  type ConstraintProfileMutationContext,
  type ConstraintProfileRepository,
  type CreateConstraintProfilePersistenceCommand,
  type CreateConstraintProfileVersionPersistenceCommand,
  type SetConstraintProfileDefaultPersistenceCommand,
  type SetConstraintProfileStatusPersistenceCommand,
} from "../src/index.js";

const config: ConstraintProfile = {
  hard_rules: ["room_capacity", "teacher_time_unique"],
  soft_weights: {
    room_utilization: 3,
    teacher_workload_balance: 7,
  },
  time_limit_seconds: 10,
};

const context: ConstraintProfileMutationContext = {
  actor: {
    userId: "user-admin",
    username: "admin",
    roles: ["admin"],
  },
  traceId: "trace-profile-test",
};

describe("ConstraintProfileService", () => {
  it("creates a profile with a deterministic digest independent of object key order", async () => {
    const repository = new FakeConstraintProfileRepository();
    const service = new ConstraintProfileService(repository);

    const first = await service.create({ name: "Balanced", config }, context);
    const second = await service.create({
      name: "Balanced copy",
      config: {
        time_limit_seconds: 10,
        soft_weights: {
          teacher_workload_balance: 7,
          room_utilization: 3,
        },
        hard_rules: ["room_capacity", "teacher_time_unique"],
      },
    }, context);

    assert.equal(repository.createCommands[0]?.digest, repository.createCommands[1]?.digest);
    assert.match(repository.createCommands[0]?.digest ?? "", /^[a-f0-9]{64}$/);
    assert.equal(first.name, "Balanced");
    assert.equal(second.name, "Balanced copy");
    assert.equal(repository.createCommands[0]?.context, context);
  });

  it("rejects duplicate hard rules and weights outside the governed range", async () => {
    const service = new ConstraintProfileService(new FakeConstraintProfileRepository());

    await assert.rejects(
      service.create({
        name: "Invalid",
        config: {
          ...config,
          hard_rules: ["room_capacity", "room_capacity"],
          soft_weights: { room_utilization: 1001 },
        },
      }, context),
      (error: unknown) => error instanceof ConstraintProfileValidationError
        && error.issues.includes("hard_rules must not contain duplicates")
        && error.issues.includes("soft weight room_utilization must be between 0 and 1000"),
    );
  });

  it("maps repository concurrency and default-state resolutions to stable conflicts", async () => {
    const repository = new FakeConstraintProfileRepository();
    const service = new ConstraintProfileService(repository);
    repository.nextVersionResolution = "version_conflict";
    await assert.rejects(
      service.createVersion("profile-1", {
        expectedCurrentVersionId: "profile-1-v1",
        config,
      }, context),
      (error: unknown) => error instanceof ConstraintProfileConflictError
        && error.code === "constraint_profile_version_conflict",
    );

    repository.nextStatusResolution = "default_cannot_be_disabled";
    await assert.rejects(
      service.setStatus("profile-1", "disabled", context),
      (error: unknown) => error instanceof ConstraintProfileConflictError
        && error.code === "default_constraint_profile_cannot_be_disabled",
    );

    repository.nextDefaultResolution = "inactive";
    await assert.rejects(
      service.setDefault("profile-1", context),
      (error: unknown) => error instanceof ConstraintProfileConflictError
        && error.code === "disabled_constraint_profile_cannot_be_default",
    );
  });
});

class FakeConstraintProfileRepository implements ConstraintProfileRepository {
  readonly createCommands: CreateConstraintProfilePersistenceCommand[] = [];
  nextVersionResolution: "created" | "not_found" | "version_conflict" = "created";
  nextStatusResolution: "updated" | "not_found" | "default_cannot_be_disabled" = "updated";
  nextDefaultResolution: "updated" | "not_found" | "inactive" = "updated";

  async listConstraintProfiles(): Promise<ConstraintProfileRecord[]> {
    return [];
  }

  async getConstraintProfile(): Promise<ConstraintProfileRecord | null> {
    return null;
  }

  async createConstraintProfile(
    command: CreateConstraintProfilePersistenceCommand,
  ): Promise<ConstraintProfileRecord> {
    this.createCommands.push(command);
    return profileRecord(`profile-${this.createCommands.length}`, command.name, command.config);
  }

  async createConstraintProfileVersion(
    command: CreateConstraintProfileVersionPersistenceCommand,
  ) {
    return this.nextVersionResolution === "created"
      ? { resolution: "created" as const, profile: profileRecord(command.profileId, "Profile", command.config) }
      : { resolution: this.nextVersionResolution };
  }

  async setConstraintProfileStatus(
    _command: SetConstraintProfileStatusPersistenceCommand,
  ) {
    return this.nextStatusResolution === "updated"
      ? { resolution: "updated" as const, profile: profileRecord("profile-1", "Profile", config) }
      : { resolution: this.nextStatusResolution };
  }

  async setDefaultConstraintProfile(
    _command: SetConstraintProfileDefaultPersistenceCommand,
  ) {
    return this.nextDefaultResolution === "updated"
      ? { resolution: "updated" as const, profile: profileRecord("profile-1", "Profile", config) }
      : { resolution: this.nextDefaultResolution };
  }
}

function profileRecord(id: string, name: string, profileConfig: ConstraintProfile): ConstraintProfileRecord {
  const versionId = `${id}-v1`;
  return {
    id,
    name,
    status: "active",
    ownerUserId: "user-admin",
    currentVersionId: versionId,
    isDefault: false,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    versions: [{
      id: versionId,
      profileId: id,
      versionNumber: 1,
      schemaVersion: 1,
      digest: "a".repeat(64),
      config: profileConfig,
      createdByUserId: "user-admin",
      createdAt: "2026-07-13T00:00:00.000Z",
    }],
  };
}
