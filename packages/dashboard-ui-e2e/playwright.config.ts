import { defineConfig, devices } from "@playwright/test";
import { nxE2EPreset } from "@nx/playwright/preset";
import { fileURLToPath } from "node:url";

const baseURL = "http://localhost:5173";

export default defineConfig({
  ...nxE2EPreset(fileURLToPath(import.meta.url), { testDir: "./src" }),
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "npx nx dev dashboard",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: "../..",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
