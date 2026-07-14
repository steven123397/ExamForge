import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateApiProductionEnvironment } from "../src/production-config.js";

const productionEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://examforge:strong-postgres-password@postgres:5432/examforge",
  REDIS_URL: "redis://redis:6379/0",
  SCHEDULER_TRANSPORT: "http",
  SCHEDULER_BASE_URL: "http://scheduler:8000",
  EXAMFORGE_TRUSTED_ORIGINS: "https://examforge.site",
  EXAMFORGE_SESSION_COOKIE_SECURE: "true",
  EXAMFORGE_SESSION_TTL_SECONDS: "43200",
  EXAMFORGE_ADMIN_PASSWORD: "strong-admin-password-20260714",
  EXAMFORGE_OPERATOR_PASSWORD: "strong-operator-password-20260714",
  EXAMFORGE_TEACHER_PASSWORD: "strong-teacher-password-20260714",
  EXAMFORGE_STUDENT_PASSWORD: "strong-student-password-20260714",
};

describe("API production configuration", () => {
  it("accepts a complete HTTPS and persistent configuration", () => {
    assert.doesNotThrow(() => validateApiProductionEnvironment(productionEnvironment));
  });

  it("does not impose production-only secrets on local development", () => {
    assert.doesNotThrow(() => validateApiProductionEnvironment({ NODE_ENV: "development" }));
    assert.doesNotThrow(() => validateApiProductionEnvironment({
      NODE_ENV: "production",
      EXAMFORGE_DEPLOYMENT_MODE: "demo",
    }));
  });

  it("requires persistent dependencies and the HTTP scheduler in production", () => {
    for (const variable of ["DATABASE_URL", "REDIS_URL", "SCHEDULER_BASE_URL"]) {
      assert.throws(
        () => validateApiProductionEnvironment({
          ...productionEnvironment,
          [variable]: "",
        }),
        new RegExp(`${variable} is required`),
      );
    }
    assert.throws(() => validateApiProductionEnvironment({
      ...productionEnvironment,
      SCHEDULER_TRANSPORT: "cli",
    }), /SCHEDULER_TRANSPORT must be http/);
  });

  it("rejects missing, short and example account passwords", () => {
    assert.throws(() => validateApiProductionEnvironment({
      ...productionEnvironment,
      EXAMFORGE_ADMIN_PASSWORD: "",
    }), /EXAMFORGE_ADMIN_PASSWORD is required/);
    assert.throws(() => validateApiProductionEnvironment({
      ...productionEnvironment,
      EXAMFORGE_OPERATOR_PASSWORD: "too-short",
    }), /at least 20 characters/);
    assert.throws(() => validateApiProductionEnvironment({
      ...productionEnvironment,
      EXAMFORGE_TEACHER_PASSWORD: "replace-with-real-password",
    }), /placeholder/);
  });
});
