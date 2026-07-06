import { createDbClient } from "@examforge/db";
import { InMemoryPlatformRepository, type PlatformRepository } from "./repository.js";
import { PostgresPlatformRepository } from "./postgres-repository.js";

export interface RepositoryFactoryOptions {
  databaseUrl?: string | null;
}

export function createPlatformRepository(
  options: RepositoryFactoryOptions = {},
): PlatformRepository {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? "";

  if (!databaseUrl.trim()) {
    return new InMemoryPlatformRepository();
  }

  return new PostgresPlatformRepository(createDbClient(databaseUrl));
}
