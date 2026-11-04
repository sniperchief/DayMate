import { WEEKDAYS, type Routine } from "./types";

/**
 * Upcoming activities are computed deterministically from the structured
 * routine rows in Postgres — never from semantic memory recall.
 */
export interface Occurrence {
  routine: Routine;
  /** Local calendar date in the elder's time zone, YYYY-MM-DD. */
  date: string;
  /** Local time HH:MM. */
  time: string;
}

interface LocalNow {
  date: string;
  time: string;
  weekday: number;
}

/** Current local date/time/weekday in `timeZone`. */
export function localNow(now: Date, timeZone: string): LocalNow {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { date, time: `${get("hour")}:${get("minute")}`, weekday: weekdayOf(date) };
}

/** Day of week (0 = Sunday) of a YYYY-MM-DD calendar date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function hhmm(time: string): string {
  return time.slice(0, 5);
}

/**
 * All occurrences of active routines from "now" through the next `days` days
 * (inclusive of today), sorted chronologically. Activities earlier today are
 * excluded.
 */
export function upcomingOccurrences(routines: readonly Routine[], now: Date, timeZone: string, days = 7): Occurrence[] {
  const today = localNow(now, timeZone);
  const out: Occurrence[] = [];
  for (let offset = 0; offset < days; offset++) {
    const date = addDays(today.date, offset);
    const weekday = weekdayOf(date);
    for (const routine of routines) {
      if (!routine.is_active) continue;
      const time = hhmm(routine.time_of_day);
      if (offset === 0 && time < today.time) continue;
      const occurs =
        routine.recurrence === "daily" ||
        (routine.recurrence === "weekly" && routine.weekday === weekday) ||
        (routine.recurrence === "none" && routine.activity_date === date);
      if (occurs) out.push({ routine, date, time });
    }
  }
  return out.sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
}

/** "7:00 AM" style display for an HH:MM time. */
export function formatTime(time: string): string {
  const [h = 0, m = 0] = hhmm(time).split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "Saturday 14 November 2026" for a YYYY-MM-DD date. */
export function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  ).replace(",", "");
}

/** Human description of a routine's schedule. */
export function describeSchedule(r: Pick<Routine, "recurrence" | "activity_date" | "weekday" | "time_of_day">): string {
  const at = formatTime(r.time_of_day);
  if (r.recurrence === "daily") return `Every day at ${at}`;
  if (r.recurrence === "weekly") return `Every ${WEEKDAYS[r.weekday ?? 0]} at ${at}`;
  return `${r.activity_date ? formatDate(r.activity_date) : "One time"} at ${at}`;
}

/** "Today", "Tomorrow" or the formatted date, relative to `today`. */
export function relativeDay(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return formatDate(date);
}
