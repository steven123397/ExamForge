import { expect, test, type Page } from "@playwright/test";

const operatorPassword = process.env.E2E_OPERATOR_PASSWORD ?? "e2e-operator-password-2026";
const teacherPassword = process.env.E2E_TEACHER_PASSWORD ?? "e2e-teacher-password-2026";

test("匿名深链登录后回到真实任务路由并可刷新", async ({ page }) => {
  await page.goto("/scheduling/jobs?status=queued&pageSize=50");
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await login(page, "operator", operatorPassword);
  await expect(page).toHaveURL(/\/scheduling\/jobs\?status=queued&pageSize=50$/);
  await expect(page.getByRole("heading", { name: "调度任务" })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/scheduling\/jobs\?status=queued&pageSize=50$/);
  await expect(page.getByRole("navigation", { name: "运营导航" })).toBeVisible();
});

test("错误角色深链显示 403 而不是运营数据", async ({ page }) => {
  await page.goto("/login");
  await login(page, "teacher", teacherPassword);
  await page.goto("/scheduling/jobs");
  await expect(page.getByRole("heading", { name: "无权访问此页面" })).toBeVisible();
  await expect(page.getByText("403")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "运营导航" })).toHaveCount(0);
});

test("未知路由显示页面级 404", async ({ page }) => {
  await page.goto("/route-does-not-exist");
  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  await expect(page.getByText("404")).toBeVisible();
});

async function login(page: Page, username: string, password: string) {
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 15_000 });
}
