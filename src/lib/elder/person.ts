import { normalize, words } from "../ask/router";
import { addDays, formatTime, localNow, upcomingOccurrences } from "../domain/schedule";
import type { FamilyMember, Memory, Routine } from "../domain/types";
import { firstName, friendlyPast, peopleIn } from "./today";

/**
 * A person page on the elder's device: who they are, when they're next
 * coming, and a few recent memories with them. Built from Postgres; the
 * spoken version says exactly what the screen shows.
 */

export interface PersonView {
  intro: string; // "This is Helen Example, your daughter."
  about: string; // caregiver's description, or ""
  next: { title: string; when: string } | null; // when: "today at 3:00 PM", "on Thursday at 3:00 PM"
  memories: { id: string; title: string; when: string | null; text: string; photoPath: string | null }[];
  speech: string;
}

function sentence(s: string): string {
  const t = s.trim();
  return !t ? "" : /[.!?]$/.test(t) ? t : `${t}.`;
}

/** Memories linked to the person, or naming them by first name (whole word). */
export function memoriesWith(member: FamilyMember, memories: readonly Memory[]): Memory[] {
  const name = words(normalize(firstName(member.full_name)));
  return memories.filter((m) => {
    if (m.related_person_id === member.id) return true;
    const text = new Set(words(normalize(`${m.title} ${m.description}`)));
    return name.length > 0 && name.every((w) => text.has(w));
  });
}

function whenUpcoming(date: string, time: string, today: string): string {
  const at = `at ${formatTime(time)}`;
  if (date === today) return `today ${at}`;
  if (date === addDays(today, 1)) return `tomorrow ${at}`;
  return `${friendlyUpcoming(date, today)} ${at}`;
}

function friendlyUpcoming(date: string, today: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (date <= addDays(today, 6)) return `on ${new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(d)}`;
  return `on ${new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d).replace(",", "")}`;
}

export function buildPerson({
  member,
  routines,
  memories,
  timezone,
  now = new Date(),
  memoryLimit = 3,
}: {
  member: FamilyMember;
  routines: readonly Routine[];
  memories: readonly Memory[];
  timezone: string;
  now?: Date;
  memoryLimit?: number;
}): PersonView {
  const today = localNow(now, timezone).date;
  const rel = member.relationship.trim().toLowerCase();
  const intro = `This is ${member.full_name.trim()}, your ${rel}.`;
  const about = sentence(member.description);

  const theirs = routines.filter((r) => r.is_active && peopleIn(r, [member]).length > 0);
  const occ = upcomingOccurrences(theirs, now, timezone, 60)[0];
  const next = occ ? { title: occ.routine.title.trim(), when: whenUpcoming(occ.date, occ.time, today) } : null;

  const day = (m: Memory) => m.event_date ?? m.created_at.slice(0, 10);
  const recent = memoriesWith(member, memories)
    .filter((m) => day(m) <= today)
    .sort((a, b) => day(b).localeCompare(day(a)))
    .slice(0, memoryLimit)
    .map((m) => ({ id: m.id, title: m.title.trim(), when: m.event_date ? friendlyPast(m.event_date, today) : null, text: sentence(m.description), photoPath: m.photo_path ?? null }));

  const parts = [intro, about];
  if (next) parts.push(`Next: ${next.title}, ${next.when}.`);
  if (recent[0]) parts.push(`A memory with ${firstName(member.full_name)}: ${sentence(recent[0].title)}${recent[0].when ? ` That was ${recent[0].when}.` : ""}`);
  return { intro, about, next, memories: recent, speech: parts.filter(Boolean).join(" ") };
}
