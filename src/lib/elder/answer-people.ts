import { normalize, words } from "../ask/router";
import type { FamilyMember } from "../domain/types";

/**
 * Which saved people an answer is about, so the elder screen can show their
 * photos. Derived from the answer TEXT (built by Ask DayMate from Postgres),
 * so Ask DayMate itself is unchanged: a full name always counts; a first name
 * counts only when no other saved person shares it.
 */
export function peopleInAnswer(answer: string, family: readonly FamilyMember[], limit = 3): FamilyMember[] {
  const text = ` ${normalize(answer)} `;
  const tokens = new Set(words(normalize(answer)));
  const first = (m: FamilyMember) => normalize(m.full_name).split(" ")[0] ?? "";
  const counts = new Map<string, number>();
  for (const m of family) counts.set(first(m), (counts.get(first(m)) ?? 0) + 1);

  const found: FamilyMember[] = [];
  for (const m of family) {
    const full = normalize(m.full_name);
    const byFull = full.length > 0 && text.includes(` ${full} `);
    const f = first(m);
    const byFirst = f.length > 1 && counts.get(f) === 1 && tokens.has(f);
    if (byFull || byFirst) found.push(m);
  }
  // order by first mention in the answer
  return found.sort((a, b) => text.indexOf(` ${first(a)}`) - text.indexOf(` ${first(b)}`)).slice(0, limit);
}
