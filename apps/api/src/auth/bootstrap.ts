import type { UserRole } from "@examforge/shared";
import { randomUUID } from "node:crypto";
import type { PlatformRepository } from "../repository.js";
import { hashPassword } from "./security.js";

const configuredAccounts: Array<{
  role: UserRole;
  username: string;
  displayName: string;
  passwordVariable: string;
  audience?: { kind: "teacher"; teacherId: string }
    | { kind: "student"; studentGroupIds: string[] };
}> = [
  {
    role: "admin",
    username: "admin",
    displayName: "System administrator",
    passwordVariable: "EXAMFORGE_ADMIN_PASSWORD",
  },
  {
    role: "operator",
    username: "operator",
    displayName: "Scheduling operator",
    passwordVariable: "EXAMFORGE_OPERATOR_PASSWORD",
  },
  {
    role: "teacher",
    username: "teacher",
    displayName: "Teacher",
    passwordVariable: "EXAMFORGE_TEACHER_PASSWORD",
    audience: { kind: "teacher", teacherId: "t-zhang" },
  },
  {
    role: "student",
    username: "student",
    displayName: "Student",
    passwordVariable: "EXAMFORGE_STUDENT_PASSWORD",
    audience: { kind: "student", studentGroupIds: ["g-cs-2301"] },
  },
];

export async function initializeConfiguredAuthUsers(repository: PlatformRepository) {
  for (const account of configuredAccounts) {
    const password = process.env[account.passwordVariable];
    if (!password) {
      continue;
    }
    const existing = await repository.findAuthUserByUsername(account.username);
    const user = existing ?? await repository.createAuthUser({
        id: `user-${account.role}-${randomUUID()}`,
        username: account.username,
        displayName: account.displayName,
        active: true,
        roles: [account.role],
        password: await hashPassword(password),
      });
    if (!account.audience || await repository.getAudienceScope(user.id)) {
      continue;
    }
    if (account.audience.kind === "teacher") {
      await repository.setTeacherAudienceScope(user.id, account.audience.teacherId);
    } else {
      for (const studentGroupId of account.audience.studentGroupIds) {
        await repository.addStudentGroupAudienceScope(user.id, studentGroupId);
      }
    }
  }
}
