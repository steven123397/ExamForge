import { expect, test, type Page } from "@playwright/test";

const operatorPassword = process.env.E2E_OPERATOR_PASSWORD ?? "e2e-operator-password-2026";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-2026";
const apiBase = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000";
const webBase = process.env.E2E_WEB_BASE_URL ?? "http://127.0.0.1:3000";

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await login(page, "operator", operatorPassword);
});

test("概览展示当前批次真实指标并进入任务中心", async ({ page }) => {
  await page.goto("/admin/overview");
  await expect(page.getByRole("heading", { name: "运行概览" })).toBeVisible();
  await expect(page.getByText("考试任务").first()).toBeVisible();
  await expect(page.getByText("6", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "进入任务中心" }).click();
  await expect(page).toHaveURL(/\/scheduling\/jobs$/);
});

test("基础数据刷新保留资源和选中记录且排考员没有删除命令", async ({ page }) => {
  await page.goto("/admin/reference-data?resource=teachers&id=t-zhang");
  await expect(page.getByRole("heading", { name: "基础数据" })).toBeVisible();
  await expect(page.getByRole("button", { name: /张教授/ })).toHaveClass(/active/);
  await expect(page.getByRole("button", { name: "删除" })).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(/resource=teachers&id=t-zhang/);
  await expect(page.getByRole("button", { name: /张教授/ })).toHaveClass(/active/);
  await page.getByRole("button", { name: "考场" }).click();
  await expect(page).toHaveURL(/resource=rooms/);
  await expect(page).not.toHaveURL(/id=t-zhang/);
});

test("任务中心以服务端筛选分页并保留选中任务深链", async ({ page }) => {
  await page.goto("/scheduling/jobs");
  await expect(page.getByRole("heading", { name: "调度任务" })).toBeVisible();
  await expect(page.getByTestId("schedule-job-panel")).toBeVisible();

  await page.getByLabel("按状态筛选").selectOption("queued");
  await expect(page).toHaveURL(/status=queued/);
  await page.reload();
  await expect(page.getByLabel("按状态筛选")).toHaveValue("queued");
  await page.getByLabel("每页条数").selectOption("50");
  await expect(page).toHaveURL(/pageSize=50/);
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(page).not.toHaveURL(/status=queued/);

  await page.getByTestId("schedule-job-create").click();
  await expect(page).toHaveURL(/jobId=/);
  await expect(page.getByText(/条 · 第 \d+\/\d+ 页/)).toBeVisible();
});

test("策略治理对排考员只读并向管理员开放版本命令", async ({ page }) => {
  await page.goto("/scheduling/policies");
  await expect(page.getByRole("heading", { name: "约束策略" })).toBeVisible();
  await expect(page.getByTestId("constraint-profile-panel")).toBeVisible();
  await expect(page).toHaveURL(/versionId=/);
  await expect(page.getByRole("button", { name: "新建策略" })).toHaveCount(0);

  await page.getByRole("button", { name: "退出登录" }).click();
  await login(page, "admin", adminPassword);
  await page.goto("/scheduling/policies");
  await expect(page.getByRole("button", { name: "新建策略" })).toBeVisible();
});

test("运行深链保留筛选和对比并将不存在实体交给 404", async ({ page }) => {
  for (let index = 0; index < 2; index += 1) {
    expect((await createRun(page)).status()).toBe(201);
  }

  await page.goto("/scheduling/runs");
  await expect(page.getByRole("heading", { name: "运行历史" })).toBeVisible();
  const runLinks = page.getByRole("link", { name: "查看" });
  expect(await runLinks.count()).toBeGreaterThanOrEqual(2);
  await runLinks.first().click();
  await expect(page).toHaveURL(/runId=/);

  const compareOptions = page.getByLabel("选择对比运行").locator("option:not([value=''])");
  const compareId = await compareOptions.first().getAttribute("value");
  expect(compareId).toBeTruthy();
  await page.getByLabel("选择对比运行").selectOption(compareId!);
  await expect(page).toHaveURL(/compareTo=/);
  await expect(page.getByLabel("运行对比")).toBeVisible();

  await page.getByLabel("按运行状态筛选").selectOption("feasible");
  await expect(page).toHaveURL(/status=feasible/);
  await page.reload();
  await expect(page.getByLabel("按运行状态筛选")).toHaveValue("feasible");

  await page.goto("/scheduling/runs?runId=run-does-not-exist");
  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
});

test("审计深链筛选可展开 payload 并可往返运行", async ({ page }) => {
  await page.getByRole("button", { name: "退出登录" }).click();
  await login(page, "admin", adminPassword);
  expect((await createRun(page)).status()).toBe(201);
  await page.goto("/audit?action=schedule_run.created&actor=admin");
  await expect(page.getByRole("heading", { name: "审计追踪" })).toBeVisible();
  await expect(page.getByTestId("audit-events-panel")).toBeVisible();
  await page.getByText("原始 payload").first().click();
  await expect(page.locator("pre").first()).toBeVisible();

  await page.getByRole("link", { name: "打开运行" }).first().click();
  await expect(page).toHaveURL(/\/scheduling\/runs\?runId=/);
  await page.goBack();
  await expect(page).toHaveURL(/\/audit\?action=schedule_run.created&actor=admin/);
  await expect(page.getByLabel("审计动作")).toHaveValue("schedule_run.created");
});

async function login(page: Page, username: string, password: string) {
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

async function createRun(page: Page) {
  const cookie = (await page.context().cookies())
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
  return page.request.post(`${apiBase}/api/schedule-runs`, {
    headers: {
      cookie,
      origin: webBase,
    },
  });
}
