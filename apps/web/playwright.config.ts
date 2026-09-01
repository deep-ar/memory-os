import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 30_000,
  use: {
    baseURL: process.env.MEMORYOS_E2E_URL ?? "http://127.0.0.1:7310",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chrome", use: { channel: "chrome" } }],
});
