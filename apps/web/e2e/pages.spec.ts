import { test, expect } from "@playwright/test";
import { GROUP } from "./seed";
import {
  watch,
  settle,
  scrollThrough,
  expectNoProblems,
  expectNoSidewaysOverflow,
  expectNotAnErrorPage,
} from "./helpers";

/**
 * Every page, opened and scrolled as the signed-in test user, on desktop and
 * phone sizes. A page passes if it renders, nothing crashes, the app's API
 * doesn't error, and it never grows wider than the screen.
 */
const PAGES: { name: string; path: string }[] = [
  { name: "home", path: "/" },
  { name: "chat room", path: "/chat-room" },
  { name: "groups", path: "/groups" },
  { name: "notifications", path: "/notifications" },
  { name: "profile", path: "/profile" },
  { name: "bug reports", path: "/bugs" },
  { name: "assistant", path: "/assistant" },
  { name: "friend search", path: "/friend-search" },
  { name: "group chat", path: `/group/${GROUP.id}` },
  { name: "group members", path: `/viewMembers/${GROUP.id}` },
  { name: "workspace overview", path: `/workspace/${GROUP.id}` },
  { name: "planning board", path: `/workspace/${GROUP.id}/planning` },
  { name: "UI/UX design board", path: `/workspace/${GROUP.id}/ui-design` },
  { name: "mind map", path: `/workspace/${GROUP.id}/mind-map` },
  { name: "database schema board", path: `/workspace/${GROUP.id}/db-schema` },
];

for (const { name, path } of PAGES) {
  test(`${name} loads and scrolls without errors`, async ({ page }) => {
    const problems = watch(page);

    const response = await page.goto(path);
    expect(response?.status(), `${path} responded with an error`).toBeLessThan(400);
    await settle(page);

    await expectNotAnErrorPage(page);
    await expect(page.locator("body")).not.toBeEmpty();

    await scrollThrough(page);
    await expectNoSidewaysOverflow(page);
    await expectNotAnErrorPage(page);

    expectNoProblems(problems);
  });
}

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const { name, path } of [
    { name: "home", path: "/" },
    { name: "sign in", path: "/auth/signin" },
  ]) {
    test(`${name} loads and scrolls without errors`, async ({ page }) => {
      const problems = watch(page);

      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(400);
      await settle(page);

      await expectNotAnErrorPage(page);
      await scrollThrough(page);
      await expectNoSidewaysOverflow(page);

      expectNoProblems(problems);
    });
  }

  test("the app's data is not readable without signing in", async ({ request }) => {
    for (const path of ["/api/my-groups", "/api/notifications", `/api/create-group-data?group=${GROUP.id}`]) {
      const response = await request.get(path);
      expect(response.status(), `${path} should refuse an anonymous request`).toBe(401);
    }
  });
});
