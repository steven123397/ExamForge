import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000";
const webBase = process.env.E2E_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const credentials = {
  admin: process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-2026",
  operator: process.env.E2E_OPERATOR_PASSWORD ?? "e2e-operator-password-2026",
  teacher: process.env.E2E_TEACHER_PASSWORD ?? "e2e-teacher-password-2026",
  student: process.env.E2E_STUDENT_PASSWORD ?? "e2e-student-password-2026",
};
const mutationHeaders = { origin: webBase };

test.beforeEach(async ({ page, request }) => {
  await loginRequest(request, "admin", credentials.admin);
  await loginPage(page, "admin", credentials.admin);
});

for (const scenario of [
  {
    name: "运行历史",
    route: "**/api/schedule-runs",
    panelTestId: "run-history-panel",
    emptyText: "运行排考后展示历史版本。",
  },
  {
    name: "审计历史",
    route: "**/api/audit-events",
    panelTestId: "audit-events-panel",
    emptyText: "暂无审计事件。",
  },
  {
    name: "草稿历史",
    route: "**/api/schedule-drafts",
    panelTestId: "schedule-draft-workspace",
    emptyText: "从运行历史创建草稿后开始人工调整。",
  },
  {
    name: "异步作业历史",
    route: "**/api/schedule-jobs",
    panelTestId: "schedule-job-panel",
    emptyText: "后台作业会显示队列、运行进度和生成的运行版本。",
  },
]) {
  test(`${scenario.name}读取失败显示独立错误并可重试`, async ({ page }) => {
    let shouldFail = true;
    await page.route(scenario.route, async (route) => {
      if (shouldFail) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "injected_history_failure" }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/");
    const panel = page.getByTestId(scenario.panelTestId);
    await expect(panel.getByRole("alert")).toContainText("读取失败");
    await expect(panel.getByText(scenario.emptyText)).toHaveCount(0);
    await expect(page.getByTestId("reference-data-manager")).toBeVisible();

    shouldFail = false;
    await panel.getByRole("button", { name: "重试" }).click();
    await expect(panel.getByRole("alert")).toHaveCount(0);
  });
}

test("发布运行要求确认并防止重复提交", async ({ page, request }) => {
  const runId = await createScheduleRun(request);
  let publishRequests = 0;
  await page.route(`**/api/schedule-runs/${runId}/publish`, async (route) => {
    publishRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });

  await page.goto("/");
  const trigger = page.locator(".history-list article").first().getByRole("button", { name: "发布" });
  await trigger.click();
  await page.waitForTimeout(100);
  expect(publishRequests).toBe(0);
  const dialog = page.getByRole("alertdialog", { name: "确认发布排考运行" });
  await expect(dialog).toContainText(runId);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(publishRequests).toBe(0);

  await trigger.click();
  const confirm = page.getByTestId("confirmation-confirm");
  await confirm.click();
  await expect(confirm).toBeDisabled();
  await confirm.click({ force: true });
  await expect(dialog).toHaveCount(0);
  expect(publishRequests).toBe(1);
});

test("回滚发布首次点击只打开确认", async ({ page, request }) => {
  const runId = await createScheduleRun(request);
  const publishResponse = await request.post(`${apiBase}/api/schedule-runs/${runId}/publish`, {
    headers: mutationHeaders,
  });
  expect(publishResponse.ok()).toBeTruthy();
  let rollbackRequests = 0;
  await page.route("**/api/published-schedule/rollback", async (route) => {
    rollbackRequests += 1;
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: "回滚发布" }).click();
  await page.waitForTimeout(100);
  expect(rollbackRequests).toBe(0);
  const dialog = page.getByRole("alertdialog", { name: "确认回滚发布" });
  await expect(dialog).toContainText(runId);
  await dialog.getByRole("button", { name: "取消" }).click();
  expect(rollbackRequests).toBe(0);
});

test("废弃草稿首次点击只打开确认", async ({ page, request }) => {
  const runId = await createScheduleRun(request);
  const draftResponse = await request.post(`${apiBase}/api/schedule-runs/${runId}/drafts`, {
    headers: mutationHeaders,
  });
  expect(draftResponse.ok()).toBeTruthy();
  const draft = await draftResponse.json() as { draft: { id: string } };
  let discardRequests = 0;
  await page.route(`**/api/schedule-drafts/${draft.draft.id}/discard`, async (route) => {
    discardRequests += 1;
    await route.continue();
  });

  await page.goto("/");
  await page.getByTestId(`draft-row-${draft.draft.id}`).click();
  await page.getByRole("button", { name: "废弃草稿" }).click();
  await page.waitForTimeout(100);
  expect(discardRequests).toBe(0);
  const dialog = page.getByRole("alertdialog", { name: "确认废弃草稿" });
  await expect(dialog).toContainText(draft.draft.id);
  await dialog.getByRole("button", { name: "取消" }).click();
  expect(discardRequests).toBe(0);
});

test("删除基础数据首次点击只打开确认", async ({ page, request }) => {
  const referenceResponse = await request.get(`${apiBase}/api/reference-data`, {
    headers: mutationHeaders,
  });
  const referenceData = await referenceResponse.json() as {
    scheduleInput: { courses: Array<{ id: string }> };
  };
  const courseId = referenceData.scheduleInput.courses[0].id;
  let deleteRequests = 0;
  await page.route(`**/api/reference-data/courses/${courseId}`, async (route) => {
    if (route.request().method() === "DELETE") {
      deleteRequests += 1;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByTestId("reference-data-manager").getByRole("button", { name: "删除" }).click();
  await page.waitForTimeout(100);
  expect(deleteRequests).toBe(0);
  const dialog = page.getByRole("alertdialog", { name: "确认删除基础数据" });
  await expect(dialog).toContainText(courseId);
  await dialog.getByRole("button", { name: "取消" }).click();
  expect(deleteRequests).toBe(0);
});

test("草稿矩阵使用表格语义且异步错误可播报", async ({ page, request }) => {
  const runId = await createScheduleRun(request);
  const draftResponse = await request.post(`${apiBase}/api/schedule-runs/${runId}/drafts`, {
    headers: mutationHeaders,
  });
  const draft = await draftResponse.json() as {
    draft: { id: string };
    assignments: Array<{ exam_task_id: string }>;
  };
  const referenceResponse = await request.get(`${apiBase}/api/reference-data`, {
    headers: mutationHeaders,
  });
  const referenceData = await referenceResponse.json() as {
    scheduleInput: {
      rooms: Array<{ id: string }>;
      time_slots: Array<{ id: string }>;
    };
  };

  await page.goto("/");
  await page.getByTestId(`draft-row-${draft.draft.id}`).click();
  await expect(page.getByRole("grid", { name: "排考草稿矩阵" })).toHaveCount(0);
  const table = page.getByRole("table", { name: "排考草稿矩阵" });
  await expect(table.getByRole("columnheader")).toHaveCount(referenceData.scheduleInput.rooms.length + 1);
  await expect(table.getByRole("rowheader")).toHaveCount(referenceData.scheduleInput.time_slots.length);
  await expect(table.getByRole("cell")).toHaveCount(
    referenceData.scheduleInput.rooms.length * referenceData.scheduleInput.time_slots.length,
  );

  const assignmentButton = table.locator(`[data-exam-task-id="${draft.assignments[0].exam_task_id}"]`);
  await assignmentButton.focus();
  await assignmentButton.press("Enter");
  await expect(page.locator(".inspector-title strong")).toHaveText(draft.assignments[0].exam_task_id);

  for (const viewport of [
    { width: 1600, height: 1000 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBeTruthy();
  }

  await page.route("**/api/dashboard", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "injected_dashboard_failure" }),
  }));
  await page.reload();
  const globalError = page.locator(".workspace > .alert");
  await expect(globalError).toHaveAttribute("role", "alert");
  await expect(globalError).toHaveAttribute("aria-live", "polite");
});

test("内部运营读取要求认证且公开发布查询保持匿名", async () => {
  const request = await playwrightRequest.newContext();
  try {
  for (const requestOptions of [
    {},
    { headers: { authorization: "Bearer forged-token" } },
  ]) {
    const response = await request.get(`${apiBase}/api/dashboard`, requestOptions);
    expect(response.status()).toBe(401);
    expect(await response.json()).toMatchObject({ error: "not_authenticated" });
  }

  const publicResponse = await request.get(`${apiBase}/api/published-schedule`);
  expect(publicResponse.status()).not.toBe(401);
  } finally {
    await request.dispose();
  }
});

test("错误密码、退出登录和会话失效都会返回登录界面", async ({ page, context }) => {
  await page.getByTitle("退出登录").click();
  await expect(page.getByRole("heading", { name: "登录排考运营台" })).toBeVisible();

  await page.getByLabel("用户名").fill("admin");
  await page.getByLabel("密码").fill("wrong-password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.locator(".login-form").getByRole("alert"))
    .toContainText("用户名或密码错误");

  await page.getByLabel("密码").fill(credentials.admin);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByTestId("session-user")).toContainText("admin");

  await context.clearCookies();
  await page.reload();
  await expect(page.getByRole("heading", { name: "登录排考运营台" })).toBeVisible();
});

test("operator 可执行排考，teacher 和 student 的写请求被拒绝", async () => {
  for (const [role, expectedStatus] of [
    ["operator", 201],
    ["teacher", 403],
    ["student", 403],
  ] as const) {
    const request = await playwrightRequest.newContext();
    try {
      await loginRequest(request, role, credentials[role]);
      const response = await request.post(`${apiBase}/api/schedule-runs`, {
        headers: mutationHeaders,
      });
      expect(response.status()).toBe(expectedStatus);
    } finally {
      await request.dispose();
    }
  }
});

test("teacher 登录后只显示已发布查询门户", async ({ page }) => {
  await page.getByTitle("退出登录").click();
  await loginPage(page, "teacher", credentials.teacher, false);

  await expect(page.getByText("Published schedule portal")).toBeVisible();
  await expect(page.getByRole("button", { name: "运行排考" })).toHaveCount(0);
  await expect(page.getByTestId("reference-data-manager")).toHaveCount(0);
});

test("草稿建议乱序响应不会覆盖当前考试上下文", async ({ page, request }) => {
  const runResponse = await request.post(`${apiBase}/api/schedule-runs`, {
    headers: mutationHeaders,
  });
  const run = await runResponse.json() as { run: { id: string } };
  const draftResponse = await request.post(`${apiBase}/api/schedule-runs/${run.run.id}/drafts`, {
    headers: mutationHeaders,
  });
  const draft = await draftResponse.json() as {
    draft: { id: string };
    assignments: Array<{ exam_task_id: string }>;
  };
  const [firstAssignment, secondAssignment] = draft.assignments;

  await page.route("**/api/schedule-drafts/*/assignments/*/suggestions", async (route) => {
    const response = await route.fetch();
    if (route.request().url().includes(`/assignments/${firstAssignment.exam_task_id}/`)) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    await route.fulfill({ response });
  });

  await page.goto("/");
  const firstSuggestionRequest = page.waitForRequest((pending) => (
    pending.url().includes(`/assignments/${firstAssignment.exam_task_id}/suggestions`)
  ));
  await page.getByTestId(`draft-row-${draft.draft.id}`).click();
  await firstSuggestionRequest;

  const secondSuggestionResponse = page.waitForResponse((response) => (
    response.url().includes(`/assignments/${secondAssignment.exam_task_id}/suggestions`)
  ));
  await page.locator(`[data-exam-task-id="${secondAssignment.exam_task_id}"]`).click();
  await secondSuggestionResponse;
  await page.waitForResponse((response) => (
    response.url().includes(`/assignments/${firstAssignment.exam_task_id}/suggestions`)
  ));
  await expect(page.locator(".inspector-title strong")).toHaveText(secondAssignment.exam_task_id);

  const updateRequest = page.waitForRequest((pending) => (
    pending.method() === "PATCH"
      && pending.url().includes(`/api/schedule-drafts/${draft.draft.id}/assignments/`)
  ));
  await page.getByTestId("draft-suggestion-apply").first().click();
  const appliedRequest = await updateRequest;
  expect(appliedRequest.url()).toContain(
    `/assignments/${secondAssignment.exam_task_id}`,
  );
  expect((await appliedRequest.response())?.ok()).toBeTruthy();

  const publishResponse = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && response.url().endsWith(`/api/schedule-drafts/${draft.draft.id}/publish`)
  ));
  await page.getByRole("button", { name: "发布草稿" }).click();
  await page.getByRole("alertdialog", { name: "确认发布草稿" })
    .getByRole("button", { name: "确认发布" })
    .click();
  expect((await publishResponse).ok()).toBeTruthy();
  await expect(page.getByTestId("draft-suggestion-apply")).toHaveCount(0);
});

