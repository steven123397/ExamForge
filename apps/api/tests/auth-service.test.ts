import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountRotationService } from "../src/auth/account-rotation-service.js";
import { AuthService } from "../src/auth/auth-service.js";
import { hashLoginAttemptKey } from "../src/auth/security.js";
import { InMemoryPlatformRepository } from "../src/repository.js";
import { buildTestAuthUsers } from "./test-fixtures.js";

describe("AuthService login failure protection", () => {
  it("expires a temporary lock and clears prior failures only after a successful login", async () => {
    const repository = new InMemoryPlatformRepository({
      authUsers: await buildTestAuthUsers(),
    });
    let currentTime = new Date("2026-07-23T00:00:00.000Z");
    const service = new AuthService(
      repository,
      12 * 60 * 60 * 1000,
      () => currentTime,
      {
        maxFailures: 2,
        failureWindowMs: 60_000,
        lockDurationMs: 60_000,
      },
    );
    const metadata = {
      userAgent: null,
      ipAddress: "203.0.113.22",
    };

    assert.deepEqual(
      await service.login("operator", "wrong-password", metadata),
      { status: "invalid_credentials" },
    );
    assert.deepEqual(
      await service.login("operator", "wrong-password", metadata),
      { status: "temporarily_locked", retryAfterSeconds: 60 },
    );
    assert.deepEqual(
      await service.login("operator", "operator-password", metadata),
      { status: "temporarily_locked", retryAfterSeconds: 60 },
    );

    const audits = await repository.listAuditEvents({
      action: "auth.login_temporarily_locked",
      limit: 10,
    });
    assert.equal(audits.total, 1);
    assert.equal(audits.events[0]?.entityId, hashLoginAttemptKey(metadata.ipAddress, "operator"));
    assert.deepEqual(audits.events[0]?.payload, {
      failureCount: 2,
      retryAfterSeconds: 60,
    });
    assert.equal(JSON.stringify(audits.events[0]).includes("wrong-password"), false);
    assert.equal(JSON.stringify(audits.events[0]).includes(metadata.ipAddress), false);

    currentTime = new Date(currentTime.getTime() + 60_000);
    const recovered = await service.login("operator", "operator-password", metadata);
    assert.equal(recovered.status, "authenticated");
    assert.deepEqual(
      await service.login("operator", "wrong-password", metadata),
      { status: "invalid_credentials" },
    );
  });
});

describe("AccountRotationService", () => {
  it("rotates a password, invalidates every existing session, and records a desensitized audit", async () => {
    const repository = new InMemoryPlatformRepository({
      authUsers: await buildTestAuthUsers(),
    });
    const authService = new AuthService(repository);
    const metadata = {
      userAgent: "ExamForge rotation test",
      ipAddress: "203.0.113.38",
    };
    const first = await authService.login("operator", "operator-password", metadata);
    const second = await authService.login("operator", "operator-password", metadata);
    assert.equal(first.status, "authenticated");
    assert.equal(second.status, "authenticated");

    const newPassword = "rotated-operator-password-20260723";
    const rotation = new AccountRotationService(
      repository,
      () => new Date("2026-07-23T08:00:00.000Z"),
    );
    assert.deepEqual(
      await rotation.rotate({
        username: "operator",
        password: newPassword,
        actor: "maintenance:ticket-20260723",
      }),
      { status: "rotated", revokedSessionCount: 2, credentialVersion: 2 },
    );

    assert.equal(await authService.authenticate(first.token), null);
    assert.equal(await authService.authenticate(second.token), null);
    assert.deepEqual(
      await authService.login("operator", "operator-password", metadata),
      { status: "invalid_credentials" },
    );
    assert.equal(
      (await authService.login("operator", newPassword, metadata)).status,
      "authenticated",
    );

    const audits = await repository.listAuditEvents({
      action: "auth.password_rotated",
      entityId: "user-operator",
      limit: 10,
    });
    assert.equal(audits.total, 1);
    assert.equal(audits.events[0]?.actor, "maintenance:ticket-20260723");
    assert.deepEqual(audits.events[0]?.payload, {
      credentialVersion: 2,
      revokedSessionCount: 2,
    });
    assert.equal(JSON.stringify(audits.events[0]).includes("operator-password"), false);
    assert.equal(JSON.stringify(audits.events[0]).includes(newPassword), false);
  });
});
