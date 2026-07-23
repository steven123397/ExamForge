import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionToken,
  hashLoginAttemptKey,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "../src/auth/security.js";
import { getSessionCookieConfig } from "../src/auth/session-cookie.js";
import { getTrustedOrigins } from "../src/auth/trusted-origins.js";

describe("authentication security", () => {
  it("hashes passwords with random salts and verifies them", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    assert.notEqual(first.salt, second.salt);
    assert.notEqual(first.hash, second.hash);
    assert.equal(await verifyPassword("correct horse battery staple", first), true);
    assert.equal(await verifyPassword("wrong password", first), false);
  });

  it("creates high-entropy session tokens and stores only stable digests", () => {
    const first = createSessionToken();
    const second = createSessionToken();

    assert.notEqual(first, second);
    assert.ok(first.length >= 40);
    assert.match(hashSessionToken(first), /^[a-f0-9]{64}$/);
    assert.equal(hashSessionToken(first), hashSessionToken(first));
  });

  it("derives login failure keys from normalized usernames and sources without retaining either value", () => {
    const normalized = hashLoginAttemptKey("2001:DB8::17", "  ＯＰＥＲＡＴＯＲ  ");

    assert.equal(normalized, hashLoginAttemptKey("2001:db8::17", "operator"));
    assert.notEqual(normalized, hashLoginAttemptKey("2001:db8::18", "operator"));
    assert.match(normalized, /^[a-f0-9]{64}$/);
  });

  it("allows local HTTP cookies but refuses an insecure production override", () => {
    assert.equal(getSessionCookieConfig({
      NODE_ENV: "development",
      EXAMFORGE_SESSION_COOKIE_SECURE: "false",
    }).secure, false);
    assert.equal(getSessionCookieConfig({ NODE_ENV: "production" }).secure, true);
    assert.equal(getSessionCookieConfig({
      NODE_ENV: "production",
      EXAMFORGE_DEPLOYMENT_MODE: "demo",
      EXAMFORGE_SESSION_COOKIE_SECURE: "false",
    }).secure, false);
    assert.throws(() => getSessionCookieConfig({
      NODE_ENV: "production",
      EXAMFORGE_SESSION_COOKIE_SECURE: "false",
    }), /Secure cookies cannot be disabled in production/);
  });

  it("rejects malformed cookie flags, names and TTL values", () => {
    assert.throws(() => getSessionCookieConfig({
      EXAMFORGE_SESSION_COOKIE_SECURE: "yes",
    }), /must be true or false/);
    assert.throws(() => getSessionCookieConfig({
      EXAMFORGE_SESSION_COOKIE_NAME: "invalid cookie name",
    }), /cookie name/);
    assert.throws(() => getSessionCookieConfig({
      EXAMFORGE_SESSION_TTL_SECONDS: "0",
    }), /TTL/);
    assert.throws(() => getSessionCookieConfig({
      EXAMFORGE_SESSION_TTL_SECONDS: "not-a-number",
    }), /TTL/);
  });

  it("requires exact HTTPS origins in production", () => {
    assert.deepEqual(
      [...getTrustedOrigins({
        NODE_ENV: "production",
        EXAMFORGE_TRUSTED_ORIGINS: "https://examforge.site,https://www.examforge.site",
      })],
      ["https://examforge.site", "https://www.examforge.site"],
    );
    assert.throws(
      () => getTrustedOrigins({ NODE_ENV: "production" }),
      /required in production/,
    );
    assert.throws(() => getTrustedOrigins({
      NODE_ENV: "production",
      EXAMFORGE_TRUSTED_ORIGINS: "*",
    }), /valid origin/);
    assert.throws(() => getTrustedOrigins({
      NODE_ENV: "production",
      EXAMFORGE_TRUSTED_ORIGINS: "http://examforge.site",
    }), /HTTPS/);
    assert.throws(() => getTrustedOrigins({
      NODE_ENV: "production",
      EXAMFORGE_TRUSTED_ORIGINS: "https://examforge.site/path",
    }), /exact origin/);
    assert.deepEqual([...getTrustedOrigins({
      NODE_ENV: "production",
      EXAMFORGE_DEPLOYMENT_MODE: "demo",
      EXAMFORGE_TRUSTED_ORIGINS: "http://localhost:3000",
    })], ["http://localhost:3000"]);
  });
});
