import { defineConfig, devices } from "@playwright/test";

const useExternalServices = process.env.E2E_EXTERNAL_SERVICES === "1";
const reuseExistingServers = process.env.E2E_REUSE_EXISTING_SERVERS === "1";
const webBaseUrl = process.env.E2E_WEB_BASE_URL ?? "http://127.0.0.1:3000";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "e2e-admin-password-2026";
const operatorPassword = process.env.E2E_OPERATOR_PASSWORD ?? "e2e-operator-password-2026";
const teacherPassword = process.env.E2E_TEACHER_PASSWORD ?? "e2e-teacher-password-2026";
const studentPassword = process.env.E2E_STUDENT_PASSWORD ?? "e2e-student-password-2026";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: webBaseUrl,
    trace: "retain-on-failure",
  },
  webServer: useExternalServices ? undefined : {
    command: "bash -lc 'npm run build --workspace @examforge/shared && (npm run dev --workspace @examforge/api & api=$!; trap \"kill $api\" EXIT; npm run dev --workspace @examforge/web)'",
    url: webBaseUrl,
    reuseExistingServer: reuseExistingServers,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_API_BASE_URL: process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000",
      API_HOST: "127.0.0.1",
      API_PORT: "4000",
      LOG_LEVEL: "error",
      EXAMFORGE_ADMIN_PASSWORD: adminPassword,
      EXAMFORGE_OPERATOR_PASSWORD: operatorPassword,
      EXAMFORGE_TEACHER_PASSWORD: teacherPassword,
      EXAMFORGE_STUDENT_PASSWORD: studentPassword,
      EXAMFORGE_TRUSTED_ORIGINS: webBaseUrl,
      EXAMFORGE_SESSION_COOKIE_SECURE: "false",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],
});
