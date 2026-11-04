// Uses IN-MEMORY FAKES and a MOCK Walrus (tests/phase2/fakes.ts) whose
// "semantic" distance is a keyword heuristic. These tests check routing,
// filtering and answer logic — not real embeddings or Mainnet storage
// (see `npm run ask:smoke` for the live check).
import { beforeEach, describe, expect, it } from "vitest";
import { MEMORY_UNAVAILABLE, NOT_SAVED, UNKNOWN, ask, type Answer } from "../../src/server/ask";
import * as ops from "../../src/server/operations";
import { elderNamespace } from "../../src/lib/walrus-sync/text";
import { fakeCtx, fakeDb, fakeWalrus, walrusWriter, type FakeDb, type FakeWalrus } from "../phase2/fakes";

// Wednesday 4 November 2026, 08:30 in London
const NOW = new Date("2026-11-04T08:30:00Z");
const UUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}|FAKE_WALRUS_BLOB|FAKE_JOB|blob/i;

let db: FakeDb;
let walrus: FakeWalrus;
let ctx: ReturnType<typeof fakeCtx>;
const ids: Record<string, string> = {};

async function must(r: Promise<ops.OpResult>, label: string): Promise<string> {
  const res = await r;
  if (!res.ok) throw new Error(`${label}: ${res.message} ${JSON.stringify(res.fieldErrors)}`);
  return res.id!;
}

async function seed(c: ReturnType<typeof fakeCtx>) {
  await must(ops.saveElder(c, { full_name: "Rose Whitfield", description: "Rose is a retired nurse who loves crosswords and brass band music.", date_of_birth: "1945-05-17", timezone: "Europe/London" }, null), "profile");
  ids.helen = await must(ops.createFamilyMember(c, { full_name: "Helen Whitfield", relationship: "Daughter", description: "Helen is a vet with curly brown hair." }, null), "helen");
  ids.sam = await must(ops.createFamilyMember(c, { full_name: "Sam Whitfield", relationship: "Grandson", description: "Sam is 12 and loves football." }, null), "sam");
  ids.tea = await must(ops.createRoutine(c, { title: "Morning tea", recurrence: "daily", time_of_day: "07:00", is_active: "on" }), "tea");
  ids.walk = await must(ops.createRoutine(c, { title: "Daily walk", recurrence: "daily", time_of_day: "09:30", is_active: "on" }), "walk");
  ids.coffee = await must(ops.createRoutine(c, { title: "Coffee morning", recurrence: "weekly", weekday: "3", time_of_day: "10:30", is_active: "on" }), "coffee");
  ids.helenVisit = await must(ops.createRoutine(c, { title: "Helen visits", recurrence: "none", activity_date: "2026-11-07", time_of_day: "14:00", is_active: "on" }), "visit");
  ids.choir = await must(ops.createRoutine(c, { title: "Choir practice", recurrence: "weekly", weekday: "4", time_of_day: "18:00" }), "choir (paused)");
  ids.roseBush = await must(
    ops.createMemory(c, { title: "Helen brought a rose bush", description: "Helen visited and planted a yellow climbing rose by the back door.", category: "visit", event_date: "2026-11-03", related_person_id: ids.helen }),
    "m1",
  );
  ids.samLunch = await must(
    ops.createMemory(c, { title: "Sam came for Sunday lunch", description: "Sam visited and talked about his football match.", category: "visit", event_date: "2026-10-25", related_person_id: ids.sam }),
    "m2",
  );
  ids.music = await must(ops.createMemory(c, { title: "Favourite music", description: "Rose loves brass band music, especially the Grimethorpe Colliery Band.", category: "preference" }), "m3");
  ids.birthday = await must(
    ops.createMemory(c, { title: "80th birthday party", description: "At the 80th birthday party the family sang together in the garden and Helen baked a lemon cake.", category: "celebration", event_date: "2025-05-17" }),
    "m4",
  );
}

async function answer(q: string, c = ctx): Promise<Answer> {
  const r = await ask(c, q, { now: NOW });
  if (!r.ok) throw new Error(`ask failed: ${r.error}`);
  expect(r.answer.text, "answers never expose IDs or blob IDs").not.toMatch(UUIDISH);
  return r.answer;
}

beforeEach(async () => {
  db = fakeDb();
  walrus = fakeWalrus();
  ctx = fakeCtx(db, "caregiver-a", walrusWriter(walrus), walrus);
  await seed(ctx);
  walrus.recallCalls.length = 0;
});

