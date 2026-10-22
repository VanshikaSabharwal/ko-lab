import { test, expect } from "@playwright/test";
import { STORAGE_STATE } from "../playwright.config";
import { readFileSync } from "fs";
import { watch, settle, expectNoProblems } from "./helpers";

/**
 * The first-visit guided tour. Every other test runs as a returning user with
 * the tours already seen; this one signs in with nothing remembered.
 */
test.use({
  storageState: async ({}, use) => {
    const state = JSON.parse(readFileSync(STORAGE_STATE, "utf-8"));
    await use({ cookies: state.cookies, origins: [] });
  },
});

test("a first-time visitor gets the tour, and closing it gives the page back", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/");
  await settle(page);

  const tour = page.locator(".shepherd-element");
  await expect(tour.first()).toBeVisible({ timeout: 10_000 });

  await page.keyboard.press("Escape");
  await expect(tour).toHaveCount(0);
  await expect(page.locator(".shepherd-modal-is-visible")).toHaveCount(0);

  // Dismissed once, it stays dismissed
  await page.reload();
  await settle(page);
  await page.waitForTimeout(1500);
  await expect(page.locator(".shepherd-element")).toHaveCount(0);

  expectNoProblems(problems);
});
