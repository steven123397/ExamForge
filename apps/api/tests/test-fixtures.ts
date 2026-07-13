import type { ScheduleInput, ScheduleResult } from "@examforge/shared";
import type { AuthUserRecord, PlatformRepository } from "../src/repository.js";
import { hashPassword, hashSessionToken } from "../src/auth/security.js";

export const testSessionTokens = {
  admin: "test-admin-session-token",
  operator: "test-operator-session-token",
  teacher: "test-teacher-session-token",
  student: "test-student-session-token",
} as const;

export const testAuthHeaders = {
  admin: sessionHeaders(testSessionTokens.admin),
  operator: sessionHeaders(testSessionTokens.operator),
  teacher: sessionHeaders(testSessionTokens.teacher),
  student: sessionHeaders(testSessionTokens.student),
} as const;

let testAuthUsersPromise: Promise<AuthUserRecord[]> | null = null;

export function buildTestAuthUsers() {
  testAuthUsersPromise ??= Promise.all([
    buildTestAuthUser("admin", "admin-password", "admin"),
    buildTestAuthUser("operator", "operator-password", "operator"),
    buildTestAuthUser("teacher", "teacher-password", "teacher"),
    buildTestAuthUser("student", "student-password", "student"),
    buildTestAuthUser("disabled", "disabled-password", "operator", false),
  ]);
  return testAuthUsersPromise.then((users) => structuredClone(users));
}

export async function seedTestAuth(repository: PlatformRepository) {
  const users = await buildTestAuthUsers();
  for (const user of users) {
    await repository.createAuthUser(user);
  }
  const createdAt = "2026-07-12T00:00:00.000Z";
  const expiresAt = "2099-07-12T00:00:00.000Z";
  for (const role of ["admin", "operator", "teacher", "student"] as const) {
    await repository.createAuthSession({
      id: `test-${role}-session`,
      userId: `user-${role}`,
      tokenDigest: hashSessionToken(testSessionTokens[role]),
      createdAt,
      expiresAt,
      userAgent: "ExamForge test fixture",
      ipAddress: "127.0.0.1",
    });
  }
  await repository.setTeacherAudienceScope("user-teacher", "t-zhang");
  await repository.addStudentGroupAudienceScope("user-student", "g-cs-2301");
}

function sessionHeaders(token: string) {
  return {
    origin: "http://localhost:3000",
    cookie: `examforge_session=${token}`,
  };
}

async function buildTestAuthUser(
  username: string,
  password: string,
  role: "admin" | "operator" | "teacher" | "student",
  active = true,
): Promise<AuthUserRecord> {
  return {
    id: `user-${username}`,
    username,
    displayName: `${username} test user`,
    active,
    roles: [role],
    password: await hashPassword(password),
  };
}

export function buildCompleteScheduleResult(input: ScheduleInput): ScheduleResult {
  const assignmentsByTaskId = new Map<
    string,
    ScheduleResult["assignments"][number]
  >([
    ["e-data-structures", {
      exam_task_id: "e-data-structures",
      room_id: "r-101",
      time_slot_id: "s-001",
      teacher_ids: ["t-zhang"],
    }],
    ["e-database", {
      exam_task_id: "e-database",
      room_id: "r-lab-1",
      time_slot_id: "s-003",
      teacher_ids: ["t-li"],
    }],
    ["e-ai", {
      exam_task_id: "e-ai",
      room_id: "r-201",
      time_slot_id: "s-002",
      teacher_ids: ["t-wang"],
    }],
    ["e-calculus", {
      exam_task_id: "e-calculus",
      room_id: "r-201",
      time_slot_id: "s-004",
      teacher_ids: ["t-chen"],
    }],
    ["e-english", {
      exam_task_id: "e-english",
      room_id: "r-101",
      time_slot_id: "s-005",
      teacher_ids: ["t-zhang", "t-wang"],
    }],
    ["e-os", {
      exam_task_id: "e-os",
      room_id: "r-lab-2",
      time_slot_id: "s-006",
      teacher_ids: ["t-chen"],
    }],
  ]);
  const assignments = input.exam_tasks.map((task) => {
    const assignment = assignmentsByTaskId.get(task.id);
    if (!assignment) {
      throw new Error(`No complete test assignment is defined for ${task.id}.`);
    }
    return structuredClone(assignment);
  });

  return {
    assignments,
    conflicts: [],
    score: {
      total_score: 94,
      hard_violation_count: 0,
      soft_penalty_items: [],
      scoring_contract_version: 1,
      normalized_score: 94,
      total_raw_penalty: 0,
      total_weighted_penalty: 0,
      normalized_penalty_items: [],
    },
    statistics: {
      status: "feasible",
      elapsed_ms: 22,
      exam_count: input.exam_tasks.length,
      room_count: input.rooms.length,
      slot_count: input.time_slots.length,
      attempted_assignments: assignments.length,
    },
    diagnostics: [],
    report: {
      summary: {
        status: "feasible",
      },
    },
  };
}
