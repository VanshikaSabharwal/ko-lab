/**
 * Due-date phrases the assistant passes through from the user. 2026-10-21 is a
 * Wednesday; its week runs Mon Oct 19 – Sun Oct 25.
 */
import { describe, it, expect } from "vitest";
import { parseDueDate, todayIn } from "../../app/lib/parseDate";

const TODAY = "2026-10-21";

describe("parseDueDate", () => {
  it.each([
    ["2026-11-02", "2026-11-02"],
    ["today", "2026-10-21"],
    ["tomorrow", "2026-10-22"],
    ["Friday", "2026-10-23"],
    ["this friday", "2026-10-23"],
    ["due Fri", "2026-10-23"],
    ["by thurs", "2026-10-22"],
    // A weekday that is today means today, not a week out
    ["Wednesday", "2026-10-21"],
    ["Monday", "2026-10-26"],
    ["next Friday", "2026-10-30"],
    ["next monday", "2026-10-26"],
    ["next week", "2026-10-26"],
    ["in 3 days", "2026-10-24"],
    ["in 2 weeks", "2026-11-04"],
    ["in a month", "2026-11-21"],
    ["Oct 30", "2026-10-30"],
    ["October 30th", "2026-10-30"],
    ["30 Oct", "2026-10-30"],
    ["Oct 21", "2026-10-21"],
    // Already past this year, so next year
    ["Jan 5", "2027-01-05"],
  ])("%s → %s", (phrase, expected) => {
    expect(parseDueDate(phrase, TODAY)).toBe(expected);
  });

  it.each(["someday", "2026-02-30", "Feb 30", "the 5th", "", "sa"])(
    "returns null for %j rather than guessing",
    (phrase) => {
      expect(parseDueDate(phrase, TODAY)).toBeNull();
    },
  );
});

describe("todayIn", () => {
  const lateEvening = new Date("2026-10-21T20:00:00Z");

  it("uses the user's timezone, where it may already be tomorrow", () => {
    expect(todayIn("Asia/Kolkata", lateEvening)).toBe("2026-10-22");
    expect(todayIn("America/New_York", lateEvening)).toBe("2026-10-21");
  });

  it("falls back to UTC for a missing or unknown zone", () => {
    expect(todayIn(undefined, lateEvening)).toBe("2026-10-21");
    expect(todayIn("Not/AZone", lateEvening)).toBe("2026-10-21");
  });
});
