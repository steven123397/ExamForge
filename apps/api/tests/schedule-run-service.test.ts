import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  FixedAssignment,
  ScheduleInput,
  ScheduleResult,
} from "@examforge/shared";
import { InMemoryPlatformRepository } from "../src/repository.js";
import type { SchedulerClient } from "../src/scheduler-client.js";
import { ScheduleRunService, type DeferredTask } from "../src/services/schedule-run-service.js";

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

class RecordingScheduler implements SchedulerClient {
  lastInput: ScheduleInput | null = null;

  constructor(private readonly error?: Error) {}

  async solve(input: ScheduleInput): Promise<ScheduleResult> {
    this.lastInput = input;
    if (this.error) {
      throw this.error;
    }
    return buildResult(input);
  }
}

class DraftRescheduleScheduler implements SchedulerClient {
  lastInput: ScheduleInput | null = null;

  async solve(input: ScheduleInput): Promise<ScheduleResult> {
    this.lastInput = structuredClone(input);
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

  it("passes reschedule context through asynchronous schedule jobs", async () => {
    const repository = new InMemoryPlatformRepository();
    const scheduler = new RecordingScheduler();
    let deferredTask: DeferredTask | null = null;
    const service = new ScheduleRunService(repository, scheduler, (task) => {
      deferredTask = task;
    });

    const job = await service.createScheduleJob(overrides, {
      idempotencyKey: "job-reschedule-context",
      traceId: "trace-reschedule-context",
    });
    assert.equal(job.status, "queued");
    await requireDeferredTask(deferredTask)();

    const succeeded = await repository.getScheduleJob(job.id);
    assert.equal(succeeded?.status, "succeeded");
    assert.deepEqual(scheduler.lastInput?.fixed_assignments, fixedAssignments);
    assert.deepEqual(scheduler.lastInput?.reschedule_context, rescheduleContext);
  });

  it("reuses idempotent submissions without scheduling duplicate execution", async () => {
    const repository = new InMemoryPlatformRepository();
    const deferredTasks: DeferredTask[] = [];
    const service = new ScheduleRunService(repository, new RecordingScheduler(), (task) => {
      deferredTasks.push(task);
    });
    const context = {
      idempotencyKey: "same-schedule-request",
      traceId: "trace-idempotent-request",
    };

    const first = await service.createScheduleJob(overrides, context);
    const second = await service.createScheduleJob(overrides, context);

    assert.equal(second.id, first.id);
    assert.equal(deferredTasks.length, 1);
  });

  it("rejects an idempotency key reused with a different request digest", async () => {
    const repository = new InMemoryPlatformRepository();
    const service = new ScheduleRunService(repository, new RecordingScheduler(), () => {});
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

  it("does not create another run when a success callback is repeated", async () => {
    const repository = new InMemoryPlatformRepository();
    let deferredTask: DeferredTask | null = null;
    const scheduler = new RecordingScheduler();
    const service = new ScheduleRunService(repository, scheduler, (task) => {
      deferredTask = task;
    });
    const job = await service.createScheduleJob(overrides, {
      idempotencyKey: "repeat-success-callback",
      traceId: "trace-repeat-success",
    });
    const execute = requireDeferredTask(deferredTask);

    await execute();
    await execute();

    assert.equal((await repository.listScheduleRuns()).runs.length, 1);
    assert.equal((await repository.getScheduleJob(job.id))?.status, "succeeded");
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

  it("marks asynchronous jobs as failed when the scheduler throws", async () => {
    const repository = new InMemoryPlatformRepository();
    let deferredTask: DeferredTask | null = null;
    const service = new ScheduleRunService(
      repository,
      new RecordingScheduler(new Error("scheduler unavailable")),
      (task) => {
        deferredTask = task;
      },
    );

    const job = await service.createScheduleJob({
      fixed_assignments: [],
      reschedule_context: null,
    }, {
      idempotencyKey: "scheduler-failure",
      traceId: "trace-scheduler-failure",
    });
    await requireDeferredTask(deferredTask)();

    const failed = await repository.getScheduleJob(job.id);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.progress, 100);
    assert.equal(failed?.error?.message, "scheduler unavailable");
  });

  it("recovers interrupted jobs through the repository", async () => {
    const repository = new InMemoryPlatformRepository();
    const job = await repository.createScheduleJob({
      batchId: "batch-2026-spring-final",
      idempotencyKey: "recover-interrupted-job",
      requestDigest: "c".repeat(64),
      traceId: "trace-recover-interrupted",
    });
    await repository.transitionScheduleJob(job.job.id, { to: "running", progress: 35 });
    const service = new ScheduleRunService(repository, new RecordingScheduler());

    await service.recoverInterruptedJobs();

    const recovered = await repository.getScheduleJob(job.job.id);
    assert.equal(recovered?.status, "failed");
    assert.equal(recovered?.error?.message, "Schedule job was interrupted before completion.");
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
    },
    statistics: {
      status: "feasible",
      elapsed_ms: 1,
      exam_count: input.exam_tasks.length,
      room_count: input.rooms.length,
      slot_count: input.time_slots.length,
      attempted_assignments: 1,
    },
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

function requireDeferredTask(task: DeferredTask | null): DeferredTask {
  assert.ok(task, "Schedule job must register a deferred task.");
  return task;
}
