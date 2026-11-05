import { addDays, describeSchedule, formatTime, localNow, upcomingOccurrences, type Occurrence } from "../lib/domain/schedule";
import type { Elder, FamilyMember, Memory, Routine } from "../lib/domain/types";
import { uuid } from "../lib/domain/validation";
import { AMBIGUITY_MARGIN, currentEvidence, rankEvidence, type Evidence } from "../lib/ask/evidence";
import { keywords, normalize, routeQuestion, walrusQuery, words, type MemoryMode, type Route, type ScheduleRange } from "../lib/ask/router";
import { elderNamespace } from "../lib/walrus-sync/text";
import type { Ctx } from "./ports";

/**
 * Ask DayMate. Answers come only from this caregiver's saved data:
 * structured facts and schedules from Postgres (RLS-scoped), personal
 * memories from Walrus — accepted only when the blob is the current,
 * confirmed blob of one of this caregiver's records. Answers are built from
 * templates; nothing is invented.
 */

export type Source = "profile" | "family" | "routines" | "memories";

export interface Answer {
  text: string;
  sources: Source[];
  route: Route["kind"];
  /** True when DayMate had nothing (or not enough) to answer from. */
  noAnswer?: boolean;
}

export type AskResult = { ok: true; answer: Answer } | { ok: false; error: string };

export const NOT_SAVED = "I don't have that information saved yet. Your family caregiver can add it for you.";
export const UNKNOWN = "I'm not sure how to answer that yet. You can ask me about your family, your plans, or things you've done.";
export const MEMORY_UNAVAILABLE = "I couldn't look through your memories just now. Please try again in a moment.";
export const MAX_QUESTION_LENGTH = 300;

const RECALL_LIMIT = 20;
const RECALL_LIMIT_WIDE = 60;

interface Data {
  elder: Elder;
  family: FamilyMember[];
  routines: Routine[];
  memories: Memory[];
  today: string;
  now: Date;
}

// ── wording helpers ───────────────────────────────────────────────────────
function friendlyDate(date: string, today: string): string {
  if (date === today) return "today";
  if (date === addDays(today, 1)) return "tomorrow";
  if (date === addDays(today, -1)) return "yesterday";
  const d = new Date(`${date}T00:00:00Z`);
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" })
    .format(d)
    .replace(",", "");
}

function onDate(date: string, today: string): string {
  const f = friendlyDate(date, today);
  return ["today", "tomorrow", "yesterday"].includes(f) ? f : `on ${f}`;
}

function sentence(s: string): string {
  const t = s.trim();
  return !t ? "" : /[.!?]$/.test(t) ? t : `${t}.`;
}

function capital(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function rel(m: FamilyMember): string {
  return m.relationship.trim().toLowerCase();
}

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}

function noAnswer(route: Route["kind"], text = NOT_SAVED, sources: Source[] = []): Answer {
  return { text, sources, route, noAnswer: true };
}

