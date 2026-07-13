import {
  ConstraintProfileSelectionError,
  type ResolvedConstraintProfile,
} from "@examforge/scheduling-application";
import { and, eq } from "drizzle-orm";
import type { ExamForgeDatabase } from "./client.js";
import { constraintProfiles, constraintProfileVersions } from "./schema.js";

export async function resolveDefaultConstraintProfile(
  db: ExamForgeDatabase,
): Promise<ResolvedConstraintProfile> {
  const [strategy] = await db
    .select({
      profileId: constraintProfiles.id,
      versionId: constraintProfileVersions.id,
      versionNumber: constraintProfileVersions.versionNumber,
      schemaVersion: constraintProfileVersions.schemaVersion,
      digest: constraintProfileVersions.digest,
      config: constraintProfileVersions.config,
    })
    .from(constraintProfiles)
    .innerJoin(
      constraintProfileVersions,
      and(
        eq(constraintProfileVersions.id, constraintProfiles.currentVersionId),
        eq(constraintProfileVersions.profileId, constraintProfiles.id),
      ),
    )
    .where(and(
      eq(constraintProfiles.isDefault, true),
      eq(constraintProfiles.status, "active"),
    ))
    .limit(1);
  if (!strategy) {
    throw new Error("No active default constraint profile version is configured.");
  }
  return {
    versionId: strategy.versionId,
    snapshot: {
      schemaVersion: strategy.schemaVersion,
      profileId: strategy.profileId,
      profileVersionId: strategy.versionId,
      versionNumber: strategy.versionNumber,
      digest: strategy.digest,
      config: strategy.config,
    },
  };
}

export async function resolveConstraintProfile(
  db: ExamForgeDatabase,
  versionId?: string,
): Promise<ResolvedConstraintProfile> {
  if (!versionId) {
    return resolveDefaultConstraintProfile(db);
  }
  const [strategy] = await db
    .select({
      profileId: constraintProfiles.id,
      profileStatus: constraintProfiles.status,
      versionId: constraintProfileVersions.id,
      versionNumber: constraintProfileVersions.versionNumber,
      schemaVersion: constraintProfileVersions.schemaVersion,
      digest: constraintProfileVersions.digest,
      config: constraintProfileVersions.config,
    })
    .from(constraintProfileVersions)
    .innerJoin(
      constraintProfiles,
      eq(constraintProfiles.id, constraintProfileVersions.profileId),
    )
    .where(eq(constraintProfileVersions.id, versionId))
    .limit(1);
  if (!strategy) {
    throw new ConstraintProfileSelectionError("constraint_profile_version_not_found");
  }
  if (strategy.profileStatus !== "active") {
    throw new ConstraintProfileSelectionError("constraint_profile_disabled");
  }
  return {
    versionId: strategy.versionId,
    snapshot: {
      schemaVersion: strategy.schemaVersion,
      profileId: strategy.profileId,
      profileVersionId: strategy.versionId,
      versionNumber: strategy.versionNumber,
      digest: strategy.digest,
      config: strategy.config,
    },
  };
}
