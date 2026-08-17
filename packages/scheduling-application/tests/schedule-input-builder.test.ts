import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoScheduleInput, type ConstraintProfileSnapshot } from "@examforge/shared";
import {
  buildScheduleInput,
  buildScheduleJobRequest,
  buildStudentOverlapEdges,
  digestParticipantData,
  normalizeScheduleInputFromSnapshot,
  readParticipantSnapshot,
  ScheduleInputParticipantError,
  type ExamEnrollmentRecord,
  type ParticipantBatchContext,
} from "../src/index.js";

const constraintProfile: ConstraintProfileSnapshot = {
  schemaVersion: 1,
  profileId: "constraint-profile-default",
  profileVersionId: "constraint-profile-default-v1",
  versionNumber: 1,
  digest: "a".repeat(64),
  config: demoScheduleInput.constraint_profile,
};

function buildParticipantContext(
  overrides: Partial<ParticipantBatchContext> = {},
): ParticipantBatchContext {
  return {
    state: {
      batchId: "batch-2026-spring-final",
      mode: "groups_only",
      status: "not_required",
      dataVersion: 0,
      digest: null,
      sealedAt: null,
      ...overrides.state,
    },
    examTasks: overrides.examTasks ?? demoScheduleInput.exam_tasks.map((task) => ({
      id: task.id,
      expectedCount: task.expected_count,
      studentGroupIds: [...task.student_group_ids],
    })),
    studentGroupSizes: overrides.studentGroupSizes ?? new Map(
      demoScheduleInput.student_groups.map((group) => [group.id, group.size]),
    ),
    data: overrides.data ?? { students: [], enrollments: [] },
  };
}

describe("student overlap edges", () => {
  it("derives canonical edges deterministically from active enrollments", () => {
    const enrollments: ExamEnrollmentRecord[] = [
      { examTaskId: "exam-b", studentId: "S000002", source: "regular", status: "active" },
      { examTaskId: "exam-a", studentId: "S000002", source: "elective", status: "active" },
      { examTaskId: "exam-a", studentId: "S000001", source: "regular", status: "active" },
      { examTaskId: "exam-b", studentId: "S000001", source: "retake", status: "active" },
      { examTaskId: "exam-c", studentId: "S000001", source: "other", status: "active" },
    ];

    const edges = buildStudentOverlapEdges(enrollments);

    assert.deepEqual(edges.map((edge) => [edge.exam_task_id_a, edge.exam_task_id_b]), [
      ["exam-a", "exam-b"],
      ["exam-a", "exam-c"],
      ["exam-b", "exam-c"],
    ]);
    assert.equal(edges[0].overlap_count, 2);
    assert.deepEqual(edges[0].sample_participants, [
      { student_id: "S000001", exam_a_source: "regular", exam_b_source: "retake" },
      { student_id: "S000002", exam_a_source: "elective", exam_b_source: "regular" },
    ]);
    assert.deepEqual(buildStudentOverlapEdges([...enrollments].reverse()), edges);
  });

  it("keeps at most five sorted sample participants per edge", () => {
    const enrollments: ExamEnrollmentRecord[] = Array.from({ length: 8 }, (_, index) => index)
      .flatMap((index) => [
        {
          examTaskId: "exam-a",
          studentId: `S00000${index}`,
          source: "regular" as const,
          status: "active" as const,
        },
        {
          examTaskId: "exam-b",
          studentId: `S00000${index}`,
          source: "regular" as const,
          status: "active" as const,
        },
      ]);

    const [edge] = buildStudentOverlapEdges(enrollments);

    assert.equal(edge.overlap_count, 8);
    assert.equal(edge.sample_participants.length, 5);
    assert.deepEqual(
      edge.sample_participants.map((participant) => participant.student_id),
      ["S000000", "S000001", "S000002", "S000003", "S000004"],
    );
  });

  it("orders edge identifiers by Unicode code point order used by the scheduler", () => {
    const [edge] = buildStudentOverlapEdges([
      { examTaskId: "😀", studentId: "S000001", source: "regular", status: "active" },
      { examTaskId: "\uE000", studentId: "S000001", source: "retake", status: "active" },
    ]);

    assert.deepEqual(
      [edge.exam_task_id_a, edge.exam_task_id_b],
      ["\uE000", "😀"],
    );
  });
});