// ── entry point ───────────────────────────────────────────────────────────
export async function ask(ctx: Ctx, question: string, { elderId, now = new Date() }: { elderId?: string; now?: Date } = {}): Promise<AskResult> {
  const q = typeof question === "string" ? question.trim() : "";
  if (!q) return { ok: false, error: "Please type a question." };
  if (q.length > MAX_QUESTION_LENGTH) return { ok: false, error: `Please keep your question under ${MAX_QUESTION_LENGTH} characters.` };
  if (elderId !== undefined && !uuid.safeParse(elderId).success) return { ok: false, error: "That profile isn't available." };

  let data: Data;
  try {
    const elder = await ctx.repo.getElder(); // RLS: only this caregiver's elder
    if (!elder) return { ok: false, error: "Please create the profile first." };
    if (elderId !== undefined && elderId !== elder.id) return { ok: false, error: "That profile isn't available." };
    const [family, routines, memories] = await Promise.all([
      ctx.repo.list("family_members", elder.id),
      ctx.repo.list("routines", elder.id),
      ctx.repo.list("memories", elder.id),
    ]);
    data = { elder, family, routines, memories, now, today: localNow(now, elder.timezone).date };
  } catch (err) {
    console.error("[daymate] ask: data load failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const route = routeQuestion(q, { elderName: data.elder.full_name, family: data.family, routines: data.routines.filter((r) => r.is_active) });

  try {
    switch (route.kind) {
      case "profile":
        return { ok: true, answer: answerProfile(route.field, data) };
      case "family":
        return { ok: true, answer: answerFamily(route, data) };
      case "schedule":
        return { ok: true, answer: answerSchedule(route.range, data) };
      case "visit-plan":
        return { ok: true, answer: answerVisitPlan(route, data) };
      case "activity-time":
        return { ok: true, answer: answerActivityTime(route.routineIds, data) };
      case "person":
        return { ok: true, answer: await answerPerson(ctx, route.memberIds, data) };
      case "memory":
        return { ok: true, answer: await answerMemory(ctx, q, route.mode, route.memberIds, data) };
      case "unknown":
        return { ok: true, answer: noAnswer("unknown", UNKNOWN) };
    }
  } catch (err) {
    console.error("[daymate] ask failed:", err instanceof Error ? err.message : err);
    return { ok: false, error: route.kind === "memory" || route.kind === "person" ? MEMORY_UNAVAILABLE : "Something went wrong. Please try again." };
  }
}

// ── profile ───────────────────────────────────────────────────────────────
function answerProfile(field: "name" | "age" | "birthday" | "about", d: Data): Answer {
  const { elder, today } = d;
  if (field === "name") return { text: `Your name is ${elder.full_name}.`, sources: ["profile"], route: "profile" };
  if (field === "about") {
    return elder.description.trim()
      ? { text: `Your family saved this about you: "${sentence(elder.description)}"`, sources: ["profile"], route: "profile" }
      : noAnswer("profile");
  }
  if (!elder.date_of_birth) return noAnswer("profile");
  const [y, m, day] = elder.date_of_birth.split("-").map(Number) as [number, number, number];
  if (field === "birthday") {
    const label = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, m - 1, day)));
    return { text: `Your birthday is on ${label}.`, sources: ["profile"], route: "profile" };
  }
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const age = ty - y - (tm < m || (tm === m && td < day) ? 1 : 0);
  return { text: `You are ${age} years old.`, sources: ["profile"], route: "profile" };
}

// ── family ────────────────────────────────────────────────────────────────
function describeMember(m: FamilyMember): string {
  return [`${m.full_name} is your ${rel(m)}.`, sentence(m.description)].filter(Boolean).join(" ");
}

function answerFamily(route: Extract<Route, { kind: "family" }>, d: Data): Answer {
  const members = d.family.filter((m) => route.memberIds.includes(m.id));
  if (route.all) {
    if (!members.length) return noAnswer("family", NOT_SAVED, ["family"]);
    return { text: `Your family and friends: ${list(members.map((m) => `${m.full_name} (your ${rel(m)})`))}.`, sources: ["family"], route: "family" };
  }
  if (!members.length) {
    const word = route.relationWords[0];
    return noAnswer("family", word ? `I don't have your ${word} saved yet. Your family caregiver can add them for you.` : NOT_SAVED, ["family"]);
  }
  if (members.length === 1) return { text: describeMember(members[0]!), sources: ["family"], route: "family" };
  // More than one match: say so rather than picking one.
  const intro = route.relationWords.length ? `You have ${members.length} people saved as your ${route.relationWords.join(" or ")}:` : "I found more than one person:";
  return { text: [intro, ...members.map(describeMember)].join("\n"), sources: ["family"], route: "family" };
}

// ── schedule ──────────────────────────────────────────────────────────────
function itemList(occ: Occurrence[]): string {
  return list(occ.map((o) => `${o.routine.title} at ${formatTime(o.time)}`));
}