describe("[mock] family & relationship questions (Supabase)", () => {
  it("answers 'Who is my daughter?' from the family list, without Walrus", async () => {
    const a = await answer("Who is my daughter?");
    expect(a).toMatchObject({ text: "Helen Whitfield is your daughter. Helen is a vet with curly brown hair.", sources: ["family"], route: "family" });
    expect(walrus.recallCalls).toHaveLength(0);
  });

  it("maps plurals and synonyms (grandchildren → grandson)", async () => {
    expect((await answer("Who are my grandchildren?")).text).toContain("Sam Whitfield is your grandson.");
  });

  it("says so when a relationship isn't saved", async () => {
    const a = await answer("Who is my son?");
    expect(a.noAnswer).toBe(true);
    expect(a.text).toBe("I don't have your son saved yet. Your family caregiver can add them for you.");
  });

  it("lists every match instead of guessing when two people share a relationship", async () => {
    await ops.createFamilyMember(ctx, { full_name: "Anna Whitfield", relationship: "Daughter" }, null);
    const a = await answer("Who is my daughter?");
    expect(a.text.split("\n")[0]).toBe("You have 2 people saved as your daughter:");
    expect(a.text).toContain("Helen Whitfield is your daughter.");
    expect(a.text).toContain("Anna Whitfield is your daughter.");
  });

  it("answers profile questions", async () => {
    expect((await answer("What is my name?")).text).toBe("Your name is Rose Whitfield.");
    expect((await answer("How old am I?")).text).toBe("You are 81 years old.");
    expect((await answer("When is my birthday?")).text).toBe("Your birthday is on 17 May.");
  });
});

describe("[mock] routine questions (Supabase schedule, elder's time zone)", () => {
  it("tomorrow: daily routines only (Thursday's paused choir excluded)", async () => {
    const a = await answer("What am I doing tomorrow?");
    expect(a.text).toBe("Tomorrow, you have Morning tea at 7:00 AM and Daily walk at 9:30 AM.");
    expect(walrus.recallCalls).toHaveLength(0);
  });

  it("today: weekly recurrence on Wednesday, skipping times already past", async () => {
    expect((await answer("What's on today?")).text).toBe("Today, you have Daily walk at 9:30 AM and Coffee morning at 10:30 AM.");
  });

  it("a named weekday includes one-time activities", async () => {
    expect((await answer("What do I have on Saturday?")).text).toBe("On Saturday 7 November, you have Morning tea at 7:00 AM, Daily walk at 9:30 AM and Helen visits at 2:00 PM.");
  });

  it("next activity", async () => {
    expect((await answer("What is my next activity?")).text).toBe("Your next activity is Daily walk, today at 9:30 AM.");
  });

  it("when is a person coming (one-time plan)", async () => {
    expect((await answer("When is Helen coming?")).text).toBe("I have this planned: Helen visits — Saturday 7 November at 2:00 PM.");
  });

  it("does not invent a visit that isn't scheduled", async () => {
    const a = await answer("When is Michael coming?");
    expect(a.text).toBe("I don't see a visit from Michael planned. Your family caregiver can add it to your routines.");
    expect((await answer("When is my grandson coming?")).text).toContain("I don't see a visit from Sam planned.");
  });

  it("time of a recurring activity", async () => {
    expect((await answer("What time is my walk?")).text).toBe("Daily walk is every day at 9:30 AM. The next one is today at 9:30 AM.");
  });

  it("paused activities are not reported as planned", async () => {
    const a = await answer("What do I have on Thursday?");
    expect(a.text).not.toContain("Choir");
  });
});

