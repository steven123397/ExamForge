import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseAccountRotationArguments,
  readRotationPassword,
} from "../src/auth/rotate-account.js";

describe("account rotation command", () => {
  it("requires a repeated target confirmation and keeps the password out of arguments", () => {
    assert.deepEqual(
      parseAccountRotationArguments([
        "--username", "operator",
        "--confirm-username", "operator",
        "--actor", "maintenance:ticket-20260723",
      ]),
      {
        username: "operator",
        confirmUsername: "operator",
        actor: "maintenance:ticket-20260723",
      },
    );
    assert.throws(
      () => parseAccountRotationArguments([
        "--username", "operator",
        "--confirm-username", "admin",
        "--actor", "maintenance:ticket-20260723",
      ]),
      /confirmation does not match/i,
    );
    assert.throws(
      () => parseAccountRotationArguments([
        "--username", "operator",
        "--confirm-username", "operator",
        "--actor", "maintenance:ticket-20260723",
        "--password", "must-not-be-accepted",
      ]),
      /unsupported argument/i,
    );
  });

  it("accepts one terminal newline from standard input without exposing the password", () => {
    assert.equal(readRotationPassword("rotated-operator-password-20260723\n"), "rotated-operator-password-20260723");
    assert.throws(() => readRotationPassword("\n"), /password is required/i);
  });
});