function answerSchedule(range: ScheduleRange, d: Data): Answer {
  const tz = d.elder.timezone;
  const occ = upcomingOccurrences(d.routines, d.now, tz, 8);
  const src: Source[] = ["routines"];

  if (range.type === "next") {
    const next = occ[0];
    if (!next) return noAnswer("schedule", "I don't see anything planned in the next week.", src);
    return { text: `Your next activity is ${next.routine.title}, ${friendlyDate(next.date, d.today)} at ${formatTime(next.time)}.`, sources: src, route: "schedule" };
  }

  if (range.type === "week") {
    const week = occ.filter((o) => o.date < addDays(d.today, 7));
    if (!week.length) return noAnswer("schedule", "I don't see anything planned in the next week.", src);
    const days = new Map<string, Occurrence[]>();
    for (const o of week) days.set(o.date, [...(days.get(o.date) ?? []), o]);
    const lines = [...days.entries()].map(([date, items]) => `${capital(friendlyDate(date, d.today))}: ${itemList(items)}.`);
    return { text: ["Here's what's coming up:", ...lines].join("\n"), sources: src, route: "schedule" };
  }

  let target: string;
  if (range.type === "day") target = addDays(d.today, range.offset);
  else {
    const todayWeekday = new Date(`${d.today}T00:00:00Z`).getUTCDay();
    target = addDays(d.today, (range.weekday - todayWeekday + 7) % 7);
  }
  const label = friendlyDate(target, d.today);
  const items = occ.filter((o) => o.date === target);
  if (!items.length) {
    const msg = target === d.today ? "You don't have anything else planned for today." : `I don't see anything planned for ${label}.`;
    return noAnswer("schedule", msg, src);
  }
  const when = ["today", "tomorrow"].includes(label) ? capital(label) : `On ${label}`;
  return { text: `${when}, you have ${itemList(items)}.`, sources: src, route: "schedule" };
}

// ── planned visits ────────────────────────────────────────────────────────
function mentions(text: string, needles: readonly string[]): boolean {
  const t = new Set(words(normalize(text)));
  return needles.some((n) => n && words(normalize(n)).every((w) => t.has(w)));
}

function nextOccurrences(routines: Routine[], d: Data): Occurrence[] {
  const seen = new Set<string>();
  return upcomingOccurrences(routines, d.now, d.elder.timezone, 60).filter((o) => (seen.has(o.routine.id) ? false : (seen.add(o.routine.id), true)));
}

function describePlan(o: Occurrence, today: string): string {
  if (o.routine.recurrence === "none") return `${o.routine.title} — ${friendlyDate(o.date, today)} at ${formatTime(o.time)}.`;
  return `${o.routine.title} — ${describeSchedule(o.routine).replace(/^Every/, "every")} (next: ${friendlyDate(o.date, today)}).`;
}

function answerVisitPlan(route: Extract<Route, { kind: "visit-plan" }>, d: Data): Answer {
  const members = d.family.filter((m) => route.memberIds.includes(m.id));
  const needles = [...members.map((m) => firstName(m.full_name)), ...(route.nameHint ? [route.nameHint] : [])];
  const anyVisitor = !needles.length && !route.relationWords.length;
  const matching = d.routines.filter((r) => {
    if (!r.is_active) return false;
    const text = `${r.title} ${r.description}`;
    if (anyVisitor) return /\bvisit/i.test(text) || d.family.some((m) => mentions(text, [firstName(m.full_name)]));
    return mentions(text, needles) || mentions(text, route.relationWords);
  });
  const occ = nextOccurrences(matching, d);
  const who = members.length ? list(members.map((m) => firstName(m.full_name))) : route.nameHint ?? (route.relationWords[0] ? `your ${route.relationWords[0]}` : "anyone");
  if (!occ.length) {
    return noAnswer("visit-plan", `I don't see a visit from ${who} planned. Your family caregiver can add it to your routines.`, ["routines"]);
  }
  const lines = occ.slice(0, 3).map((o) => describePlan(o, d.today));
  return { text: lines.length === 1 ? `I have this planned: ${lines[0]}` : ["I have these planned:", ...lines].join("\n"), sources: ["routines"], route: "visit-plan" };
}

function answerActivityTime(routineIds: string[], d: Data): Answer {
  const routines = d.routines.filter((r) => routineIds.includes(r.id) && r.is_active);
  const occ = nextOccurrences(routines, d);
  if (!occ.length) return noAnswer("activity-time", "I don't see that activity coming up.", ["routines"]);
  const lines = occ.map((o) => `${o.routine.title} is ${describeSchedule(o.routine).replace(/^Every/, "every")}. The next one is ${friendlyDate(o.date, d.today)} at ${formatTime(o.time)}.`);
  return { text: lines.join("\n"), sources: ["routines"], route: "activity-time" };
}

