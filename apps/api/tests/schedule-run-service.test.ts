import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConstraintProfile,
  FixedAssignment,
  ScheduleInput,
  ScheduleResult,
} from "@examforge/shared";
import { ConstraintProfileService } from "@examforge/scheduling-application";
import { InMemoryPlatformRepository } from "../src/repository.js";
import {
  type SchedulerClient,
  type SchedulerSolveOptions,
} from "../src/scheduler-client.js";
import { ScheduleRunService } from "../src/services/schedule-run-service.js";

const fixedAssignments: FixedAssignment[] = [
  {
    exam_task_id: "e-data-structures",
    room_id: "r-101",
    time_slot_id: "s-001",
    teacher_ids: ["t-zhang"],
  },
];

const rescheduleContext = {
  baseline_assignments: [
    {
      exam_task_id: "e-data-structures",
      room_id: "r-101",
      time_slot_id: "s-001",
      teacher_ids: ["t-zhang"],
    },
  ],
  movable_exam_task_ids: ["e-data-structures"],
};

const overrides = {
  fixed_assignments: fixedAssignments,
  reschedule_context: rescheduleContext,
};

const governedStrategy: ConstraintProfile = {
  hard_rules: ["room_capacity", "teacher_time_unique"],
  soft_weights: {
    room_utilization: 37,
    student_consecutive_exam: 11,
  },
  time_limit_seconds: 19,
};

const strategyContext = {
  actor: {
    userId: "user-admin",
    username: "admin",
    roles: ["admin" as const],
  },
  traceId: "trace-synchronous-strategy",
};

class RecordingScheduler implements SchedulerClient {
  lastInput: ScheduleInput | null = null;
  lastOptions: SchedulerSolveOptions | null = null;

  async solve(input: ScheduleInput, options?: SchedulerSolveOptions): Promise<ScheduleResult> {
    this.lastInput = input;
    this.lastOptions = options ?? null;
    options?.onMetadata?.({ schedulerVersion: "scheduler-test-1" });
    return buildResult(input);
  }
}

class DraftRescheduleScheduler implements SchedulerClient {
  lastInput: ScheduleInput | null = null;

  async solve(input: ScheduleInput, options?: SchedulerSolveOptions): Promise<ScheduleResult> {
    this.lastInput = structuredClone(input);
    options?.onMetadata?.({ schedulerVersion: "scheduler-test-1" });
    const baseline = input.reschedule_context?.baseline_assignments ?? [];
    const frozen = new Set(
      baseline
        .map((assignment) => assignment.exam_task_id)
        .filter((examTaskId) => !input.reschedule_context?.movable_exam_task_ids.includes(examTaskId)),
    );
    return {
      ...buildResult(input),
      assignments: structuredClone(baseline),
      report: {
        reschedule: {
          baseline_exam_count: baseline.length,
          frozen_exam_task_ids: [...frozen].sort(),
          retained_exam_task_ids: baseline.map((item) => item.exam_task_id).sort(),
          changed_exam_task_ids: [],
        },
      },
    };
  }
}

