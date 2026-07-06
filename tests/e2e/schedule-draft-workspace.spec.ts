import { expect, test, type APIRequestContext } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000";

test("方案工作台支持建议应用和矩阵拖拽调整", async ({ page, request }) => {
  const runResponse = await request.post(`${apiBase}/api/schedule-runs`);
  expect(runResponse.ok()).toBeTruthy();
  const run = await runResponse.json() as { run: { id: string } };

  const draftResponse = await request.post(`${apiBase}/api/schedule-runs/${run.run.id}/drafts`);
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

  const applySuggestion = page.getByTestId("draft-suggestion-apply").first();
  await expect(applySuggestion).toBeEnabled();
  await applySuggestion.click();
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

async function readDraft(
  request: APIRequestContext,
  draftId: string,
) {
  const response = await request.get(`${apiBase}/api/schedule-drafts/${draftId}`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as {
    assignments: Array<{ exam_task_id: string; room_id: string; time_slot_id: string }>;
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
