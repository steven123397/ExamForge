import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FixedAssignment, ScheduleInput, ScheduleResult } from "@examforge/shared";
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

    const job = await service.createScheduleJob(overrides);
    assert.equal(job.status, "queued");
    await requireDeferredTask(deferredTask)();

    const completed = await repository.getScheduleJob(job.id);
    assert.equal(completed?.status, "completed");
    assert.deepEqual(scheduler.lastInput?.fixed_assignments, fixedAssignments);
    assert.deepEqual(scheduler.lastInput?.reschedule_context, rescheduleContext);
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
    });
    await requireDeferredTask(deferredTask)();

    const failed = await repository.getScheduleJob(job.id);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.progress, 100);
    assert.equal(failed?.error, "scheduler unavailable");
  });

  it("recovers interrupted jobs through the repository", async () => {
    const repository = new InMemoryPlatformRepository();
    const job = await repository.createScheduleJob();
    await repository.updateScheduleJob(job.id, { status: "running", progress: 35 });
    const service = new ScheduleRunService(repository, new RecordingScheduler());

    await service.recoverInterruptedJobs();

    const recovered = await repository.getScheduleJob(job.id);
    assert.equal(recovered?.status, "failed");
    assert.equal(recovered?.error, "Schedule job was interrupted before completion.");
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

function requireDeferredTask(task: DeferredTask | null): DeferredTask {
  assert.ok(task, "Schedule job must register a deferred task.");
  return task;
}