describe("schedule run service", () => {
  it("passes reschedule context through synchronous schedule runs", async () => {
    const repository = new InMemoryPlatformRepository();
    const scheduler = new RecordingScheduler();
    const service = new ScheduleRunService(repository, scheduler);

    const response = await service.createScheduleRun(overrides);

    assert.equal(response.run.assignmentCount, 1);
    assert.deepEqual(scheduler.lastInput?.fixed_assignments, fixedAssignments);
    assert.deepEqual(scheduler.lastInput?.reschedule_context, rescheduleContext);
  });

  it("uses and persists the selected strategy for synchronous schedule runs", async () => {
    const repository = new InMemoryPlatformRepository();
    const profileService = new ConstraintProfileService(repository);
    const selected = await profileService.create({
      name: "Governed synchronous strategy",
      config: governedStrategy,
    }, strategyContext);
    const scheduler = new RecordingScheduler();
    const service = new ScheduleRunService(repository, scheduler);

    const response = await service.createScheduleRun({
      ...overrides,
      constraintProfileVersionId: selected.currentVersionId,
    });

    assert.deepEqual(scheduler.lastInput?.constraint_profile, governedStrategy);
    assert.equal(response.run.constraintProfileVersionId, selected.currentVersionId);
    assert.deepEqual(response.run.constraintProfileSnapshot?.config, governedStrategy);
    assert.equal(response.run.schedulerVersion, "scheduler-test-1");
  });

  it("freezes reschedule context without executing the job in the API process", async () => {
    const repository = new InMemoryPlatformRepository();
    const scheduler = new RecordingScheduler();
    const service = new ScheduleRunService(repository, scheduler);

    const job = await service.createScheduleJob(overrides, {
      idempotencyKey: "job-reschedule-context",
      traceId: "trace-reschedule-context",
    });
    assert.equal(job.status, "queued");
    const claim = await repository.claimScheduleJob(job.id);
    assert.equal(claim.resolution, "claimed");
    assert.ok(claim.resolution === "claimed");
    assert.deepEqual(claim.requestSnapshot.input.fixed_assignments, fixedAssignments);
    assert.deepEqual(claim.requestSnapshot.input.reschedule_context, rescheduleContext);
    assert.equal(scheduler.lastInput, null);
  });

  it("reuses idempotent submissions without executing them", async () => {
    const repository = new InMemoryPlatformRepository();
    const scheduler = new RecordingScheduler();
    const service = new ScheduleRunService(repository, scheduler);
    const context = {
      idempotencyKey: "same-schedule-request",
      traceId: "trace-idempotent-request",
    };

    const first = await service.createScheduleJob(overrides, context);
    const second = await service.createScheduleJob(overrides, context);

    assert.equal(second.id, first.id);
    assert.equal(scheduler.lastInput, null);
  });

  it("rejects an idempotency key reused with a different request digest", async () => {
    const repository = new InMemoryPlatformRepository();
    const service = new ScheduleRunService(repository, new RecordingScheduler());
    const context = {
      idempotencyKey: "conflicting-schedule-request",
      traceId: "trace-conflicting-request",
    };
    await service.createScheduleJob(overrides, context);

    await assert.rejects(
      service.createScheduleJob({ ...overrides, fixed_assignments: [] }, context),
      /idempotency key/i,
    );
  });

  it("builds a stable reschedule context from an editable draft without mutating it", async () => {
    const repository = new InMemoryPlatformRepository();
    const referenceData = await repository.getReferenceData();
    const sourceRun = await repository.createScheduleRun(buildDraftSourceResult(referenceData.scheduleInput));
    const draft = await repository.createScheduleDraftFromRun(sourceRun.run.id);
    assert.ok(draft);
    const examIds = draft.assignments.map((assignment) => assignment.exam_task_id).sort();
    const frozenExamId = examIds[0];
    await repository.lockScheduleDraftAssignment(draft.draft.id, frozenExamId);
    const before = structuredClone(await repository.getScheduleDraft(draft.draft.id));
    const profileService = new ConstraintProfileService(repository);
    const selected = await profileService.create({
      name: "Governed draft strategy",
      config: governedStrategy,
    }, strategyContext);
    await profileService.setDefault(selected.id, strategyContext);
    const scheduler = new DraftRescheduleScheduler();
    const service = new ScheduleRunService(repository, scheduler);

    const response = await service.createScheduleRunFromDraft(draft.draft.id);

    assert.ok(response && response !== "not_editable");
    assert.deepEqual(
      scheduler.lastInput?.reschedule_context?.baseline_assignments.map((item) => item.exam_task_id),
      examIds,
    );
    assert.deepEqual(
      scheduler.lastInput?.reschedule_context?.movable_exam_task_ids,
      examIds.filter((examTaskId) => examTaskId !== frozenExamId),
    );
    assert.deepEqual(scheduler.lastInput?.constraint_profile, governedStrategy);
    assert.equal(response.run.constraintProfileVersionId, selected.currentVersionId);
    assert.deepEqual(response.run.constraintProfileSnapshot?.config, governedStrategy);
    assert.equal(response.run.schedulerVersion, "scheduler-test-1");
    assert.deepEqual(response.reschedule, {
      baseline_exam_count: examIds.length,
      frozen_exam_task_ids: [frozenExamId],
      retained_exam_task_ids: examIds,
      changed_exam_task_ids: [],
    });
    assert.deepEqual(await repository.getScheduleDraft(draft.draft.id), before);
  });

  it("rejects missing and terminal drafts before invoking the scheduler", async () => {
    const repository = new InMemoryPlatformRepository();
    const scheduler = new DraftRescheduleScheduler();
    const service = new ScheduleRunService(repository, scheduler);

    assert.equal(await service.createScheduleRunFromDraft("draft-missing"), null);
    const referenceData = await repository.getReferenceData();
    const sourceRun = await repository.createScheduleRun(buildDraftSourceResult(referenceData.scheduleInput));
    const draft = await repository.createScheduleDraftFromRun(sourceRun.run.id);
    assert.ok(draft);
    await repository.discardScheduleDraft(draft.draft.id);

    assert.equal(await service.createScheduleRunFromDraft(draft.draft.id), "not_editable");
    assert.equal(scheduler.lastInput, null);
  });

});

function buildResult(input: ScheduleInput): ScheduleResult {
  return {
    assignments: [
      {
        exam_task_id: input.exam_tasks[0].id,
        room_id: input.rooms[0].id,
        time_slot_id: input.time_slots[0].id,
        teacher_ids: [input.teachers[0].id],
      },
    ],
    conflicts: [],
    score: {
      total_score: 100,
      hard_violation_count: 0,
      soft_penalty_items: [],
      scoring_contract_version: 1,
      normalized_score: 100,
      total_raw_penalty: 0,
      total_weighted_penalty: 0,
      normalized_penalty_items: [],
    },
    statistics: {
      status: "feasible",
      elapsed_ms: 1,
      exam_count: input.exam_tasks.length,
      room_count: input.rooms.length,
      slot_count: input.time_slots.length,
      attempted_assignments: 1,
    },
    diagnostics: [],
  };
}

function buildDraftSourceResult(input: ScheduleInput): ScheduleResult {
  const assignments = input.exam_tasks
    .map((examTask, index) => ({
      exam_task_id: examTask.id,
      room_id: input.rooms[index % input.rooms.length].id,
      time_slot_id: input.time_slots[index % input.time_slots.length].id,
      teacher_ids: [input.teachers[index % input.teachers.length].id],
    }))
    .sort((left, right) => right.exam_task_id.localeCompare(left.exam_task_id));
  return {
    ...buildResult(input),
    assignments,
    statistics: {
      ...buildResult(input).statistics,
      exam_count: assignments.length,
      attempted_assignments: assignments.length,
    },
  };
}
