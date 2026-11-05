import { createHash } from "node:crypto";
import { describeSchedule, formatDate } from "../domain/schedule";
import type { Elder, FamilyMember, Memory, Routine } from "../domain/types";

/**
 * Natural-language memory text written to Walrus for each kind of record.
 * Deliberately excludes date of birth, private notes and photos.
 */

export function profileText(elder: Pick<Elder, "full_name" | "description">): string | null {
  const description = elder.description.trim();
  if (!description) return null;
  return `About ${elder.full_name.trim()}: ${ensurePeriod(description)}`;
}

export function familyMemberText(elderName: string, m: Pick<FamilyMember, "full_name" | "relationship" | "description">): string {
  const base = `${m.full_name.trim()} is ${possessive(elderName)} ${m.relationship.trim().toLowerCase()}.`;
  const description = m.description.trim();
  return description ? `${base} ${ensurePeriod(description)}` : base;
}

/** Inactive routines are not written (returns null). */
export function routineText(elderName: string, r: Pick<Routine, "title" | "description" | "recurrence" | "activity_date" | "weekday" | "time_of_day" | "is_active">): string | null {
  if (!r.is_active) return null;
  const when = describeSchedule(r);
  const lead = r.recurrence === "none" ? `${possessive(elderName)} planned activity` : `${possessive(elderName)} routine`;
  const phrase = r.recurrence === "none" ? `on ${when}` : when.replace(/^Every/, "every");
  const base = `${lead}: ${r.title.trim()} — ${phrase}.`;
  const description = r.description.trim();
  return description ? `${base} ${ensurePeriod(description)}` : base;
}

export function memoryText(
  elderName: string,
  m: Pick<Memory, "title" | "description" | "event_date">,
  related?: Pick<FamilyMember, "full_name" | "relationship"> | null,
): string {
  const when = m.event_date ? ` (${formatDate(m.event_date)})` : "";
  let out = `Memory about ${elderName.trim()}${when}: ${ensurePeriod(m.title.trim())} ${ensurePeriod(m.description.trim())}`;
  if (related) out += ` This involves ${related.full_name.trim()}, ${possessive(elderName)} ${related.relationship.trim().toLowerCase()}.`;
  return out;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex");
}

/** One namespace per elder, made only of an opaque ID (no names). */
export function elderNamespace(elderId: string): string {
  return `daymate-elder-${elderId.toLowerCase()}`;
}

function possessive(name: string): string {
  const n = name.trim();
  return n.endsWith("s") ? `${n}'` : `${n}'s`;
}

function ensurePeriod(s: string): string {
  return /[.!?]$/.test(s) ? s : `${s}.`;
}
