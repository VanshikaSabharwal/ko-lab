import { defineConfig, devices } from "@playwright/test";

// Browser tests: a real browser signs in as a seeded test user, opens each page
// on desktop and phone sizes, scrolls through it and uses the main features.
// Run with `npm run test:e2e` (see e2e/README.md for the database it needs).

const PORT = Number(process.env.E2E_PORT || 3100);
export const BASE_URL = `http://localhost:${PORT}`;

/** A throwaway Postgres. Never the development or production database. */
export const DATABASE_URL =
  process.env.E2E_DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kolab_e2e";

/** Signs the test user's session cookie; the app is started with the same value. */
export const AUTH_SECRET = "e2e-only-secret-never-used-in-production";

export const STORAGE_STATE = "e2e/.auth/user.json";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The dev server compiles each page on its first visit; too many at once
  // and pages are still loading when the test looks for their content
  workers: process.env.CI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    storageState: STORAGE_STATE,
    // Kept only for failures: what the page looked like and what it did
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // Phone layout, same browser engine: catches overflow and cramped layouts
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],

  webServer: {
    // CI tests the production build; locally the dev server is quicker to start
    command: process.env.CI ? `npx next start -p ${PORT}` : `npx next dev -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL,
      NEXTAUTH_SECRET: AUTH_SECRET,
      NEXTAUTH_URL: BASE_URL,
      NEXT_TELEMETRY_DISABLED: "1",
      // Every test comes from one address; the default of 120 a minute would
      // start refusing them part-way through the run
      API_RATE_LIMIT_PER_MINUTE: "100000",
    },
  },
});