test("方案工作台支持建议应用和矩阵拖拽调整", async ({ page, request }) => {
  const runResponse = await request.post(`${apiBase}/api/schedule-runs`, {
    headers: mutationHeaders,
  });
  expect(runResponse.ok()).toBeTruthy();
  const run = await runResponse.json() as { run: { id: string } };

  const draftResponse = await request.post(`${apiBase}/api/schedule-runs/${run.run.id}/drafts`, {
    headers: mutationHeaders,
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
  await expect(page.getByTestId("schedule-job-panel")).toContainText(/queued|running|succeeded/);

  const completedRunId = await waitForCompletedJob(request, createdJob.job.id);

  const publishResponse = await request.post(`${apiBase}/api/schedule-runs/${completedRunId}/publish`, {
    headers: mutationHeaders,
  });
  expect(publishResponse.ok()).toBeTruthy();

  await page.reload();
  await page.getByTestId("published-notification-refresh").click();
  await expect(page.getByTestId("published-notification-list")).toContainText("考试安排已发布");
});

test("草稿锁定可生成增量重排版本并展示稳定性摘要", async ({ page, request }) => {
  const runResponse = await request.post(`${apiBase}/api/schedule-runs`, {
    headers: mutationHeaders,
  });
  expect(runResponse.ok()).toBeTruthy();
  const run = await runResponse.json() as { run: { id: string } };
  const draftResponse = await request.post(`${apiBase}/api/schedule-runs/${run.run.id}/drafts`, {
    headers: mutationHeaders,
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
  const response = await request.get(`${apiBase}/api/schedule-drafts/${draftId}`, {
    headers: mutationHeaders,
  });
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
  const response = await request.get(`${apiBase}/api/reference-data`, {
    headers: mutationHeaders,
  });
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
    const jobResponse = await request.get(`${apiBase}/api/schedule-jobs/${jobId}`, {
      headers: mutationHeaders,
    });
    expect(jobResponse.ok()).toBeTruthy();
    const payload = await jobResponse.json() as {
      job: { status: string; runId: string | null; error: { message: string } | null };
    };
    if (payload.job.status === "succeeded" && payload.job.runId) {
      return payload.job.runId;
    }
    if (payload.job.status === "failed") {
      throw new Error(`Schedule job ${jobId} failed: ${payload.job.error?.message ?? "unknown error"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Schedule job ${jobId} did not complete within 30 seconds.`);
}

async function createScheduleRun(request: APIRequestContext) {
  const response = await request.post(`${apiBase}/api/schedule-runs`, {
    headers: mutationHeaders,
  });
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { run: { id: string } };
  return payload.run.id;
}

async function loginRequest(
  request: APIRequestContext,
  username: string,
  password: string,
) {
  const response = await request.post(`${apiBase}/api/auth/login`, {
    headers: {
      ...mutationHeaders,
      "content-type": "application/json",
    },
    data: { username, password },
  });
  expect(response.ok()).toBeTruthy();
}

async function loginPage(
  page: Page,
  username: string,
  password: string,
  navigate = true,
) {
  if (navigate) {
    await page.goto("/");
  }
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByTestId("session-user")).toBeVisible();
}
