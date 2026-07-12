import { defineConfig, devices } from "@playwright/test";

const useExternalServices = process.env.E2E_EXTERNAL_SERVICES === "1";
const reuseExistingServers = process.env.E2E_REUSE_EXISTING_SERVERS === "1";
const webBaseUrl = process.env.E2E_WEB_BASE_URL ?? "http://127.0.0.1:3000";

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
