import { normalize, words } from "../ask/router";
import { addDays, formatTime, localNow, upcomingOccurrences, weekdayOf } from "../domain/schedule";
import { WEEKDAYS, type Elder, type FamilyMember, type Routine } from "../domain/types";

/**
 * The elder's "Today" screen, built deterministically from Postgres data in
 * the elder's own time zone. Also produces the sentence read aloud by
 * "Read to me", so screen and speech always say the same thing.
 */

export type PartOfDay = "morning" | "afternoon" | "evening";

export interface TodayItem {
  key: string;
  time: string; // "3:00 PM"
  title: string;
  people: Pick<FamilyMember, "id" | "full_name" | "relationship" | "photo_path">[];
}

export interface Today {
  greeting: string; // "Good morning, Rose"
  weekday: string; // "Tuesday"
  dateLabel: string; // "5 November"
  /** Rest of today, from now on. */
  items: TodayItem[];
  /** First thing tomorrow, when nothing is left today. */
  tomorrow: TodayItem | null;
  speech: string;
}

const MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

export function partOfDay(hhmm: string): PartOfDay {
  const h = Number(hhmm.slice(0, 2));
  return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
}

export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

/** Family members a routine mentions by first name (e.g. "Helen visits"). */
export function peopleIn(routine: Pick<Routine, "title" | "description">, family: readonly FamilyMember[]): FamilyMember[] {
  const text = new Set(words(normalize(`${routine.title} ${routine.description}`)));
  return family.filter((m) => words(normalize(firstName(m.full_name))).every((w) => text.has(w)));
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

function item(o: { routine: Routine; date: string; time: string }, family: readonly FamilyMember[]): TodayItem {
  return {
    key: `${o.routine.id}-${o.date}`,
    time: formatTime(o.time),
    title: o.routine.title.trim(),
    people: peopleIn(o.routine, family).map(({ id, full_name, relationship, photo_path }) => ({ id, full_name, relationship, photo_path })),
  };
}

export function buildToday({ elder, routines, family, now = new Date() }: { elder: Pick<Elder, "full_name" | "timezone">; routines: readonly Routine[]; family: readonly FamilyMember[]; now?: Date }): Today {
  const local = localNow(now, elder.timezone);
  const name = firstName(elder.full_name);
  const greeting = `Good ${partOfDay(local.time)}, ${name}`;
  const weekday = WEEKDAYS[weekdayOf(local.date)]!;
  const dateLabel = MONTH.format(new Date(`${local.date}T00:00:00Z`));

  const upcoming = upcomingOccurrences(routines, now, elder.timezone, 2);
  const items = upcoming.filter((o) => o.date === local.date).map((o) => item(o, family));
  const nextDay = upcoming.find((o) => o.date === addDays(local.date, 1));
  const tomorrow = items.length === 0 && nextDay ? item(nextDay, family) : null;

  const day = Number(local.date.slice(8, 10));
  const month = dateLabel.replace(/^\d+\s+/, "");
  const parts = [`${greeting}.`, `Today is ${weekday} the ${ordinal(day)} of ${month}.`];
  if (items.length) {
    parts.push(`Next, ${items[0]!.title} at ${items[0]!.time}.`);
    for (const it of items.slice(1, 4)) parts.push(`Then ${it.title} at ${it.time}.`);
  } else {
    parts.push("You have nothing else planned for today.");
    if (tomorrow) parts.push(`Tomorrow, ${tomorrow.title} at ${tomorrow.time}.`);
  }
  return { greeting, weekday, dateLabel, items, tomorrow, speech: parts.join(" ") };
}

/** "today", "yesterday", "on Sunday", "on 12 October", "on 12 October 2024". */
export function friendlyPast(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDays(today, -1)) return "yesterday";
  if (date > today) {
    if (date === addDays(today, 1)) return "tomorrow";
    return `on ${MONTH.format(new Date(`${date}T00:00:00Z`))}`;
  }
  if (date >= addDays(today, -6)) return `on ${WEEKDAYS[weekdayOf(date)]}`;
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  const label = MONTH.format(new Date(`${date}T00:00:00Z`));
  return `on ${label}${sameYear ? "" : ` ${date.slice(0, 4)}`}`;
}
