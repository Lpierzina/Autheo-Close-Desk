import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4173);

/**
 * The end-to-end tests run against the production build in `out/`, served by the same
 * static server the deployment can use. Run `npm run build` first.
 *
 * They drive the Chrome installed on this machine. Set E2E_BROWSER_CHANNEL=chromium
 * to use Playwright's own browser instead (after `npx playwright install chromium`).
 */
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    channel: process.env.E2E_BROWSER_CHANNEL ?? "chrome",
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve.mjs",
    env: { PORT: String(port), HOST: "127.0.0.1" },
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
