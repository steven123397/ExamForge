import type { UserRole } from "@examforge/shared";
import { randomUUID } from "node:crypto";
import type { PlatformRepository } from "../repository.js";
import { hashPassword } from "./security.js";

const configuredAccounts: Array<{
  role: UserRole;
  username: string;
  displayName: string;
  passwordVariable: string;
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
  },
  {
    role: "student",
    username: "student",
    displayName: "Student",
    passwordVariable: "EXAMFORGE_STUDENT_PASSWORD",
  },
];

export async function initializeConfiguredAuthUsers(repository: PlatformRepository) {
  for (const account of configuredAccounts) {
    const password = process.env[account.passwordVariable];
    if (!password || await repository.findAuthUserByUsername(account.username)) {
      continue;
    }
    await repository.createAuthUser({
      id: `user-${account.role}-${randomUUID()}`,
      username: account.username,
      displayName: account.displayName,
      active: true,
      roles: [account.role],
      password: await hashPassword(password),
    });
  }
}
