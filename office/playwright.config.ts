import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const statusFile = path.join(__dirname, "test-results", "e2e-status.json");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:3300",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // Software WebGL so the 3D scene renders on machines without a GPU (CI).
          args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
          executablePath: process.env.PW_CHROMIUM_PATH || undefined,
        },
      },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://127.0.0.1:3300",
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { OFFICE_STATUS_FILE: statusFile },
  },
});
