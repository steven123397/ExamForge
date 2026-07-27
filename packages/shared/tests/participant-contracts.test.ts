import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  examEnrollmentSchema,
  participantDataStatusSchema,
  participantModeSchema,
  participantSnapshotSchema,
  scheduleDiagnosticCodeSchema,
  scheduleInputSchema,
  scheduleJobRequestSnapshotSchema,
  studentOverlapEdgeSchema,
  studentSchema,
  type ScheduleInput,
} from "../src/index.js";

const constraintProfile = {
  hard_rules: ["no_room_double_booking"],
  soft_weights: { teacher_load_balance: 3 },
  time_limit_seconds: 30,
};

const constraintProfileSnapshot = {
  schemaVersion: 1 as const,
  profileId: "profile-default",
  profileVersionId: "profile-default-v1",
  versionNumber: 1,
  digest: "a".repeat(64),
  config: constraintProfile,
};

function buildScheduleInput(overrides: Record<string, unknown> = {}) {
  return {
    student_groups: [{ id: "group-1", name: "群体 1", size: 40, department_id: "dept-1" }],
    teachers: [{ id: "teacher-1", name: "教师 1", department_id: "dept-1" }],
    courses: [
      { id: "course-1", name: "课程 1", department_id: "dept-1", exam_type: "written" },
      { id: "course-2", name: "课程 2", department_id: "dept-1", exam_type: "written" },
    ],
    rooms: [
      { id: "room-1", name: "考场 1", building_id: "b1", capacity: 60, room_type: "standard" },
    ],
    time_slots: [
      { id: "slot-1", date: "2026-01-05", start_time: "08:00", end_time: "10:00", period_index: 0 },
    ],
    exam_tasks: [
      {
        id: "exam-a",
        course_id: "course-1",
        student_group_ids: ["group-1"],
        expected_count: 30,
        duration_minutes: 120,
        required_room_type: "standard",
        invigilator_count: 1,
      },
      {
        id: "exam-b",
        course_id: "course-2",
        student_group_ids: ["group-1"],
        expected_count: 20,
        duration_minutes: 120,
        required_room_type: "standard",
        invigilator_count: 1,
      },
    ],
    constraint_profile: constraintProfile,
    ...overrides,
  };
}

const overlapEdge = {
  exam_task_id_a: "exam-a",
  exam_task_id_b: "exam-b",
  overlap_count: 2,
  sample_participants: [
    { student_id: "S000001", exam_a_source: "regular", exam_b_source: "retake" },
    { student_id: "S000002", exam_a_source: "elective", exam_b_source: "regular" },
  ],
};

describe("participant contracts", () => {
  it("freezes participant mode and data status values", () => {
    assert.deepEqual(participantModeSchema.options, ["groups_only", "enrollments"]);
    assert.deepEqual(participantDataStatusSchema.options, [
      "not_required",
      "draft",
      "complete",
    ]);
  });

  it("keeps students anonymized and rejects real personal information", () => {
    const parsed = studentSchema.parse({
      id: "S000123",
      display_code: "2026-CS-0123",
      primary_student_group_id: "group-1",
      status: "active",
    });
    assert.equal(parsed.id, "S000123");
    assert.equal(parsed.primary_student_group_id, "group-1");

    for (const forbidden of ["name", "id_card", "phone", "email"]) {
      const result = studentSchema.safeParse({
        id: "S000124",
        display_code: null,
        primary_student_group_id: null,
        status: "active",
        [forbidden]: "真实个人信息",
      });
      assert.equal(result.success, false, `${forbidden} must be rejected`);
    }
  });

  it("defaults optional student and enrollment fields", () => {
    const student = studentSchema.parse({ id: "S000125" });
    assert.equal(student.display_code, null);
    assert.equal(student.primary_student_group_id, null);
    assert.equal(student.status, "active");

    const enrollment = examEnrollmentSchema.parse({
      exam_task_id: "exam-a",
      student_id: "S000125",
    });
    assert.equal(enrollment.source, "regular");
    assert.equal(enrollment.status, "active");

    assert.equal(
      examEnrollmentSchema.safeParse({
        exam_task_id: "exam-a",
        student_id: "S000125",
        source: "transfer",
      }).success,
      false,
    );
  });

  it("normalizes overlap edges", () => {
    assert.equal(studentOverlapEdgeSchema.safeParse(overlapEdge).success, true);

    assert.equal(
      studentOverlapEdgeSchema.safeParse({ ...overlapEdge, exam_task_id_b: "exam-a" }).success,
      false,
      "self loops are rejected",
    );
    assert.equal(
      studentOverlapEdgeSchema.safeParse({
        ...overlapEdge,
        exam_task_id_a: "\uE000",
        exam_task_id_b: "😀",
      }).success,
      true,
      "edge identifiers use Unicode code point order, matching the scheduler",
    );
    assert.equal(
      studentOverlapEdgeSchema.safeParse({
        ...overlapEdge,
        exam_task_id_a: "exam-b",
        exam_task_id_b: "exam-a",
      }).success,
      false,
      "unordered edges are rejected",
    );
    assert.equal(
      studentOverlapEdgeSchema.safeParse({ ...overlapEdge, overlap_count: 0 }).success,
      false,
      "overlap_count must be positive",
    );
    assert.equal(
      studentOverlapEdgeSchema.safeParse({
        ...overlapEdge,
        sample_participants: [
          { student_id: "S000002", exam_a_source: "regular", exam_b_source: "regular" },
          { student_id: "S000001", exam_a_source: "regular", exam_b_source: "regular" },
        ],
      }).success,
      false,
      "sample participants must be sorted",
    );
    assert.equal(
      studentOverlapEdgeSchema.safeParse({
        ...overlapEdge,
        overlap_count: 6,
        sample_participants: Array.from({ length: 6 }, (_, index) => ({
          student_id: `S00000${index}`,
          exam_a_source: "regular",
          exam_b_source: "regular",
        })),
      }).success,
      false,
      "at most five sample participants are kept",
    );
  });
});

