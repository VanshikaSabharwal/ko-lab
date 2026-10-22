import { expect, type Page } from "@playwright/test";

/**
 * Console noise that isn't a bug in the page. The tests run without the live
 * chat server and without third-party services, so their connection failures
 * are expected; everything else is reported.
 */
const IGNORED_CONSOLE = [
  /WebSocket/i, // no chat/socket server in the test run
  /ws:\/\/|wss:\/\//,
  /livekit/i,
  /Failed to load resource/i, // reported with its status by the response check instead
  /net::ERR_/,
  /Download the React DevTools/,
  /\[Fast Refresh\]/,
  /\[HMR\]/,
];

/** Routes that depend on something the test run doesn't have. */
const IGNORED_FAILING_REQUESTS = [
  /\/api\/ws-token/, // the socket server's signing secret
  /\/api\/calls\//, // LiveKit
  /\/api\/assistant/, // the AI provider
];

export interface Problems {
  /** Uncaught exceptions in the page: always a bug. */
  crashes: string[];
  /** Our own API answering with a server error. */
  serverErrors: string[];
  consoleErrors: string[];
}

/** Start recording problems on a page. Call before navigating. */
export function watch(page: Page): Problems {
  const problems: Problems = { crashes: [], serverErrors: [], consoleErrors: [] };

  page.on("pageerror", (error) => problems.crashes.push(error.message));

  page.on("response", (response) => {
    const url = new URL(response.url());
    const ours = url.origin === new URL(page.url() || "http://x").origin || url.pathname.startsWith("/api/");
    if (!ours) return;
    // The app refusing its own page's requests would otherwise show up only
    // as mysteriously missing content
    if (response.status() === 429) {
      problems.serverErrors.push(`429 (rate limited) ${response.request().method()} ${url.pathname}`);
      return;
    }
    if (response.status() < 500) return;
    if (IGNORED_FAILING_REQUESTS.some((p) => p.test(url.pathname))) return;
    problems.serverErrors.push(`${response.status()} ${response.request().method()} ${url.pathname}`);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((p) => p.test(text))) return;
    problems.consoleErrors.push(text);
  });

  return problems;
}

export function expectNoProblems(problems: Problems) {
  expect(problems.crashes, "uncaught errors in the page").toEqual([]);
  expect(problems.serverErrors, "server errors from the app's API").toEqual([]);
  expect(problems.consoleErrors, "errors logged to the console").toEqual([]);
}

/** Let the page finish loading its data; a page that keeps polling is fine. */
export async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

/**
 * Scroll the page, and its tallest scrolling panel, from top to bottom and
 * back in steps: this is what triggers lazy-loaded content and scroll handlers.
 */
export async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const pause = () => new Promise((r) => setTimeout(r, 60));
    const targets: Element[] = [document.scrollingElement || document.documentElement];

    // Most pages here scroll an inner panel (chat list, sidebar), not the window
    const inner = [...document.querySelectorAll<HTMLElement>("*")]
      .filter((el) => {
        const style = getComputedStyle(el);
        return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 20;
      })
      .sort((a, b) => b.scrollHeight - a.scrollHeight)
      .slice(0, 3);
    targets.push(...inner);

    for (const el of targets) {
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0) continue;
      const step = Math.max(200, Math.round(el.clientHeight * 0.8));
      for (let y = 0; y < max; y += step) {
        el.scrollTop = y;
        await pause();
      }
      el.scrollTop = max;
      await pause();
      el.scrollTop = 0;
      await pause();
    }
  });
}

/** The page must never be wider than the screen (sideways scrolling on phones). */
export async function expectNoSidewaysOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `page is ${scrollWidth}px wide on a ${clientWidth}px screen`).toBeLessThanOrEqual(
    clientWidth + 1,
  );
}

/** Next.js's own crash screens, shown when a page throws while rendering. */
export async function expectNotAnErrorPage(page: Page) {
  await expect(page.getByText(/Application error: a (client|server)-side exception/i)).toHaveCount(0);
  await expect(page.getByText(/^Internal Server Error$/)).toHaveCount(0);
  await expect(page.locator("nextjs-portal [data-nextjs-dialog]")).toHaveCount(0);
}