describe("participant digest", () => {
  it("changes whenever an enrollment fact changes", () => {
    const base = {
      batchId: "batch-2026-spring-final",
      mode: "enrollments" as const,
      dataVersion: 3,
      students: [
        { id: "S000001", displayCode: null, primaryStudentGroupId: null, status: "active" as const },
      ],
      enrollments: [
        {
          examTaskId: "exam-a",
          studentId: "S000001",
          source: "regular" as const,
          status: "active" as const,
        },
      ],
      overlapEdges: [],
    };

    const digest = digestParticipantData(base);
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(digestParticipantData(base), digest);
    assert.notEqual(
      digestParticipantData({
        ...base,
        enrollments: [{ ...base.enrollments[0], source: "retake" }],
      }),
      digest,
    );
    assert.notEqual(digestParticipantData({ ...base, dataVersion: 4 }), digest);
  });
});

describe("schedule input builder", () => {
  it("builds a groups_only v3 request snapshot with an empty edge set", () => {
    const built = buildScheduleJobRequest({
      referenceInput: demoScheduleInput,
      constraintProfile,
      participant: buildParticipantContext(),
    });

    assert.equal(built.requestSnapshot.version, 3);
    assert.equal(built.input.participant_mode, "groups_only");
    assert.deepEqual(built.input.student_overlap_edges, []);
    assert.deepEqual(built.participantSnapshot, {
      schemaVersion: 1,
      batchId: "batch-2026-spring-final",
      mode: "groups_only",
      dataVersion: 0,
      digest: null,
      studentCount: 0,
      enrollmentCount: 0,
      overlapEdgeCount: 0,
    });
    assert.match(built.requestDigest, /^[a-f0-9]{64}$/);
  });

  it("binds the constraint profile snapshot into the frozen input", () => {
    const built = buildScheduleJobRequest({
      referenceInput: { ...demoScheduleInput, constraint_profile: { hard_rules: [], soft_weights: {}, time_limit_seconds: 1 } },
      constraintProfile,
      participant: buildParticipantContext(),
    });

    assert.deepEqual(built.input.constraint_profile, constraintProfile.config);
    assert.deepEqual(
      built.requestSnapshot.version === 3 ? built.requestSnapshot.constraintProfile : null,
      constraintProfile,
    );
  });

  it("rejects enrollment batches that have not been sealed", () => {
    assert.throws(
      () => buildScheduleJobRequest({
        referenceInput: demoScheduleInput,
        constraintProfile,
        participant: buildParticipantContext({
          state: {
            batchId: "batch-2026-spring-final",
            mode: "enrollments",
            status: "draft",
            dataVersion: 4,
            digest: null,
            sealedAt: null,
          },
        }),
      }),
      (error: unknown) => (
        error instanceof ScheduleInputParticipantError
        && error.code === "participant_data_incomplete"
      ),
    );
  });

  it("refuses to degrade a sealed enrollment batch into group-only solving", () => {
    const context = buildParticipantContext({
      state: {
        batchId: "batch-2026-spring-final",
        mode: "enrollments",
        status: "complete",
        dataVersion: 4,
        digest: "b".repeat(64),
        sealedAt: "2026-07-26T00:00:00.000Z",
      },
      examTasks: [{ id: "exam-a", expectedCount: 1, studentGroupIds: ["g-cs-2301"] }],
      data: {
        students: [
          {
            id: "S000001",
            displayCode: null,
            primaryStudentGroupId: null,
            status: "active",
          },
        ],
        enrollments: [
          { examTaskId: "exam-a", studentId: "S000001", source: "regular", status: "active" },
        ],
      },
    });

    assert.throws(
      () => buildScheduleInput({
        referenceInput: demoScheduleInput,
        constraintProfile,
        participant: context,
      }),
      (error: unknown) => (
        error instanceof ScheduleInputParticipantError
        && error.code === "enrollment_mode_not_solvable"
      ),
    );
  });
});

describe("historical request snapshots", () => {
  it("normalizes v1 and v2 snapshots as groups_only without overlap edges", () => {
    const legacyInput = structuredClone(demoScheduleInput) as Record<string, unknown>;
    delete legacyInput.participant_mode;
    delete legacyInput.student_overlap_edges;

    for (const snapshot of [
      { version: 1 as const, input: legacyInput as never },
      { version: 2 as const, input: legacyInput as never, constraintProfile },
    ]) {
      const normalized = normalizeScheduleInputFromSnapshot(snapshot);
      assert.equal(normalized.participant_mode, "groups_only");
      assert.deepEqual(normalized.student_overlap_edges, []);
      assert.equal(readParticipantSnapshot(snapshot), null);
    }
  });

  it("keeps v3 snapshots verbatim", () => {
    const built = buildScheduleJobRequest({
      referenceInput: demoScheduleInput,
      constraintProfile,
      participant: buildParticipantContext(),
    });

    assert.deepEqual(normalizeScheduleInputFromSnapshot(built.requestSnapshot), built.input);
    assert.deepEqual(
      readParticipantSnapshot(built.requestSnapshot),
      built.participantSnapshot,
    );
  });
});
