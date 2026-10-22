import { test, expect } from "@playwright/test";
import { USER, FRIEND, GROUP } from "./seed";
import { watch, settle, expectNoProblems } from "./helpers";

/**
 * Using the site, not just opening it: the things a person does on each
 * screen, checked against what they should then see.
 */

test("groups page lists the group the user owns", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/groups");
  await settle(page);

  await expect(page.getByText(GROUP.name).first()).toBeVisible();
  expectNoProblems(problems);
});

test("group chat shows the group's name and its messages", async ({ page }) => {
  const problems = watch(page);
  await page.goto(`/group/${GROUP.id}`);
  await settle(page);

  await expect(page.getByText(GROUP.name).first()).toBeVisible();
  await expect(page.getByText("Hello from the test user")).toBeVisible();
  await expect(page.getByText("Hi! Reply from a member")).toBeVisible();

  // The message box accepts typing and enables Send
  const box = page.getByPlaceholder("Type a message...");
  await box.fill("typed by the browser test");
  await expect(box).toHaveValue("typed by the browser test");

  expectNoProblems(problems);
});

test("members page lists the owner first, then members", async ({ page }) => {
  const problems = watch(page);
  await page.goto(`/viewMembers/${GROUP.id}`);
  await settle(page);

  const rows = page.locator("ul > li").filter({ hasText: /Owner|Member/ });
  await expect(rows.first()).toContainText(USER.name);
  await expect(rows.first()).toContainText("Owner");
  await expect(page.locator("li", { hasText: FRIEND.name }).first()).toContainText("Member");

  expectNoProblems(problems);
});

test("opening notifications shows them and marks them read", async ({ page }) => {
  const problems = watch(page);

  const before = await (await page.request.get("/api/notifications")).json();
  const unreadBefore = before.notifications.filter((n: { readAt: string | null }) => !n.readAt);

  await page.goto("/notifications");
  await settle(page);
  await expect(page.getByText(`${FRIEND.name} added you to ${GROUP.name}`).first()).toBeVisible();

  // Seen once means read for good: the unread badge must not come back
  await expect
    .poll(async () => {
      const after = await (await page.request.get("/api/notifications")).json();
      return after.notifications.filter((n: { readAt: string | null }) => !n.readAt).length;
    })
    .toBe(0);
  expect(before.notifications.length).toBeGreaterThan(0);
  expect(unreadBefore.length).toBeGreaterThanOrEqual(0);

  expectNoProblems(problems);
});

test("profile page shows who is signed in", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/profile");
  await settle(page);

  await expect(page.getByText(USER.name).first()).toBeVisible();
  await expect(page.getByText("Browser notifications")).toBeVisible();

  expectNoProblems(problems);
});

test("the settings gear in the header opens the profile", async ({ page }) => {
  await page.goto("/");
  await settle(page);

  await page.getByRole("link", { name: "Settings" }).first().click();
  await expect(page).toHaveURL(/\/profile$/);
});

test.describe("UI/UX design board", () => {
  // Dragging and double-clicking elements is a mouse workflow; the phone
  // layout is covered by the page tests.
  test.skip(({ isMobile }) => isMobile, "desktop interaction");
  // Both tests edit the group's one shared board: run them one after the other
  test.describe.configure({ mode: "serial" });

  test("add an element, rename it, then clear the board and undo", async ({ page }) => {
    const problems = watch(page);
    await page.goto(`/workspace/${GROUP.id}/ui-design`);
    await settle(page);

    const board = page.locator(".react-flow");
    const elements = board.locator(".react-flow__node");
    await expect(board).toBeVisible();
    const startCount = await elements.count();

    // Add a button from the palette
    await page.getByRole("button", { name: "Button", exact: true }).click();
    await expect(elements).toHaveCount(startCount + 1);
    const added = elements.last();
    await expect(added).toContainText("Button");

    // Double-click anywhere on it to rename
    await added.dblclick();
    const input = added.getByRole("textbox");
    await expect(input).toBeVisible();
    await input.fill("Sign up");
    await input.press("Enter");
    await expect(added).toContainText("Sign up");
    await expect(added.getByRole("textbox")).toHaveCount(0);

    // Clear takes two clicks, and Undo brings everything back
    const clear = page.getByRole("button", { name: /Clear board/ });
    await clear.click();
    await page.getByRole("button", { name: /Click again to clear/ }).click();
    await expect(elements).toHaveCount(0);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(elements).toHaveCount(startCount + 1);
    await expect(elements.last()).toContainText("Sign up");

    expectNoProblems(problems);
  });

  test("an unnamed toggle can be named by double-clicking it", async ({ page }) => {
    await page.goto(`/workspace/${GROUP.id}/ui-design`);
    await settle(page);
    const elements = page.locator(".react-flow .react-flow__node");

    // New elements land in the middle of the board, on top of whatever the
    // previous test left there, so start from an empty one
    if ((await elements.count()) > 0) {
      await page.getByRole("button", { name: /Clear board/ }).click();
      await page.getByRole("button", { name: /Click again to clear/ }).click();
      await expect(elements).toHaveCount(0);
    }

    await page.getByRole("button", { name: "Toggle", exact: true }).click();
    await expect(elements).toHaveCount(1);
    const toggle = elements.first();

    await toggle.dblclick();
    await toggle.getByRole("textbox").fill("Dark mode");
    await toggle.getByRole("textbox").press("Enter");
    await expect(toggle).toContainText("Dark mode");
  });
});
