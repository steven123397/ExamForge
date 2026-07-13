import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessRoute,
  clearPrivateSessionState,
  defaultRouteForRoles,
  safeReturnTo,
} from "../features/auth/routing.js";

describe("authentication routing models", () => {
  it("accepts only safe same-site return paths", () => {
    assert.equal(
      safeReturnTo("/scheduling/jobs?status=queued&page=2", "/admin/overview"),
      "/scheduling/jobs?status=queued&page=2",
    );
    for (const unsafe of [
      "https://attacker.example/scheduling/jobs",
      "//attacker.example/scheduling/jobs",
      "/\\attacker.example/scheduling/jobs",
      "scheduling/jobs",
      "/login",
      "\n/scheduling/jobs",
    ]) {
      assert.equal(safeReturnTo(unsafe, "/admin/overview"), "/admin/overview");
    }
  });

  it("maps every audience role to one stable default route", () => {
    assert.equal(defaultRouteForRoles(["admin"]), "/admin/overview");
    assert.equal(defaultRouteForRoles(["operator"]), "/scheduling/jobs");
    assert.equal(defaultRouteForRoles(["teacher"]), "/teacher/schedule");
    assert.equal(defaultRouteForRoles(["student"]), "/student/schedule");
    assert.equal(defaultRouteForRoles([]), "/login");
  });

  it("enforces the page-level role matrix without broad fallback access", () => {
    assert.equal(canAccessRoute(["admin"], "/admin/overview"), true);
    assert.equal(canAccessRoute(["operator"], "/admin/overview"), true);
    assert.equal(canAccessRoute(["operator"], "/admin/reference-data"), true);
    assert.equal(canAccessRoute(["operator"], "/scheduling/jobs"), true);
    assert.equal(canAccessRoute(["operator"], "/scheduling/drafts/draft-1"), true);
    assert.equal(canAccessRoute(["admin"], "/audit"), true);
    assert.equal(canAccessRoute(["operator"], "/audit"), false);
    assert.equal(canAccessRoute(["teacher"], "/teacher/schedule"), true);
    assert.equal(canAccessRoute(["teacher"], "/scheduling/jobs"), false);
    assert.equal(canAccessRoute(["student"], "/student/schedule"), true);
    assert.equal(canAccessRoute(["student"], "/teacher/schedule"), false);
    assert.equal(canAccessRoute(["admin"], "/unknown"), false);
  });

  it("clears private query data before publishing an anonymous session", () => {
    const actions: string[] = [];
    clearPrivateSessionState(
      () => actions.push("clear-query-cache"),
      () => actions.push("publish-anonymous"),
    );
    assert.deepEqual(actions, ["clear-query-cache", "publish-anonymous"]);
  });
});