// ── Walrus memories ───────────────────────────────────────────────────────
async function retrieve(ctx: Ctx, query: string, d: Data, opts: { strict?: boolean } = {}): Promise<Evidence[]> {
  const records = await ctx.repo.walrusRecords(d.elder.id); // RLS-scoped: this caregiver only
  if (!records.some((r) => r.status === "stored")) return [];
  const namespace = elderNamespace(d.elder.id);
  const kw = keywords(query, [d.elder.full_name]);
  const recallQuery = walrusQuery(query, d.elder.full_name);

  let hits = await ctx.recall.recall(recallQuery, { namespace, limit: RECALL_LIMIT });
  if (!hits.length) {
    // This elder has confirmed memories, so an empty result is unexpected
    // (observed transiently on the relayer): retry once before concluding.
    hits = await ctx.recall.recall(recallQuery, { namespace, limit: RECALL_LIMIT });
  }
  let ranked = rankEvidence(currentEvidence(hits, records).accepted, kw, opts);
  if (!ranked.length && hits.length >= RECALL_LIMIT) {
    // Stale/superseded blobs may have crowded the window; widen once.
    hits = await ctx.recall.recall(recallQuery, { namespace, limit: RECALL_LIMIT_WIDE });
    ranked = rankEvidence(currentEvidence(hits, records).accepted, kw, opts);
  }
  // The source row must still exist (and belong to this elder).
  return ranked.filter((e) => sourceExists(e, d));
}

function sourceExists(e: Evidence, d: Data): boolean {
  const r = e.record;
  if (r.kind === "profile") return r.elder_id === d.elder.id;
  if (r.kind === "memory") return d.memories.some((m) => m.id === r.memory_id);
  if (r.kind === "family_member") return d.family.some((m) => m.id === r.family_member_id);
  return d.routines.some((x) => x.id === r.routine_id && x.is_active);
}

function memoryOf(e: Evidence, d: Data): Memory | undefined {
  return e.record.kind === "memory" ? d.memories.find((m) => m.id === e.record.memory_id) : undefined;
}

/** Phrase one piece of evidence from the CURRENT Postgres row it belongs to. */
function describeEvidence(e: Evidence, d: Data): string {
  const r = e.record;
  if (r.kind === "memory") {
    const m = memoryOf(e, d)!;
    const person = m.related_person_id ? d.family.find((f) => f.id === m.related_person_id) : undefined;
    const title = sentence(m.title);
    const description = sentence(m.description);
    const body = description && description !== title ? `${title} ${description}` : title;
    const withWhom = person ? ` (with ${person.full_name}, your ${rel(person)})` : "";
    if (!m.event_date) return `${body}${withWhom}`;
    const when = m.event_date <= d.today ? capital(onDate(m.event_date, d.today)) : `Coming up ${onDate(m.event_date, d.today)}`;
    return `${when}: ${body}${withWhom}`;
  }
  if (r.kind === "family_member") return describeMember(d.family.find((f) => f.id === r.family_member_id)!);
  if (r.kind === "routine") {
    const rt = d.routines.find((x) => x.id === r.routine_id)!;
    return `You have ${rt.title} — ${describeSchedule(rt).replace(/^Every/, "every")}.`;
  }
  return `Your family saved this about you: "${sentence(d.elder.description)}"`;
}

function sourcesOf(evidence: Evidence[]): Source[] {
  const map = { memory: "memories", family_member: "family", routine: "routines", profile: "profile" } as const;
  return [...new Set(evidence.map((e) => map[e.record.kind]))];
}

