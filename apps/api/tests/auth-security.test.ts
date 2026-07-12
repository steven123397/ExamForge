import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "../src/auth/security.js";
import { getSessionCookieConfig } from "../src/auth/session-cookie.js";

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

  it("allows local HTTP deployments to explicitly disable secure cookies", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousSecure = process.env.EXAMFORGE_SESSION_COOKIE_SECURE;
    try {
      process.env.NODE_ENV = "production";
      delete process.env.EXAMFORGE_SESSION_COOKIE_SECURE;
      assert.equal(getSessionCookieConfig().secure, true);

      process.env.EXAMFORGE_SESSION_COOKIE_SECURE = "false";
      assert.equal(getSessionCookieConfig().secure, false);

      process.env.EXAMFORGE_SESSION_COOKIE_SECURE = "true";
      assert.equal(getSessionCookieConfig().secure, true);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousSecure === undefined) delete process.env.EXAMFORGE_SESSION_COOKIE_SECURE;
      else process.env.EXAMFORGE_SESSION_COOKIE_SECURE = previousSecure;
    }
  });
});