describe("[mock] personal memory questions (Walrus)", () => {
  it("recent visit: picks the latest dated visit and names the person", async () => {
    const a = await answer("Who visited me recently?");
    expect(a.text).toBe("Helen Whitfield, your daughter, visited you yesterday. Helen visited and planted a yellow climbing rose by the back door.");
    expect(a.sources).toEqual(["memories"]);
    expect(walrus.recallCalls[0]).toMatchObject({ namespace: elderNamespace(db.elders[0]!.id) });
  });

  it("past visit by a named person", async () => {
    expect((await answer("When did Sam last visit?")).text).toContain("Sam Whitfield, your grandson, visited you on Sunday 25 October.");
  });

  it("past event, phrased as past with its date", async () => {
    const a = await answer("What happened at my birthday celebration?");
    expect(a.text).toBe("On Saturday 17 May 2025: 80th birthday party. At the 80th birthday party the family sang together in the garden and Helen baked a lemon cake.");
  });

  it("preferences may come from more than one saved item, shown separately", async () => {
    const a = await answer("What music do I enjoy?");
    expect(a.text).toContain("Grimethorpe Colliery Band");
    expect(a.text).not.toMatch(/football/);
  });

  it("retries once when the relayer transiently returns nothing", async () => {
    walrus.emptyCalls = 1;
    expect((await answer("What happened at my birthday celebration?")).text).toContain("80th birthday party");
    expect(walrus.recallCalls).toHaveLength(2);
  });

  it("recalls with the question rewritten into the third person", async () => {
    await answer("Who visited me recently?");
    expect(walrus.recallCalls[0]!.query).toBe("who visited rose recently");
  });

  it("empty recall: nothing saved → honest answer", async () => {
    const empty = fakeDb();
    const w = fakeWalrus();
    const c = fakeCtx(empty, "caregiver-z", walrusWriter(w), w);
    await ops.saveElder(c, { full_name: "Ann Lee", description: "Ann.", timezone: "UTC" }, null);
    expect((await answer("What music do I enjoy?", c)).text).toBe(NOT_SAVED);
  });

  it("ambiguous: two equally relevant memories are both shown, not merged", async () => {
    await ops.createMemory(ctx, { title: "Garden party", description: "The family had a garden party with a lemon cake.", category: "celebration", event_date: "2026-07-12" });
    const a = await answer("What happened with the lemon cake?");
    expect(a.text.split("\n")[0]).toBe("I found two memories that might match:");
    expect(a.text).toContain("80th birthday party");
    expect(a.text).toContain("Garden party");
  });
});

describe("[mock] stale, deleted, pending, failed and forged Walrus results are excluded", () => {
  it("superseded blob (memory edited): old text never used", async () => {
    await ops.updateMemory(ctx, ids.music!, { title: "Favourite music", description: "Rose loves choir music and old hymns.", category: "preference" });
    expect(walrus.blobs.some((b) => b.text.includes("Grimethorpe"))).toBe(true); // still on "Walrus"
    const a = await answer("Do I like brass band music?");
    expect(a.text).not.toContain("Grimethorpe");
    // a question only the superseded blob could answer gets an honest "not saved"
    expect((await answer("Tell me about the Grimethorpe Colliery")).text).toBe(NOT_SAVED);
    const rec = db.walrus.find((w) => w.memory_id === ids.music)!;
    expect(rec.previous_blob_ids).toHaveLength(1);
  });

  it("deleted memory: its blob remains on Walrus but is never returned", async () => {
    await ops.deleteMemory(ctx, ids.birthday!);
    expect(walrus.blobs.some((b) => b.text.includes("80th birthday"))).toBe(true);
    const a = await answer("What happened at my birthday celebration?");
    expect(a.text).toBe(NOT_SAVED);
  });

  it.each(["pending", "failed"] as const)("%s record: excluded", async (status) => {
    db.walrus.find((w) => w.memory_id === ids.music)!.status = status;
    const a = await answer("What music do I enjoy?");
    expect(a.text).not.toContain("Grimethorpe");
    expect((await answer("Tell me about the Grimethorpe Colliery")).text).toBe(NOT_SAVED);
  });

  it("a relayer hit whose text doesn't match the saved content hash is rejected", async () => {
    const current = db.walrus.find((w) => w.memory_id === ids.music)!;
    walrus.injected.push({ blobId: current.blob_id!, text: "Rose secretly loves skydiving.", distance: 0.01 });
    // only the forged text mentions skydiving; it must not select the real record
    expect((await answer("Do I enjoy skydiving?")).text).toBe(NOT_SAVED);
  });

  it("unknown or foreign blob IDs are rejected", async () => {
    walrus.injected.push({ blobId: "SOMEONE_ELSES_BLOB", text: "Rose's favourite music is heavy metal.", distance: 0.01 });
    expect((await answer("Do I enjoy heavy metal?")).text).toBe(NOT_SAVED);
  });

  it("a superseded blob ID with its old (matching) text is rejected", async () => {
    const before = db.walrus.find((w) => w.memory_id === ids.music)!;
    const oldBlob = before.blob_id!;
    const oldText = walrus.blobs.find((b) => b.blobId === oldBlob)!.text;
    await ops.updateMemory(ctx, ids.music!, { title: "Favourite music", description: "Rose loves choir music and old hymns.", category: "preference" });
    walrus.injected.push({ blobId: oldBlob, text: oldText, distance: 0.0 });
    expect((await answer("Tell me about the Grimethorpe Colliery")).text).toBe(NOT_SAVED);
  });

  it("widens recall once when stale blobs crowd out current ones", async () => {
    for (let i = 0; i < 25; i++) walrus.injected.push({ blobId: `STALE_${i}`, text: `stale music note ${i}`, distance: 0.001 });
    const a = await answer("What music do I enjoy?");
    expect(walrus.recallCalls.map((c) => c.limit)).toEqual([20, 60]);
    expect(a.text).toContain("Grimethorpe");
  });
});

