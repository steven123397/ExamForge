import { expect, test, type APIRequestContext } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000";
const adminHeaders = { authorization: "Bearer examforge-admin-token" };
const operatorHeaders = { authorization: "Bearer examforge-operator-token" };

test("方案工作台支持建议应用和矩阵拖拽调整", async ({ page, request }) => {
  const runResponse = await request.post(`${apiBase}/api/schedule-runs`, {
    headers: operatorHeaders,
  });
  expect(runResponse.ok()).toBeTruthy();
  const run = await runResponse.json() as { run: { id: string } };

  const draftResponse = await request.post(`${apiBase}/api/schedule-runs/${run.run.id}/drafts`, {
    headers: operatorHeaders,
  });
  expect(draftResponse.ok()).toBeTruthy();
  const createdDraft = await draftResponse.json() as {
    draft: { id: string };
    assignments: Array<{ exam_task_id: string; room_id: string; time_slot_id: string }>;
  };

  await page.goto("/");

  const workspace = page.getByTestId("schedule-draft-workspace");
  await expect(workspace).toBeVisible();
  await page.getByTestId(`draft-row-${createdDraft.draft.id}`).click();

  const initialAssignment = createdDraft.assignments[0];
  await expect(page.locator(`[data-exam-task-id="${initialAssignment.exam_task_id}"]`)).toBeVisible();
  await expect(page.getByTestId("draft-suggestion-panel")).toContainText("局部调整建议");

  await page.getByTestId("draft-lock-assignment").click();
  await expect(page.getByTestId("draft-lock-state")).toContainText("已锁定");
  await expect(page.getByRole("button", { name: "保存调整并校验" })).toBeDisabled();
  await page.getByTestId("draft-unlock-assignment").click();
  await expect(page.getByTestId("draft-lock-state")).toContainText("未锁定");

  const applySuggestion = page.getByTestId("draft-suggestion-apply").first();
  await expect(applySuggestion).toBeEnabled();
  await applySuggestion.click();
  await expect(page.getByText("当前草稿没有硬约束冲突。")).toBeVisible();
  await page.getByTestId("draft-rebalance").click();
  await expect(page.getByText("当前草稿没有硬约束冲突。")).toBeVisible();

  const draftAfterSuggestion = await readDraft(request, createdDraft.draft.id);
  const movingAssignment = draftAfterSuggestion.assignments[0];
  const destination = await findEmptyDestination(request, draftAfterSuggestion.assignments);

  const sourceCell = page.locator(`[data-exam-task-id="${movingAssignment.exam_task_id}"]`);
  const targetCell = page.getByTestId(`draft-cell-${destination.timeSlotId}-${destination.roomId}`);
  await expect(sourceCell).toBeVisible();
  await expect(targetCell).toBeVisible();
  await sourceCell.scrollIntoViewIfNeeded();
  await targetCell.scrollIntoViewIfNeeded();

  const sourceBox = await sourceCell.boundingBox();
  const targetBox = await targetCell.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(async () => {
    const draft = await readDraft(request, createdDraft.draft.id);
    const moved = draft.assignments.find((assignment) => (
      assignment.exam_task_id === movingAssignment.exam_task_id
    ));
    return moved ? `${moved.time_slot_id}/${moved.room_id}` : "";
  }).toBe(`${destination.timeSlotId}/${destination.roomId}`);
});

test("运营台支持异步排考作业和发布通知预览", async ({ page, request }) => {
  await page.goto("/");

  const createJobResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && response.url().endsWith("/api/schedule-jobs")
  ));
  await page.getByTestId("schedule-job-create").click();
  const createJobResponse = await createJobResponsePromise;
  expect(createJobResponse.status()).toBe(202);
  const createdJob = await createJobResponse.json() as { job: { id: string } };
  await expect(page.getByTestId("schedule-job-panel")).toContainText(/queued|running|completed/);

  const completedRunId = await waitForCompletedJob(request, createdJob.job.id);

  const publishResponse = await request.post(`${apiBase}/api/schedule-runs/${completedRunId}/publish`, {
    headers: adminHeaders,
  });
  expect(publishResponse.ok()).toBeTruthy();

  await page.reload();
  await page.getByTestId("published-notification-refresh").click();
  await expect(page.getByTestId("published-notification-list")).toContainText("考试安排已发布");
});

