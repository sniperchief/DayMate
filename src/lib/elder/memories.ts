import { createHash } from "node:crypto";
import type { FamilyMember, Memory } from "../domain/types";
import { firstName, friendlyPast } from "./today";

/**
 * Memories on the elder's device: three simple ways to browse, a "memory of
 * the day" that stays the same all day, and the words read aloud for each.
 * Only memories that have already happened are shown.
 */

export const MEMORY_TABS = [
  { id: "recent", label: "Recent" },
  { id: "family", label: "With family" },
  { id: "enjoy", label: "Things I enjoy" },
] as const;
export type MemoryTab = (typeof MEMORY_TABS)[number]["id"];

export function parseTab(value: unknown): MemoryTab {
  return MEMORY_TABS.some((t) => t.id === value) ? (value as MemoryTab) : "recent";
}

const day = (m: Memory) => m.event_date ?? m.created_at.slice(0, 10);

/** Past (or undated) memories, newest first. */
export function pastMemories(memories: readonly Memory[], today: string): Memory[] {
  return memories.filter((m) => day(m) <= today).sort((a, b) => day(b).localeCompare(day(a)) || b.created_at.localeCompare(a.created_at));
}

export function memoriesForTab(memories: readonly Memory[], tab: MemoryTab, today: string): Memory[] {
  const past = pastMemories(memories, today);
  if (tab === "family") return past.filter((m) => m.related_person_id || m.category === "family" || m.category === "visit");
  if (tab === "enjoy") return past.filter((m) => m.category === "preference" || m.category === "activity");
  return past;
}

/**
 * One memory for today, the same all day (seeded by date + elder). Prefers
 * memories with a photo, and avoids the newest one (already at the top).
 */
export function memoryOfTheDay(memories: readonly Memory[], today: string, seed: string): Memory | null {
  const past = pastMemories(memories, today);
  if (past.length === 0) return null;
  let pool = past.length > 1 ? past.slice(1) : past;
  const withPhotos = pool.filter((m) => m.photo_path);
  if (withPhotos.length) pool = withPhotos;
  const n = createHash("sha256").update(`${today}:${seed}`).digest().readUInt32BE(0);
  return pool[n % pool.length]!;
}

function sentence(s: string): string {
  const t = s.trim();
  return !t ? "" : /[.!?]$/.test(t) ? t : `${t}.`;
}

export function whenLabel(m: Memory, today: string): string | null {
  if (!m.event_date) return null;
  const w = friendlyPast(m.event_date, today);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function memorySpeech(m: Memory, person: FamilyMember | undefined, today: string): string {
  const when = whenLabel(m, today);
  return [sentence(m.title), when ? `${when}.` : "", sentence(m.description), person ? `With ${firstName(person.full_name)}, your ${person.relationship.trim().toLowerCase()}.` : ""]
    .filter(Boolean)
    .join(" ");
}
