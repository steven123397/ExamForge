import { expect, test, type Page } from "@playwright/test";

const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-2026";
const teacherPassword = process.env.E2E_TEACHER_PASSWORD ?? "e2e-teacher-password-2026";
const studentPassword = process.env.E2E_STUDENT_PASSWORD ?? "e2e-student-password-2026";
const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000";
const webBase = process.env.E2E_WEB_BASE_URL ?? "http://127.0.0.1:3000";

test.beforeEach(async ({ page }) => {
  await publishSchedule(page);
});

test("教师只通过本人接口读取日程并保存不可用时段", async ({ page }) => {
  await login(page, "teacher", teacherPassword);
  await expect(page).toHaveURL(/\/teacher\/schedule$/);
  await expect(page.getByRole("heading", { name: "我的监考" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "张教授" })).toBeVisible();
  await expect(page.getByText("仅展示与当前账号绑定的监考安排。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "不可用时段" })).toBeVisible();

  const checkbox = page.getByRole("checkbox").first();
  const requestPromise = page.waitForRequest((request) => (
    request.method() === "PATCH"
      && request.url() === `${apiBase}/api/me/teacher-unavailable-slots`
  ));
  if (await checkbox.isChecked()) await checkbox.uncheck();
  else await checkbox.check();
  await page.getByRole("button", { name: "保存变更" }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toHaveProperty("unavailable_slot_ids");
  await expect(page.getByRole("button", { name: "保存变更" })).toBeEnabled();

  const arbitraryTeacher = await authenticatedGet(
    page,
    "/api/published-schedule/teachers/t-li",
  );
  expect(arbitraryTeacher.status()).toBe(403);

  await page.goto("/scheduling/jobs");
  await expect(page.getByRole("heading", { name: "无权访问此页面" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "运营导航" })).toHaveCount(0);
});

test("学生只看到所属班级日程且移动端无横向溢出", async ({ page }) => {
  await login(page, "student", studentPassword);
  await expect(page).toHaveURL(/\/student\/schedule$/);
  await expect(page.getByRole("heading", { name: "我的考试" })).toBeVisible();
  await expect(page.getByText("计算机 2301").first()).toBeVisible();
  await expect(page.getByText("监考教师")).toHaveCount(0);
  await expect(page.getByText("约束策略")).toHaveCount(0);
  await expect(page.getByText("内部冲突")).toHaveCount(0);
  await expect(page.getByText("张教授")).toHaveCount(0);

  const arbitraryGroup = await authenticatedGet(
    page,
    "/api/published-schedule/student-groups/g-ai-2301",
  );
  expect(arbitraryGroup.status()).toBe(403);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "我的考试" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.goto("/scheduling/runs");
  await expect(page.getByRole("heading", { name: "无权访问此页面" })).toBeVisible();
});

async function publishSchedule(page: Page) {
  await page.goto("/login");
  await login(page, "admin", adminPassword);
  const created = await authenticatedPost(page, "/api/schedule-runs");
  expect(created.status()).toBe(201);
  const runId = (await created.json()).run.id as string;
  const published = await authenticatedPost(page, `/api/schedule-runs/${runId}/publish`);
  expect(published.status()).toBe(200);
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
}

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 });
}

async function authenticatedPost(page: Page, path: string) {
  return page.request.post(`${apiBase}${path}`, {
    headers: await requestHeaders(page),
  });
}

async function authenticatedGet(page: Page, path: string) {
  return page.request.get(`${apiBase}${path}`, {
    headers: await requestHeaders(page),
  });
}

async function requestHeaders(page: Page) {
  const cookie = (await page.context().cookies())
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
  return { cookie, origin: webBase };
}