test("草稿锁定可生成增量重排版本并展示稳定性摘要", async ({ page, request }) => {
  const runResponse = await request.post(`${apiBase}/api/schedule-runs`, {
    headers: operatorHeaders,
  });
  expect(runResponse.ok()).toBeTruthy();
  const run = await runResponse.json() as { run: { id: string } };
  const draftResponse = await request.post(`${apiBase}/api/schedule-runs/${run.run.id}/drafts`, {
    headers: operatorHeaders,
  });
  expect(draftResponse.ok()).toBeTruthy();
  const draft = await draftResponse.json() as {
    draft: { id: string };
    assignments: Array<{
      exam_task_id: string;
      room_id: string;
      time_slot_id: string;
      teacher_ids: string[];
    }>;
  };
  const lockedAssignment = draft.assignments[0];

  await page.goto("/");
  await page.getByTestId(`draft-row-${draft.draft.id}`).click();
  await expect(page.locator(`[data-exam-task-id="${lockedAssignment.exam_task_id}"]`)).toBeVisible();
  await page.getByTestId("draft-lock-assignment").click();
  await expect(page.getByTestId("draft-lock-state")).toContainText("已锁定");

  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && response.url().endsWith(`/api/schedule-drafts/${draft.draft.id}/reschedule`)
  ));
  await page.getByTestId("draft-reschedule").click();
  const rescheduleResponse = await responsePromise;
  expect(rescheduleResponse.status()).toBe(201);
  const rescheduled = await rescheduleResponse.json() as {
    sourceDraftId: string;
    result: { assignments: typeof draft.assignments };
    reschedule: {
      frozen_exam_task_ids: string[];
      retained_exam_task_ids: string[];
      changed_exam_task_ids: string[];
    };
  };

  expect(rescheduled.sourceDraftId).toBe(draft.draft.id);
  expect(rescheduled.reschedule.frozen_exam_task_ids).toContain(lockedAssignment.exam_task_id);
  expect(rescheduled.result.assignments.find((assignment) => (
    assignment.exam_task_id === lockedAssignment.exam_task_id
  ))).toEqual(lockedAssignment);
  await expect(page.getByTestId("draft-reschedule-frozen")).toHaveText("1");
  await expect(page.getByTestId("draft-reschedule-summary")).toContainText("保留");
  await expect(page.getByTestId("draft-reschedule-summary")).toContainText("变化");

  const sourceDraft = await readDraft(request, draft.draft.id);
  expect(sourceDraft.lockedExamTaskIds).toContain(lockedAssignment.exam_task_id);
  expect(sourceDraft.assignments.find((assignment) => (
    assignment.exam_task_id === lockedAssignment.exam_task_id
  ))).toEqual(lockedAssignment);
});

async function readDraft(
  request: APIRequestContext,
  draftId: string,
) {
  const response = await request.get(`${apiBase}/api/schedule-drafts/${draftId}`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as {
    assignments: Array<{
      exam_task_id: string;
      room_id: string;
      time_slot_id: string;
      teacher_ids: string[];
    }>;
    lockedExamTaskIds?: string[];
  };
}

async function findEmptyDestination(
  request: APIRequestContext,
  assignments: Array<{ room_id: string; time_slot_id: string }>,
) {
  const response = await request.get(`${apiBase}/api/reference-data`);
  expect(response.ok()).toBeTruthy();
  const referenceData = await response.json() as {
    scheduleInput: {
      rooms: Array<{ id: string }>;
      time_slots: Array<{ id: string }>;
    };
  };
  const occupied = new Set(assignments.map((assignment) => (
    `${assignment.time_slot_id}/${assignment.room_id}`
  )));

  for (const slot of referenceData.scheduleInput.time_slots) {
    for (const room of referenceData.scheduleInput.rooms) {
      if (!occupied.has(`${slot.id}/${room.id}`)) {
        return { timeSlotId: slot.id, roomId: room.id };
      }
    }
  }

  throw new Error("No empty matrix destination is available.");
}

async function waitForCompletedJob(request: APIRequestContext, jobId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const jobResponse = await request.get(`${apiBase}/api/schedule-jobs/${jobId}`);
    expect(jobResponse.ok()).toBeTruthy();
    const payload = await jobResponse.json() as {
      job: { status: string; runId: string | null; error: string | null };
    };
    if (payload.job.status === "completed" && payload.job.runId) {
      return payload.job.runId;
    }
    if (payload.job.status === "failed") {
      throw new Error(`Schedule job ${jobId} failed: ${payload.job.error ?? "unknown error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Schedule job ${jobId} did not complete within 30 seconds.`);
}
