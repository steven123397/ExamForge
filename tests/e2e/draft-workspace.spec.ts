import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000";
const webBase = process.env.E2E_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-2026";
const mutationHeaders = { origin: webBase };

test.beforeEach(async ({ page, request }) => {
  await loginRequest(request);
  await page.goto("/login");
  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill(adminPassword);
  const loginResponse = page.waitForResponse((response) => (
    response.request().method() === "POST" && response.url().endsWith("/api/auth/login")
  ));
  await page.getByRole("button", { name: "登录" }).click();
  expect((await loginResponse).status()).toBe(200);
  await page.goto("/admin/overview");
  await expect(page.getByTestId("session-user")).toBeVisible();
});

test("草稿深链刷新和后退保留检查器并支持 pointer drag", async ({ page, request }) => {
  const created = await createDraft(request);
  const selected = created.assignments[0];
  await page.goto(`/scheduling/drafts/${created.draft.id}?examTaskId=${selected.exam_task_id}`);
  await expect(page.getByTestId("schedule-draft-workspace")).toBeVisible();
  await expect(page.locator(".inspector-title strong")).toHaveText(selected.exam_task_id);
  await page.reload();
  await expect(page.locator(".inspector-title strong")).toHaveText(selected.exam_task_id);

  await page.goto(`/scheduling/runs?runId=${created.draft.sourceRunId}`);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/scheduling/drafts/${created.draft.id}`));

  const latest = await readDraft(request, created.draft.id);
  const moving = latest.assignments[0];
  const destination = await findEmptyDestination(request, latest.assignments);
  const source = page.locator(`[data-exam-task-id="${moving.exam_task_id}"]`);
  const target = page.getByTestId(`draft-cell-${destination.timeSlotId}-${destination.roomId}`);
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect.poll(async () => assignmentPosition(request, created.draft.id, moving.exam_task_id))
    .toBe(`${destination.timeSlotId}/${destination.roomId}`);
});

test("键盘拖拽与检查器表单等价且锁定后禁止调整", async ({ page, request }) => {
  const created = await createDraft(request);
  const reference = await readReferenceData(request);
  const keyboardMove = findAdjacentEmpty(created.assignments, reference);
  expect(keyboardMove).not.toBeNull();
  await page.goto(`/scheduling/drafts/${created.draft.id}?examTaskId=${keyboardMove!.assignment.exam_task_id}`);

  const source = page.locator(`[data-exam-task-id="${keyboardMove!.assignment.exam_task_id}"]`);
  await source.focus();
  await expect(source).toHaveAttribute("aria-disabled", "false");
  await page.keyboard.press("Space");
  await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText(/\S/);
  const keyboardTarget = page.getByTestId(
    `draft-cell-${keyboardMove!.destination.timeSlotId}-${keyboardMove!.destination.roomId}`,
  );
  const targetLabel = (await keyboardTarget.getAttribute("aria-label"))?.replace(/ 空考位$/, "");
  expect(targetLabel).toBeTruthy();
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press(keyboardMove!.key);
    if ((await page.locator('[id^="DndLiveRegion"]').textContent())?.includes(targetLabel!)) {
      break;
    }
  }
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(targetLabel!);
  await page.keyboard.press("Space");
  await expect.poll(async () => assignmentPosition(
    request,
    created.draft.id,
    keyboardMove!.assignment.exam_task_id,
  )).toBe(`${keyboardMove!.destination.timeSlotId}/${keyboardMove!.destination.roomId}`);

  const latest = await readDraft(request, created.draft.id);
  const selected = latest.assignments.find((item) => item.exam_task_id === keyboardMove!.assignment.exam_task_id)!;
  const formDestination = await findEmptyDestination(request, latest.assignments);
  await page.getByLabel("时间段").selectOption(formDestination.timeSlotId);
  await page.getByLabel("考场").selectOption(formDestination.roomId);
  await page.getByRole("button", { name: "保存调整并校验" }).click();
  await expect.poll(async () => assignmentPosition(request, created.draft.id, selected.exam_task_id))
    .toBe(`${formDestination.timeSlotId}/${formDestination.roomId}`);

  await page.getByTestId("draft-lock-assignment").click();
  await expect(page.getByTestId("draft-lock-state")).toContainText("已锁定");
  await expect(page.getByRole("button", { name: "保存调整并校验" })).toBeDisabled();
  await expect(source).toHaveAttribute("aria-disabled", "true");
});

test("终态草稿禁用 mutation 且移动端默认使用无溢出列表", async ({ page, request }) => {
  const created = await createDraft(request);
  await page.goto(`/scheduling/drafts/${created.draft.id}?examTaskId=${created.assignments[0].exam_task_id}`);
  await page.getByRole("button", { name: "废弃草稿" }).click();
  await page.getByRole("alertdialog", { name: "确认废弃草稿" })
    .getByRole("button", { name: "确认废弃" })
    .click();
  await expect(page.getByRole("button", { name: "保存调整并校验" })).toBeDisabled();
  await expect(page.getByTestId("draft-rebalance")).toBeDisabled();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(250);
  await expect(page.locator(".draft-assignment-list")).toBeVisible();
  await expect(page.getByRole("table", { name: "排考草稿矩阵" })).toBeHidden();
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBeTruthy();
  await page.getByLabel("仅看冲突").click();
  await expect(page).toHaveURL(/conflict=conflicted/);
});

test("乱序建议保持当前考试代次且草稿发布要求确认", async ({ page, request }) => {
  const created = await createDraft(request);
  const [first, second] = created.assignments;
  await page.route("**/api/schedule-drafts/*/assignments/*/suggestions", async (route) => {
    const response = await route.fetch();
    if (route.request().url().includes(`/assignments/${first.exam_task_id}/`)) {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.fulfill({ response });
  });

  await page.goto(`/scheduling/drafts/${created.draft.id}?examTaskId=${first.exam_task_id}`);
  const firstResponse = page.waitForResponse((response) => (
    response.url().includes(`/assignments/${first.exam_task_id}/suggestions`)
  ));
  await page.locator(`[data-exam-task-id="${second.exam_task_id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`examTaskId=${second.exam_task_id}`));
  await expect(page.getByTestId("draft-suggestion-apply").first()).toBeEnabled();
  await firstResponse;
  await expect(page.locator(".inspector-title strong")).toHaveText(second.exam_task_id);

  const updateRequest = page.waitForRequest((pending) => (
    pending.method() === "PATCH"
      && pending.url().includes(`/api/schedule-drafts/${created.draft.id}/assignments/`)
  ));
  await page.getByTestId("draft-suggestion-apply").first().click();
  expect((await updateRequest).url()).toContain(`/assignments/${second.exam_task_id}`);

  let publishRequests = 0;
  await page.route(`**/api/schedule-drafts/${created.draft.id}/publish`, async (route) => {
    publishRequests += 1;
    await route.continue();
  });
  const publishButton = page.getByRole("button", { name: "发布草稿" });
  await expect(publishButton).toBeEnabled();
  await publishButton.click();
  expect(publishRequests).toBe(0);
  const dialog = page.getByRole("alertdialog", { name: "确认发布草稿" });
  await expect(dialog).toContainText(created.draft.id);
  await dialog.getByRole("button", { name: "确认发布" }).click();
  await expect(dialog).toHaveCount(0);
  expect(publishRequests).toBe(1);
});

async function createDraft(request: APIRequestContext) {
  const runResponse = await request.post(`${apiBase}/api/schedule-runs`, { headers: mutationHeaders });
  expect(runResponse.status()).toBe(201);
  const run = await runResponse.json() as { run: { id: string } };
  const response = await request.post(`${apiBase}/api/schedule-runs/${run.run.id}/drafts`, {
    headers: mutationHeaders,
  });
  expect(response.status()).toBe(201);
  return await response.json() as DraftPayload;
}

async function loginRequest(request: APIRequestContext) {
  const response = await request.post(`${apiBase}/api/auth/login`, {
    headers: { ...mutationHeaders, "content-type": "application/json" },
    data: { username: "admin", password: adminPassword },
  });
  expect(response.ok()).toBeTruthy();
}

async function readDraft(request: APIRequestContext, draftId: string) {
  const response = await request.get(`${apiBase}/api/schedule-drafts/${draftId}`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as DraftPayload;
}

async function assignmentPosition(request: APIRequestContext, draftId: string, examTaskId: string) {
  const draft = await readDraft(request, draftId);
  const assignment = draft.assignments.find((item) => item.exam_task_id === examTaskId);
  return assignment ? `${assignment.time_slot_id}/${assignment.room_id}` : "";
}

async function readReferenceData(request: APIRequestContext) {
  const response = await request.get(`${apiBase}/api/reference-data`);
  expect(response.ok()).toBeTruthy();
  return await response.json() as {
    scheduleInput: {
      rooms: Array<{ id: string }>;
      time_slots: Array<{ id: string }>;
    };
  };
}

async function findEmptyDestination(
  request: APIRequestContext,
  assignments: DraftPayload["assignments"],
) {
  const reference = await readReferenceData(request);
  const occupied = new Set(assignments.map((item) => `${item.time_slot_id}/${item.room_id}`));
  for (const slot of reference.scheduleInput.time_slots) {
    for (const room of reference.scheduleInput.rooms) {
      if (!occupied.has(`${slot.id}/${room.id}`)) {
        return { timeSlotId: slot.id, roomId: room.id };
      }
    }
  }
  throw new Error("No empty draft destination is available.");
}

function findAdjacentEmpty(
  assignments: DraftPayload["assignments"],
  reference: Awaited<ReturnType<typeof readReferenceData>>,
) {
  const rooms = reference.scheduleInput.rooms;
  const slots = reference.scheduleInput.time_slots;
  const occupied = new Set(assignments.map((item) => `${item.time_slot_id}/${item.room_id}`));
  for (const assignment of assignments) {
    const roomIndex = rooms.findIndex((room) => room.id === assignment.room_id);
    const slotIndex = slots.findIndex((slot) => slot.id === assignment.time_slot_id);
    for (const candidate of [
      { key: "ArrowRight", roomIndex: roomIndex + 1, slotIndex },
      { key: "ArrowLeft", roomIndex: roomIndex - 1, slotIndex },
      { key: "ArrowDown", roomIndex, slotIndex: slotIndex + 1 },
      { key: "ArrowUp", roomIndex, slotIndex: slotIndex - 1 },
    ]) {
      const room = rooms[candidate.roomIndex];
      const slot = slots[candidate.slotIndex];
      if (room && slot && !occupied.has(`${slot.id}/${room.id}`)) {
        return {
          assignment,
          key: candidate.key,
          destination: { roomId: room.id, timeSlotId: slot.id },
        };
      }
    }
  }
  return null;
}

interface DraftPayload {
  draft: { id: string; sourceRunId: string };
  assignments: Array<{
    exam_task_id: string;
    room_id: string;
    time_slot_id: string;
    teacher_ids: string[];
  }>;
}
