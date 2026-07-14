import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-2026";
const operatorPassword = process.env.E2E_OPERATOR_PASSWORD ?? "e2e-operator-password-2026";
const teacherPassword = process.env.E2E_TEACHER_PASSWORD ?? "e2e-teacher-password-2026";
const studentPassword = process.env.E2E_STUDENT_PASSWORD ?? "e2e-student-password-2026";
const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000";
const webBase = process.env.E2E_WEB_BASE_URL ?? "http://127.0.0.1:3000";

test("登录页通过自动检查并形成桌面基线", async ({ page }, testInfo) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登录工作区" })).toBeVisible();
  await assertPageQuality(page);
  if (testInfo.project.name === "chromium") {
    await prepareScreenshot(page);
    await expect(page).toHaveScreenshot("login-desktop.png", screenshotOptions());
  }
});

test("运营关键页在各视口通过自动检查和溢出检查", async ({ page }, testInfo) => {
  await login(page, "operator", operatorPassword);
  await createRun(page);

  await inspectRoute(page, "/admin/overview", "运行概览");
  if (testInfo.project.name === "chromium") {
    await prepareScreenshot(page);
    await expect(page).toHaveScreenshot("overview-desktop.png", screenshotOptions([
      page.locator(".overview-facts > div:nth-child(4) dd"),
    ]));
  }

  await inspectRoute(
    page,
    "/scheduling/jobs?submittedBy=visual-baseline-does-not-exist",
    "调度任务",
  );
  if (testInfo.project.name === "chromium") {
    await prepareScreenshot(page);
    await expect(page).toHaveScreenshot("jobs-desktop.png", screenshotOptions());
  }

  await inspectRoute(page, "/scheduling/policies", "约束策略");
  const draftId = await createDraft(page);
  await page.route((url) => url.toString() === `${apiBase}/api/schedule-drafts`, async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { drafts: Array<{ id: string }> };
    await route.fulfill({ response, json: {
      ...body,
      drafts: body.drafts.filter((draft) => draft.id === draftId),
    } });
  });
  await inspectRoute(page, `/scheduling/drafts/${draftId}`, "草稿工作区");
  if (testInfo.project.name === "chromium") {
    await prepareScreenshot(page);
    await expect(page).toHaveScreenshot("draft-desktop.png", screenshotOptions([
      page.locator(".draft-create select"),
      page.locator(".draft-row span"),
    ]));
  }
});

test("教师本人页通过自动检查并形成移动基线", async ({ page }, testInfo) => {
  await ensurePublished(page);
  await page.context().clearCookies();
  await login(page, "teacher", teacherPassword);
  await expect(page.getByRole("heading", { name: "我的监考" })).toBeVisible();
  await assertPageQuality(page);
  if (testInfo.project.name === "chromium-mobile") {
    await prepareScreenshot(page);
    await expect(page).toHaveScreenshot("teacher-mobile.png", screenshotOptions([
      page.getByText(/^run-/),
    ]));
  }
});

test("学生本人页通过自动检查并形成移动基线", async ({ page }, testInfo) => {
  await ensurePublished(page);
  await page.context().clearCookies();
  await login(page, "student", studentPassword);
  await expect(page.getByRole("heading", { name: "我的考试" })).toBeVisible();
  await assertPageQuality(page);
  if (testInfo.project.name === "chromium-mobile") {
    await prepareScreenshot(page);
    await expect(page).toHaveScreenshot("student-mobile.png", screenshotOptions([
      page.getByText(/^run-/),
    ]));
  }
});

test("200% 文本、403、404 和依赖失败状态不遮挡", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "状态专项只需在主 Chromium 项目执行");
  await login(page, "teacher", teacherPassword);
  await page.goto("/scheduling/jobs");
  await expect(page.getByRole("heading", { name: "无权访问此页面" })).toBeVisible();
  await assertPageQuality(page);

  await page.goto("/route-does-not-exist");
  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  await assertPageQuality(page);

  await page.context().clearCookies();
  await login(page, "operator", operatorPassword);
  await page.route(`${apiBase}/api/dashboard`, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "dependency_unavailable" }),
  }));
  await page.goto("/admin/overview");
  await expect(page.getByText("概览数据读取失败")).toBeVisible();
  await assertPageQuality(page);

  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await assertNoPageOverflow(page);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toBeVisible();
});

async function inspectRoute(page: Page, path: string, heading: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  if (path.startsWith("/scheduling/drafts/")) {
    await expect(page).toHaveURL(/[?&]examTaskId=[^&]+/);
  }
  await expect.poll(() => page.title()).not.toBe("");
  await assertPageQuality(page);
}

async function assertPageQuality(page: Page) {
  await assertNoPageOverflow(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    results.violations,
    JSON.stringify(results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    })), null, 2),
  ).toEqual([]);
}

async function assertNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 12)
      .map((element) => ({
        className: element.className,
        tag: element.tagName,
        right: Math.round(element.getBoundingClientRect().right),
        width: Math.round(element.getBoundingClientRect().width),
      })),
  }));
  const evidence = JSON.stringify(dimensions);
  expect(dimensions.documentScrollWidth, evidence).toBeLessThanOrEqual(dimensions.documentClientWidth);
  expect(dimensions.bodyScrollWidth, evidence).toBeLessThanOrEqual(dimensions.bodyClientWidth);
}

async function ensurePublished(page: Page) {
  await login(page, "admin", adminPassword);
  const created = await authenticatedPost(page, "/api/schedule-runs");
  expect(created.status()).toBe(201);
  const runId = (await created.json()).run.id as string;
  const published = await authenticatedPost(page, `/api/schedule-runs/${runId}/publish`);
  expect(published.status()).toBe(200);
}

async function createDraft(page: Page) {
  const runId = await createRun(page);
  const response = await authenticatedPost(page, `/api/schedule-runs/${runId}/drafts`);
  expect(response.status()).toBe(201);
  return (await response.json()).draft.id as string;
}

async function createRun(page: Page) {
  const created = await authenticatedPost(page, "/api/schedule-runs");
  expect(created.status()).toBe(201);
  return (await created.json()).run.id as string;
}

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 });
}

async function authenticatedPost(page: Page, path: string) {
  const cookie = (await page.context().cookies())
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
  return page.request.post(`${apiBase}${path}`, {
    headers: { cookie, origin: webBase },
  });
}

function screenshotOptions(mask: ReturnType<Page["locator"]>[] = []) {
  return {
    fullPage: true,
    animations: "disabled" as const,
    caret: "hide" as const,
    mask,
    maskColor: "#d4dbd7",
    maxDiffPixelRatio: 0.01,
  };
}

async function prepareScreenshot(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}