describe("[mock] mixed and unknown questions", () => {
  it("'Tell me about Helen' combines family, routines and memories", async () => {
    const a = await answer("Tell me about Helen");
    expect(a.route).toBe("person");
    expect(a.sources).toEqual(["family", "routines", "memories"]);
    expect(a.text).toContain("Helen Whitfield is your daughter.");
    expect(a.text).toContain("Coming up: Helen visits — Saturday 7 November at 2:00 PM.");
    expect(a.text).toContain("yellow climbing rose");
  });

  it("unknown questions get an honest answer", async () => {
    expect((await answer("What's the weather like?")).text).toBe(UNKNOWN);
    expect((await answer("??")).text).toBe(UNKNOWN);
  });

  it("each question is answered from current data, not earlier answers", async () => {
    expect((await answer("Who is my daughter?")).text).toContain("Helen");
    await ops.updateFamilyMember(ctx, ids.helen!, { full_name: "Helen Jones", relationship: "Daughter", description: "" }, null);
    expect((await answer("Who is my daughter?")).text).toBe("Helen Jones is your daughter.");
  });
});

describe("[mock] errors, validation and access control", () => {
  it("Walrus outage: memory questions report it; structured questions still work", async () => {
    walrus.failRecall = true;
    expect(await ask(ctx, "What music do I enjoy?", { now: NOW })).toEqual({ ok: false, error: MEMORY_UNAVAILABLE });
    expect((await answer("Who is my daughter?")).text).toContain("Helen");
  });

  it("rejects empty, too-long and non-string questions", async () => {
    expect(await ask(ctx, "  ")).toMatchObject({ ok: false });
    expect(await ask(ctx, "x".repeat(301))).toMatchObject({ ok: false });
    expect(await ask(ctx, undefined as unknown as string)).toMatchObject({ ok: false });
  });

  it("rejects invalid or foreign profile IDs", async () => {
    expect(await ask(ctx, "Who is my daughter?", { elderId: "not-a-uuid" })).toEqual({ ok: false, error: "That profile isn't available." });
    const other = fakeCtx(db, "caregiver-b", walrusWriter(walrus), walrus);
    await ops.saveElder(other, { full_name: "Bob Smith", description: "Bob.", timezone: "UTC" }, null);
    const bobId = db.elders.find((e) => e.caregiver_id === "caregiver-b")!.id;
    expect(await ask(ctx, "Who is my daughter?", { elderId: bobId })).toEqual({ ok: false, error: "That profile isn't available." });
    const roseId = db.elders.find((e) => e.caregiver_id === "caregiver-a")!.id;
    expect(await ask(ctx, "Who is my daughter?", { elderId: roseId })).toMatchObject({ ok: true });
  });

  it("caregiver B never receives caregiver A's data, even if A's blobs come back from recall", async () => {
    const b = fakeCtx(db, "caregiver-b", walrusWriter(walrus), walrus);
    await ops.saveElder(b, { full_name: "Bob Smith", description: "Bob likes chess.", timezone: "UTC" }, null);
    walrus.recallCalls.length = 0;
    // simulate a misbehaving relayer returning A's blobs in B's recall
    for (const blob of walrus.blobs.filter((x) => x.namespace !== elderNamespace(db.elders.find((e) => e.caregiver_id === "caregiver-b")!.id))) {
      walrus.injected.push({ blobId: blob.blobId, text: blob.text, distance: 0.01 });
    }
    expect((await answer("Who is my daughter?", b)).text).not.toContain("Helen");
    for (const q of ["What music do I enjoy?", "Who visited me recently?", "What happened at my birthday celebration?", "Tell me about Helen"]) {
      const a = await answer(q, b);
      expect(a.text).not.toMatch(/Helen|Rose|Grimethorpe|Sam/);
    }
    // every recall B triggered went to B's own namespace
    const bNamespace = elderNamespace(db.elders.find((e) => e.caregiver_id === "caregiver-b")!.id);
    expect(walrus.recallCalls.length).toBeGreaterThan(0);
    expect(new Set(walrus.recallCalls.map((c) => c.namespace))).toEqual(new Set([bNamespace]));
  });

  it("no profile yet → clear error", async () => {
    const c = fakeCtx(fakeDb(), "nobody");
    expect(await ask(c, "Who is my daughter?")).toEqual({ ok: false, error: "Please create the profile first." });
  });
});