describe("schedule input participant semantics", () => {
  it("defaults legacy inputs to groups_only without overlap edges", () => {
    const input: ScheduleInput = scheduleInputSchema.parse(buildScheduleInput());
    assert.equal(input.participant_mode, "groups_only");
    assert.deepEqual(input.student_overlap_edges, []);
  });

  it("rejects overlap edges in groups_only mode", () => {
    const result = scheduleInputSchema.safeParse(
      buildScheduleInput({ participant_mode: "groups_only", student_overlap_edges: [overlapEdge] }),
    );
    assert.equal(result.success, false);
  });

  it("accepts sorted overlap edges in enrollments mode", () => {
    const input = scheduleInputSchema.parse(
      buildScheduleInput({
        participant_mode: "enrollments",
        student_overlap_edges: [overlapEdge],
      }),
    );
    assert.equal(input.participant_mode, "enrollments");
    assert.equal(input.student_overlap_edges.length, 1);
  });

  it("rejects duplicate, unsorted or unknown overlap edges", () => {
    assert.equal(
      scheduleInputSchema.safeParse(
        buildScheduleInput({
          participant_mode: "enrollments",
          student_overlap_edges: [overlapEdge, overlapEdge],
        }),
      ).success,
      false,
      "duplicate edges are rejected",
    );

    assert.equal(
      scheduleInputSchema.safeParse(
        buildScheduleInput({
          participant_mode: "enrollments",
          student_overlap_edges: [
            { ...overlapEdge, exam_task_id_a: "exam-a", exam_task_id_b: "exam-c" },
            overlapEdge,
          ],
        }),
      ).success,
      false,
      "edges must be globally sorted",
    );

    assert.equal(
      scheduleInputSchema.safeParse(
        buildScheduleInput({
          participant_mode: "enrollments",
          student_overlap_edges: [{ ...overlapEdge, exam_task_id_b: "exam-unknown" }],
        }),
      ).success,
      false,
      "edges must reference known exam tasks",
    );
  });
});

describe("schedule job request snapshot versions", () => {
  const input = scheduleInputSchema.parse(buildScheduleInput());

  it("still reads v1 and v2 snapshots", () => {
    const v1 = scheduleJobRequestSnapshotSchema.parse({ version: 1, input });
    assert.equal(v1.version, 1);

    const v2 = scheduleJobRequestSnapshotSchema.parse({
      version: 2,
      input,
      constraintProfile: constraintProfileSnapshot,
    });
    assert.equal(v2.version, 2);
  });

  it("accepts v3 snapshots carrying a participant snapshot", () => {
    const snapshot = scheduleJobRequestSnapshotSchema.parse({
      version: 3,
      input,
      constraintProfile: constraintProfileSnapshot,
      participantSnapshot: {
        schemaVersion: 1,
        batchId: "batch-2026",
        mode: "groups_only",
        dataVersion: 0,
        digest: null,
        studentCount: 0,
        enrollmentCount: 0,
        overlapEdgeCount: 0,
      },
    });
    assert.equal(snapshot.version, 3);
    assert.equal(
      snapshot.version === 3 ? snapshot.participantSnapshot.mode : null,
      "groups_only",
    );
  });

  it("requires a digest once enrollment participants are sealed", () => {
    const base = {
      schemaVersion: 1 as const,
      batchId: "batch-2026",
      mode: "enrollments" as const,
      dataVersion: 7,
      studentCount: 3,
      enrollmentCount: 4,
      overlapEdgeCount: 1,
    };
    assert.equal(participantSnapshotSchema.safeParse({ ...base, digest: null }).success, false);
    assert.equal(
      participantSnapshotSchema.safeParse({ ...base, digest: "b".repeat(64) }).success,
      true,
    );
    assert.equal(
      participantSnapshotSchema.safeParse({
        ...base,
        mode: "groups_only",
        digest: "b".repeat(64),
      }).success,
      false,
      "groups_only snapshots carry no participant digest",
    );
  });

  it("rejects unknown snapshot versions", () => {
    assert.equal(
      scheduleJobRequestSnapshotSchema.safeParse({ version: 4, input }).success,
      false,
    );
  });
});

describe("participant diagnostics", () => {
  it("exposes the sixth-version stable diagnostic codes", () => {
    for (const code of [
      "participant_mode_invalid",
      "participant_data_incomplete",
      "participant_snapshot_stale",
      "expected_count_exceeds_group_size",
      "expected_count_lower_than_group_size",
      "expected_count_mismatch",
      "student_enrollment_reference_invalid",
      "student_overlap_edge_invalid",
      "student_exam_clash",
    ]) {
      assert.equal(scheduleDiagnosticCodeSchema.safeParse(code).success, true, code);
    }
  });
});
