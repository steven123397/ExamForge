import type {
  ConstraintProfile,
  ConstraintProfileRecord,
  ConstraintProfileSnapshot,
  ConstraintProfileStatus,
  UserRole,
} from "@examforge/shared";
import { constraintProfileSchema } from "@examforge/shared";
import { createHash } from "node:crypto";

export interface ConstraintProfileMutationContext {
  actor: {
    userId: string;
    username: string;
    roles: UserRole[];
  };
  traceId: string;
}

export interface CreateConstraintProfilePersistenceCommand {
  name: string;
  config: ConstraintProfile;
  digest: string;
  context: ConstraintProfileMutationContext;
}

export interface CreateConstraintProfileVersionPersistenceCommand {
  profileId: string;
  expectedCurrentVersionId: string;
  config: ConstraintProfile;
  digest: string;
  context: ConstraintProfileMutationContext;
}

export interface SetConstraintProfileStatusPersistenceCommand {
  profileId: string;
  status: ConstraintProfileStatus;
  context: ConstraintProfileMutationContext;
}

export interface SetConstraintProfileDefaultPersistenceCommand {
  profileId: string;
  context: ConstraintProfileMutationContext;
}

export interface ResolvedConstraintProfile {
  versionId: string;
  snapshot: ConstraintProfileSnapshot;
}

type CreateVersionPersistenceResult =
  | { resolution: "created"; profile: ConstraintProfileRecord }
  | { resolution: "not_found" }
  | { resolution: "version_conflict" };

type SetStatusPersistenceResult =
  | { resolution: "updated"; profile: ConstraintProfileRecord }
  | { resolution: "not_found" }
  | { resolution: "default_cannot_be_disabled" };

type SetDefaultPersistenceResult =
  | { resolution: "updated"; profile: ConstraintProfileRecord }
  | { resolution: "not_found" }
  | { resolution: "inactive" };

export interface ConstraintProfileRepository {
  resolveConstraintProfile(versionId?: string): Promise<ResolvedConstraintProfile>;
  listConstraintProfiles(includeDisabled: boolean): Promise<ConstraintProfileRecord[]>;
  getConstraintProfile(id: string): Promise<ConstraintProfileRecord | null>;
  createConstraintProfile(
    command: CreateConstraintProfilePersistenceCommand,
  ): Promise<ConstraintProfileRecord>;
  createConstraintProfileVersion(
    command: CreateConstraintProfileVersionPersistenceCommand,
  ): Promise<CreateVersionPersistenceResult>;
  setConstraintProfileStatus(
    command: SetConstraintProfileStatusPersistenceCommand,
  ): Promise<SetStatusPersistenceResult>;
  setDefaultConstraintProfile(
    command: SetConstraintProfileDefaultPersistenceCommand,
  ): Promise<SetDefaultPersistenceResult>;
}

export class ConstraintProfileValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join("; "));
    this.name = "ConstraintProfileValidationError";
  }
}

export class ConstraintProfileNotFoundError extends Error {
  readonly code = "constraint_profile_not_found";

  constructor(readonly profileId: string) {
    super(`Constraint profile ${profileId} does not exist.`);
    this.name = "ConstraintProfileNotFoundError";
  }
}

export class ConstraintProfileConflictError extends Error {
  constructor(
    readonly code:
      | "constraint_profile_version_conflict"
      | "default_constraint_profile_cannot_be_disabled"
      | "disabled_constraint_profile_cannot_be_default",
  ) {
    super(code);
    this.name = "ConstraintProfileConflictError";
  }
}

export class ConstraintProfileSelectionError extends Error {
  constructor(
    readonly code: "constraint_profile_version_not_found" | "constraint_profile_disabled",
  ) {
    super(code);
    this.name = "ConstraintProfileSelectionError";
  }
}

export class ConstraintProfileService {
  constructor(private readonly repository: ConstraintProfileRepository) {}

  list(includeDisabled = false) {
    return this.repository.listConstraintProfiles(includeDisabled);
  }

  async get(id: string) {
    const profile = await this.repository.getConstraintProfile(id);
    if (!profile) {
      throw new ConstraintProfileNotFoundError(id);
    }
    return profile;
  }

  async create(
    input: { name: string; config: ConstraintProfile },
    context: ConstraintProfileMutationContext,
  ) {
    const name = validateName(input.name);
    const config = validateConfig(input.config);
    return this.repository.createConstraintProfile({
      name,
      config,
      digest: digestConstraintProfile(config),
      context,
    });
  }

  async createVersion(
    profileId: string,
    input: { expectedCurrentVersionId: string; config: ConstraintProfile },
    context: ConstraintProfileMutationContext,
  ) {
    const config = validateConfig(input.config);
    const result = await this.repository.createConstraintProfileVersion({
      profileId,
      expectedCurrentVersionId: input.expectedCurrentVersionId,
      config,
      digest: digestConstraintProfile(config),
      context,
    });
    if (result.resolution === "not_found") {
      throw new ConstraintProfileNotFoundError(profileId);
    }
    if (result.resolution === "version_conflict") {
      throw new ConstraintProfileConflictError("constraint_profile_version_conflict");
    }
    return result.profile;
  }

  async setStatus(
    profileId: string,
    status: ConstraintProfileStatus,
    context: ConstraintProfileMutationContext,
  ) {
    const result = await this.repository.setConstraintProfileStatus({
      profileId,
      status,
      context,
    });
    if (result.resolution === "not_found") {
      throw new ConstraintProfileNotFoundError(profileId);
    }
    if (result.resolution === "default_cannot_be_disabled") {
      throw new ConstraintProfileConflictError("default_constraint_profile_cannot_be_disabled");
    }
    return result.profile;
  }

  async setDefault(profileId: string, context: ConstraintProfileMutationContext) {
    const result = await this.repository.setDefaultConstraintProfile({ profileId, context });
    if (result.resolution === "not_found") {
      throw new ConstraintProfileNotFoundError(profileId);
    }
    if (result.resolution === "inactive") {
      throw new ConstraintProfileConflictError("disabled_constraint_profile_cannot_be_default");
    }
    return result.profile;
  }
}

export function digestConstraintProfile(config: ConstraintProfile): string {
  return createHash("sha256").update(canonicalJson(config)).digest("hex");
}

function validateName(value: string) {
  const name = value.trim();
  if (name.length < 1 || name.length > 100) {
    throw new ConstraintProfileValidationError([
      "name must contain between 1 and 100 characters",
    ]);
  }
  return name;
}

function validateConfig(value: ConstraintProfile): ConstraintProfile {
  const parsed = constraintProfileSchema.safeParse(value);
  if (!parsed.success) {
    throw new ConstraintProfileValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const issues: string[] = [];
  if (new Set(parsed.data.hard_rules).size !== parsed.data.hard_rules.length) {
    issues.push("hard_rules must not contain duplicates");
  }
  for (const [rule, weight] of Object.entries(parsed.data.soft_weights)) {
    if (weight > 1000) {
      issues.push(`soft weight ${rule} must be between 0 and 1000`);
    }
  }
  if (issues.length > 0) {
    throw new ConstraintProfileValidationError(issues);
  }
  return structuredClone(parsed.data);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