async function answerMemory(ctx: Ctx, question: string, mode: MemoryMode, memberIds: string[], d: Data): Promise<Answer> {
  const evidence = await retrieve(ctx, question, d, { strict: mode === "general" });
  const people = d.family.filter((m) => memberIds.includes(m.id));

  if (mode === "recent-visit") {
    const visits = evidence
      .map((e) => ({ e, m: memoryOf(e, d) }))
      .filter((x): x is { e: Evidence; m: Memory } => Boolean(x.m))
      .filter(({ m }) => m.category === "visit" || /\bvisit/i.test(`${m.title} ${m.description}`))
      .filter(({ m }) => !m.event_date || m.event_date <= d.today)
      .filter(({ m }) => !people.length || people.some((p) => m.related_person_id === p.id || mentions(`${m.title} ${m.description}`, [firstName(p.full_name)])));
    const dated = visits.filter((v) => v.m.event_date).sort((a, b) => b.m.event_date!.localeCompare(a.m.event_date!));
    if (!visits.length) return noAnswer("memory", "I don't have a recent visit saved yet. Your family caregiver can add it for you.", ["memories"]);
    if (!dated.length) {
      return { text: `I have a visit saved, but not when it happened: ${describeEvidence(visits[0]!.e, d)}`, sources: ["memories"], route: "memory" };
    }
    const latest = dated.filter((v) => v.m.event_date === dated[0]!.m.event_date);
    const lines = latest.map(({ e, m }) => {
      const person = m.related_person_id ? d.family.find((f) => f.id === m.related_person_id) : undefined;
      return person
        ? `${person.full_name}, your ${rel(person)}, visited you ${onDate(m.event_date!, d.today)}. ${sentence(m.description)}`
        : describeEvidence(e, d);
    });
    return { text: lines.length === 1 ? lines[0]! : ["I have more than one visit saved for that day:", ...lines].join("\n"), sources: ["memories"], route: "memory" };
  }

  if (!evidence.length) return noAnswer("memory", mode === "general" ? UNKNOWN : NOT_SAVED, ["memories"]);

  const top = evidence[0]!;
  const close = evidence.filter((e, i) => i > 0 && e.score - top.score <= (mode === "preference" ? 0.05 : AMBIGUITY_MARGIN)).slice(0, 1);
  if (mode === "general" || !close.length) {
    return { text: describeEvidence(top, d), sources: sourcesOf([top]), route: "memory" };
  }
  // Two results are similarly relevant: show both rather than guess or merge them.
  const shown = [top, ...close];
  const intro = mode === "preference" ? "Here's what I have saved:" : "I found two memories that might match:";
  return { text: [intro, ...shown.map((e) => describeEvidence(e, d))].join("\n"), sources: sourcesOf(shown), route: "memory" };
}

// ── mixed: "Tell me about Helen" ──────────────────────────────────────────
async function answerPerson(ctx: Ctx, memberIds: string[], d: Data): Promise<Answer> {
  const members = d.family.filter((m) => memberIds.includes(m.id));
  if (members.length !== 1) return answerFamily({ kind: "family", memberIds, relationWords: [], all: false }, d);
  const person = members[0]!;
  const first = firstName(person.full_name);
  const lines = [describeMember(person)];
  const sources: Source[] = ["family"];

  const plans = nextOccurrences(d.routines.filter((r) => r.is_active && mentions(`${r.title} ${r.description}`, [first])), d).slice(0, 2);
  if (plans.length) {
    lines.push(`Coming up: ${plans.map((o) => describePlan(o, d.today)).join(" ")}`);
    sources.push("routines");
  }

  try {
    const evidence = await retrieve(ctx, `${person.full_name} ${person.relationship}`, d);
    const memories = evidence
      .map((e) => ({ e, m: memoryOf(e, d) }))
      .filter((x): x is { e: Evidence; m: Memory } => Boolean(x.m))
      .filter(({ m }) => m.related_person_id === person.id || mentions(`${m.title} ${m.description}`, [first]))
      .sort((a, b) => (b.m.event_date ?? "").localeCompare(a.m.event_date ?? ""))
      .slice(0, 2);
    if (memories.length) {
      lines.push(`Memories with ${first}:`, ...memories.map(({ e }) => describeEvidence(e, d)));
      sources.push("memories");
    }
  } catch (err) {
    console.error("[daymate] ask: person memories unavailable:", err instanceof Error ? err.message : err);
    lines.push("(I couldn't look through your memories just now.)");
  }
  return { text: lines.join("\n"), sources, route: "person" };
}
