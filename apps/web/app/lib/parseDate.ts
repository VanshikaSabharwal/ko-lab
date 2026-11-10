/**
 * Due dates as people say them to the assistant ("Friday", "next Tuesday",
 * "in 2 weeks", "Oct 30") → YYYY-MM-DD.
 *
 * The model is told today's date and asked for ISO dates, but small models get
 * weekday arithmetic wrong often enough that the server resolves whatever
 * phrase it passes through. All arithmetic is on calendar dates at midday UTC,
 * so no timezone offset can push a result onto the neighbouring day.
 */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const COUNTS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };

function fromISO(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Index into WEEKDAYS/MONTHS for a full name or an abbreviation of it. */
function lookup(names: string[], word: string): number {
  if (word.length < 3) return -1;
  return names.findIndex((name) => name.startsWith(word));
}

/** A real calendar date — rejects 2026-02-30, which Date would roll over. */
function validISO(iso: string): string | null {
  const date = fromISO(iso);
  return Number.isFinite(date.getTime()) && toISO(date) === iso ? iso : null;
}

/**
 * Today's calendar date for someone in `timeZone`, falling back to UTC for a
 * missing or unknown zone. The assistant asks for the browser's zone so that
 * "today" late in the evening isn't already tomorrow.
 */
export function todayIn(timeZone: string | undefined, now = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return toISO(now);
  }
}

/**
 * Resolve a due-date phrase against `today` (YYYY-MM-DD). Returns null when
 * the phrase isn't understood, so the caller can ask instead of guessing.
 *
 * - "Friday" / "this Friday": the next Friday, today included.
 * - "next Friday": Friday of next week (weeks start on Monday).
 * - "Oct 30": this year, or next year if that date has passed.
 */
export function parseDueDate(text: string, today: string): string | null {
  const phrase = text
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/^(due|by|on)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const base = fromISO(today);

  if (/^\d{4}-\d{2}-\d{2}$/.test(phrase)) return validISO(phrase);
  if (phrase === "today") return today;
  if (phrase === "tomorrow") return toISO(addDays(base, 1));
  if (phrase === "next week") return toISO(addDays(base, 7 - ((base.getUTCDay() + 6) % 7)));

  const relative = phrase.match(/^in (\d+|a|an|one|two|three|four) (day|week|month)s?$/);
  if (relative) {
    const n = COUNTS[relative[1]!] ?? Number(relative[1]);
    if (relative[2] === "day") return toISO(addDays(base, n));
    if (relative[2] === "week") return toISO(addDays(base, n * 7));
    const date = new Date(base);
    date.setUTCMonth(date.getUTCMonth() + n);
    return toISO(date);
  }

  const weekday = phrase.match(/^(this |next )?([a-z]+)$/);
  if (weekday) {
    const target = lookup(WEEKDAYS, weekday[2]!);
    if (target >= 0) {
      if (weekday[1] === "next ") {
        const monday = addDays(base, -((base.getUTCDay() + 6) % 7));
        return toISO(addDays(monday, 7 + ((target + 6) % 7)));
      }
      return toISO(addDays(base, (target - base.getUTCDay() + 7) % 7));
    }
  }

  // "Oct 30", "October 30th", "30 Oct"
  const monthFirst = phrase.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?$/);
  const dayFirst = phrase.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)$/);
  const parts = monthFirst
    ? { month: monthFirst[1]!, day: monthFirst[2]! }
    : dayFirst
      ? { month: dayFirst[2]!, day: dayFirst[1]! }
      : null;
  if (parts) {
    const month = lookup(MONTHS, parts.month);
    if (month < 0) return null;
    const mmdd = `${String(month + 1).padStart(2, "0")}-${parts.day.padStart(2, "0")}`;
    const year = base.getUTCFullYear();
    const thisYear = validISO(`${year}-${mmdd}`);
    if (thisYear && thisYear < today) return validISO(`${year + 1}-${mmdd}`);
    return thisYear;
  }

  return null;
}
