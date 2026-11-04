/**
 * Deterministic question router for Ask DayMate. No AI: normalisation,
 * keyword cues and the elder's own family/routine names decide which
 * source answers a question. It does not claim to understand everything —
 * anything unrecognised falls through to a strict memory search and, failing
 * that, an honest "I'm not sure".
 */

export type ScheduleRange = { type: "day"; offset: number } | { type: "weekday"; weekday: number } | { type: "week" } | { type: "next" };
export type MemoryMode = "recent-visit" | "event" | "preference" | "general";
export type ProfileField = "name" | "age" | "birthday" | "about";

export type Route =
  | { kind: "profile"; field: ProfileField }
  | { kind: "family"; memberIds: string[]; relationWords: string[]; all: boolean }
  | { kind: "person"; memberIds: string[] }
  | { kind: "visit-plan"; memberIds: string[]; relationWords: string[]; nameHint: string | null }
  | { kind: "activity-time"; routineIds: string[] }
  | { kind: "schedule"; range: ScheduleRange }
  | { kind: "memory"; mode: MemoryMode; memberIds: string[] }
  | { kind: "unknown" };

export interface RouterContext {
  elderName: string;
  family: { id: string; full_name: string; relationship: string }[];
  routines: { id: string; title: string }[];
}

// ── text helpers ───────────────────────────────────────────────────────────
const CONTRACTIONS: [RegExp, string][] = [
  [/\bwhat's\b/g, "what is"],
  [/\bwho's\b/g, "who is"],
  [/\bwhen's\b/g, "when is"],
  [/\bwhere's\b/g, "where is"],
  [/\bhow's\b/g, "how is"],
  [/\bthat's\b/g, "that is"],
  [/\bit's\b/g, "it is"],
  [/\bi'm\b/g, "i am"],
  [/\bi've\b/g, "i have"],
  [/\bi'll\b/g, "i will"],
  [/\bdon't\b/g, "do not"],
  [/\bdidn't\b/g, "did not"],
  [/\bwon't\b/g, "will not"],
];

export function normalize(question: string): string {
  let q = question.toLowerCase().replace(/[’‘`]/g, "'");
  for (const [re, rep] of CONTRACTIONS) q = q.replace(re, rep);
  return q
    .replace(/'s\b/g, "") // possessives: "daughter's" → "daughter"
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function words(normalized: string): string[] {
  return normalized.split(" ").filter(Boolean);
}

const PREFERENCE_SYNONYMS = new Set(["like", "likes", "enjoy", "enjoys", "love", "loves", "favourite", "favorite", "fond", "prefer", "prefers"]);

/** Crude stemmer shared by question and memory text so they compare fairly. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/'s$/, "").replace(/'/g, "");
  if (PREFERENCE_SYNONYMS.has(w)) return "like";
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  return w;
}

const STOPWORDS = new Set(
  (
    "i me my mine myself you your yours we our us the a an is are was were be been being am do does did doing done have has had " +
    "what who whom whose when where why how which that this these those there here to of in on at for with about from by and or but " +
    "not no it its as if then than so up out over into can could will would shall should may might must just very really please " +
    "tell know remember again any some all much many more most other same such only also ever never yes ok okay thing something " +
    "anything get got let say said give daymate like"
  ).split(" "),
);

/** Content keywords of a question, stemmed, minus stopwords and the elder's own name. */
export function keywords(question: string, exclude: readonly string[] = []): string[] {
  const ex = new Set(exclude.flatMap((e) => words(normalize(e))).map(stem));
  const out = new Set<string>();
  for (const w of words(normalize(question))) {
    if (STOPWORDS.has(w) || w.length < 3) continue;
    const s = stem(w);
    if (!ex.has(s) && !STOPWORDS.has(s)) out.add(s);
  }
  return [...out];
}

/**
 * Rewrite a first-person question into the third person used by the stored
 * memories ("Who visited me recently?" → "who visited rose recently"). Saved
 * memories describe the elder by name, so this markedly improves semantic
 * recall (measured on Mainnet: distance 0.80 → 0.49 for the right memory).
 */
export function walrusQuery(question: string, elderName: string): string {
  const name = (words(normalize(elderName))[0] ?? "").replace(/'/g, "");
  if (!name) return normalize(question);
  return normalize(question)
    .replace(/\bdo i\b/g, `does ${name}`)
    .replace(/\b(am i|i am)\b/g, `is ${name}`)
    .replace(/\b(have i|i have)\b/g, `has ${name}`)
    .replace(/\b(did|was|will|can|could|would|should) i\b/g, `$1 ${name}`)
    .replace(/\bmy\b|\bmine\b/g, `${name}'s`)
    .replace(/\b(i|me|myself)\b/g, name);
}

// ── relationships ──────────────────────────────────────────────────────────
const SPOUSE = ["wife", "husband", "partner", "spouse"];
const RELATION_WORDS: Record<string, string[]> = {
  daughter: ["daughter"],
  son: ["son"],
  grandson: ["grandson"],
  granddaughter: ["granddaughter"],
  grandchild: ["grandson", "granddaughter", "grandchild"],
  grandchildren: ["grandson", "granddaughter", "grandchild"],
  grandkid: ["grandson", "granddaughter", "grandchild"],
  child: ["son", "daughter", "child"],
  children: ["son", "daughter", "child"],
  kid: ["son", "daughter", "child"],
  wife: SPOUSE,
  husband: SPOUSE,
  partner: SPOUSE,
  spouse: SPOUSE,
  sister: ["sister"],
  brother: ["brother"],
  sibling: ["sister", "brother", "sibling"],
  niece: ["niece"],
  nephew: ["nephew"],
  cousin: ["cousin"],
  aunt: ["aunt"],
  uncle: ["uncle"],
  friend: ["friend"],
  neighbour: ["neighbour", "neighbor"],
  neighbor: ["neighbour", "neighbor"],
  carer: ["carer", "caregiver"],
  caregiver: ["carer", "caregiver"],
  mother: ["mother", "mum", "mom"],
  mum: ["mother", "mum", "mom"],
  mom: ["mother", "mum", "mom"],
  father: ["father", "dad"],
  dad: ["father", "dad"],
};

function singular(w: string): string {
  if (w === "children" || w === "grandchildren") return w;
  return w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;
}

/** Relationship words in the question (singular form, e.g. "daughter", "grandchildren"). */
export function relationWordsIn(normalized: string): string[] {
  return [...new Set(words(normalized).map(singular).filter((w) => w in RELATION_WORDS))];
}

/** Does a saved relationship label (free text such as "Daughter") match these question words? */
export function relationshipMatches(saved: string, questionWords: readonly string[]): boolean {
  const label = singular(normalize(saved).replace(/^my /, ""));
  return questionWords.some((w) => (RELATION_WORDS[w] ?? [w]).includes(label));
}

function firstName(full: string): string {
  return words(normalize(full))[0] ?? "";
}

// ── routing ────────────────────────────────────────────────────────────────
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function parseRange(q: string): ScheduleRange | null {
  if (/\bday after tomorrow\b/.test(q)) return { type: "day", offset: 2 };
  if (/\btomorrow\b/.test(q)) return { type: "day", offset: 1 };
  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(q)) return { type: "day", offset: 0 };
  for (let i = 0; i < 7; i++) if (new RegExp(`\\b${WEEKDAY_NAMES[i]}s?\\b`).test(q)) return { type: "weekday", weekday: i };
  if (/\b(this week|next week|next few days|coming days|the week)\b/.test(q)) return { type: "week" };
  if (/\bwhat is next\b|\bnext (activity|thing|event|plan|appointment)\b|\bwhat do i have next\b/.test(q)) return { type: "next" };
  return null;
}

const PAST = /\b(did|was|were|happened|happen|last|recently|recent|ago|yesterday|visited|came|went|met|had|used to)\b/;
const SCHEDULE_CUE = /\b(doing|plans?|planned|schedule|agenda|coming up|what is on|what do i have|have i got|anything on|happening|what do i do on|next activity|appointments?)\b/;
const VISIT_CUE = /\b(coming|come|visit|visiting|see|seeing|pop in|popping in|drop by)\b/;
const WHEN_CUE = /\b(when|what time|what day)\b/;
const PREFERENCE_CUE = /\b(do i (like|enjoy|love)|i (like|enjoy|love)|favou?rite|enjoy|prefer|hobb(y|ies)|interests?|music|songs?|food)\b/;
const MEMORY_CUE = /\b(what happened|remember|tell me about|story|what about)\b/;

/** Pick the information source for a question. */
export function routeQuestion(question: string, ctx: RouterContext): Route {
  const q = normalize(question);
  const tokens = new Set(words(q));
  const elderTokens = new Set(words(normalize(ctx.elderName)));

  const people = ctx.family.filter((m) => {
    const first = firstName(m.full_name);
    return (first && tokens.has(first) && !elderTokens.has(first)) || q.includes(normalize(m.full_name));
  });
  const relationWords = relationWordsIn(q);
  const relMembers = ctx.family.filter((m) => relationshipMatches(m.relationship, relationWords));
  const memberIds = [...new Set([...people, ...relMembers].map((m) => m.id))];
  const mentionsSomeone = people.length > 0 || relationWords.length > 0;
  const past = PAST.test(q);
  const range = parseRange(q);

  // 1. about the elder themself
  if (!mentionsSomeone) {
    if (/\b(what is my name|who am i)\b/.test(q)) return { kind: "profile", field: "name" };
    if (/\bhow old am i\b|\bmy age\b/.test(q)) return { kind: "profile", field: "age" };
    if (/\b(when is my birthday|when was i born|my date of birth)\b/.test(q)) return { kind: "profile", field: "birthday" };
    if (/\btell me about (me|myself)\b|\babout myself\b/.test(q)) return { kind: "profile", field: "about" };
  }

  // 2. planned visits (future): "When is Michael coming?"
  const nameHint = question.match(/\b(?:is|will|are)\s+([A-Z][a-z]+)\s+(?:coming|visiting|come|visit)/)?.[1] ?? null;
  if (!past && VISIT_CUE.test(q) && (mentionsSomeone || nameHint || /\b(who is (coming|visiting)|any ?one (coming|visiting)|visitors?)\b/.test(q))) {
    if (WHEN_CUE.test(q) || range || /\b(is|are) .* (coming|visiting)\b/.test(q) || /\bwho is (coming|visiting)\b/.test(q)) {
      return { kind: "visit-plan", memberIds, relationWords, nameHint: people.length ? null : nameHint };
    }
  }

  // 3. schedule (structured, future/habitual)
  if (!past && (range || SCHEDULE_CUE.test(q))) return { kind: "schedule", range: range ?? { type: "week" } };

  // 4. "What time is my walk?" — routine title match
  if (!past && WHEN_CUE.test(q)) {
    const kw = keywords(q, [ctx.elderName]);
    const routineIds = ctx.routines.filter((r) => keywords(r.title).some((t) => kw.includes(t))).map((r) => r.id);
    if (routineIds.length) return { kind: "activity-time", routineIds };
  }

  // 5. family & relationships (structured)
  if (/\b(who is in my family|who are my family|my family members?|who is my family)\b/.test(q)) {
    return { kind: "family", memberIds: ctx.family.map((m) => m.id), relationWords: [], all: true };
  }
  if (people.length && /\b(tell me about|what about|what do you know about)\b/.test(q) && !past) {
    return { kind: "person", memberIds: people.map((m) => m.id) };
  }
  if (mentionsSomeone && !past && !PREFERENCE_CUE.test(q) && /\b(who|name|do i have|how many|tell me about|what about)\b/.test(q)) {
    return { kind: "family", memberIds, relationWords, all: false };
  }

  // 6. personal memories (Walrus)
  if (past || PREFERENCE_CUE.test(q) || MEMORY_CUE.test(q)) {
    const mode: MemoryMode =
      past && /\b(visit|visited|visiting|came to see|came over|see me|saw me)\b/.test(q) ? "recent-visit" : PREFERENCE_CUE.test(q) ? "preference" : "event";
    return { kind: "memory", mode, memberIds };
  }

  // 7. anything else: strict memory search, else honest fallback
  return keywords(q, [ctx.elderName]).length ? { kind: "memory", mode: "general", memberIds } : { kind: "unknown" };
}
