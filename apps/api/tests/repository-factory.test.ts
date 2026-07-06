import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryPlatformRepository } from "../src/repository.js";

describe("repository factory", () => {
  it("falls back to the in-memory repository when no database URL is configured", async () => {
    const module = await import("../src/repository-factory.js").catch(() => null);

    assert.ok(module, "repository factory module should exist");
    const repository = module.createPlatformRepository({ databaseUrl: "" });

    assert.ok(repository instanceof InMemoryPlatformRepository);
  });
});
