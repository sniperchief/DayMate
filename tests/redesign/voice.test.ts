// Spoken-question clean-up and elder answers over the in-memory MOCK repo — no network, no speech APIs.
import { describe, expect, it } from "vitest";
import type { FamilyMember } from "../../src/lib/domain/types";
import { peopleInAnswer } from "../../src/lib/elder/answer-people";
import { cleanSpoken, editDistance, fixNames, prepareSpokenQuestion } from "../../src/lib/elder/spoken";
import { DID_NOT_CATCH, elderAsk } from "../../src/server/elder-ask";
import { noSync, readOnlyRepo } from "../../src/server/elder-repo";
import type { Ctx } from "../../src/server/ports";
import { fakeCtx, fakeDb } from "../phase2/fakes";

describe("cleanSpoken", () => {
  it.each([
    ["um who is my daughter", "who is my daughter"],
    ["uh, erm, what am I doing tomorrow", "what am I doing tomorrow"],
    ["who who is my daughter", "who is my daughter"],
    ["who is who is my daughter", "who is my daughter"],
    ["what am I what am I doing today", "what am I doing today"],
    ["Hey DayMate, who is coming today", "who is coming today"],
    ["okay day mate what do I enjoy", "what do I enjoy"],
    ["what do I, you know, enjoy", "what do I enjoy"],
    ["   ", ""],
    ["um uh", ""],
  ])("%j → %j", (input, expected) => {
    expect(cleanSpoken(input)).toBe(expected);
  });

  it("keeps legitimately repeated words that are not adjacent repeats", () => {
    expect(cleanSpoken("is my son my son")).toBe("is my son");
    expect(cleanSpoken("who did I see on Sunday")).toBe("who did I see on Sunday");
  });
});

describe("fixNames (misheard family names)", () => {
  const names = ["Helen", "Raj", "Margaret", "Tom"];
  it.each([
    ["who is ellen", "who is Helen"],
    ["when is ellen's visit", "when is Helen's visit"],
    ["tell me about margret", "tell me about Margaret"],
    ["tell me about margarett", "tell me about Margaret"],
  ])("%j → %j", (input, expected) => {
    expect(fixNames(input, names)).toBe(expected);
  });

  it("never rewrites ordinary words or short words", () => {
    expect(fixNames("who came to see me", names)).toBe("who came to see me");
    expect(fixNames("what is on today", names)).toBe("what is on today"); // "on"/"tom" not touched
    expect(fixNames("who is my son", names)).toBe("who is my son");
    expect(fixNames("when is lunch", names)).toBe("when is lunch");
  });

  it("does nothing when two saved names are both close", () => {
    expect(fixNames("who is ellen", ["Helen", "Ellie"])).toBe("who is ellen"); // both within 2 edits → ambiguous
  });

  it("an exact saved name is never changed", () => {
    expect(fixNames("who is Ellen", ["Helen", "Ellen"])).toBe("who is Ellen");
  });

  it("edit distance basics", () => {
    expect(editDistance("ellen", "helen")).toBe(2);
    expect(editDistance("helen", "hellen")).toBe(1);
    expect(editDistance("margret", "margaret")).toBe(1);
    expect(editDistance("abc", "abc")).toBe(0);
  });

  it("prepareSpokenQuestion adds a capital and a question mark", () => {
    expect(prepareSpokenQuestion("um who is ellen", ["Helen"])).toBe("Who is Helen?");
    expect(prepareSpokenQuestion("uh", ["Helen"])).toBe("");
  });
});

const stamp = "2026-11-01T00:00:00Z";
const member = (id: string, full_name: string, relationship: string, photo_path: string | null = null): FamilyMember => ({
  id,
  caregiver_id: "c",
  elder_id: "e",
  full_name,
  relationship,
  description: "",
  photo_path,
  created_at: stamp,
  updated_at: stamp,
});

describe("peopleInAnswer", () => {
  const family = [member("1", "Helen Example", "Daughter"), member("2", "Raj Patel", "Grandson"), member("3", "Helen Smith", "Friend")];
  it("matches full names, in the order they appear", () => {
    expect(peopleInAnswer("Raj Patel is your grandson. Helen Example is your daughter.", family).map((p) => p.id)).toEqual(["2", "1"]);
  });
  it("matches a first name only when it is unique", () => {
    expect(peopleInAnswer("Raj visits every Sunday.", family).map((p) => p.id)).toEqual(["2"]);
    expect(peopleInAnswer("Helen visits every Sunday.", family)).toEqual([]); // two Helens: ambiguous
  });
  it("finds nobody in a no-answer reply", () => {
    expect(peopleInAnswer("I don't have that information saved yet.", family)).toEqual([]);
  });
});

describe("[mock] elderAsk (read-only device context)", () => {
  async function setup() {
    const db = fakeDb();
    const caregiver = fakeCtx(db, "u-caregiver");
    await caregiver.repo.insertElder({ full_name: "Rose Example", photo_path: null, date_of_birth: null, description: "", notes: "", timezone: "Europe/London" });
    const elder = (await caregiver.repo.getElder())!;
    await caregiver.repo.insert("family_members", { elder_id: elder.id, full_name: "Helen Example", relationship: "Daughter", description: "Lives nearby.", photo_path: "u-caregiver/e/helen.png" });
    const photos = { ...caregiver.photos, signedUrls: async (paths: string[]) => Object.fromEntries(paths.map((p) => [p, `https://signed.example/${p.split("/").pop()}`])) };
    const ctx: Ctx = { userId: caregiver.userId, repo: readOnlyRepo(caregiver.repo), photos, sync: noSync, recall: caregiver.recall };
    return { ctx, elder };
  }

  it("answers a messy spoken question, shows what was heard, and includes the person's photo", async () => {
    const { ctx, elder } = await setup();
    const res = await elderAsk(ctx, { question: "um who's who is my daughter", elderId: elder.id, spoken: true });
    expect(res).toMatchObject({ ok: true, heard: "Who is my daughter?" });
    if (!res.ok) throw new Error("expected ok");
    expect(res.text).toContain("Helen Example is your daughter");
    expect(res.people).toEqual([{ name: "Helen Example", relationship: "daughter", photoUrl: "https://signed.example/helen.png" }]);
  });

  it("corrects a misheard name in a spoken question", async () => {
    const { ctx, elder } = await setup();
    const res = await elderAsk(ctx, { question: "who is ellen", elderId: elder.id, spoken: true });
    expect(res.ok && res.heard).toBe("Who is Helen?");
    expect(res.ok && res.text).toContain("Helen Example is your daughter");
  });

  it("typed and tapped questions are passed through unchanged (no spoken clean-up)", async () => {
    const { ctx, elder } = await setup();
    const res = await elderAsk(ctx, { question: "who is ellen", elderId: elder.id, spoken: false });
    expect(res.ok && res.heard).toBe("who is ellen");
  });

  it("silence or only fillers → a gentle 'didn't catch that'", async () => {
    const { ctx, elder } = await setup();
    expect(await elderAsk(ctx, { question: "um uh", elderId: elder.id, spoken: true })).toEqual({ ok: false, error: DID_NOT_CATCH });
  });

  it("an honest no-answer comes back without photos", async () => {
    const { ctx, elder } = await setup();
    const res = await elderAsk(ctx, { question: "Who is my grandson?", elderId: elder.id, spoken: false });
    expect(res).toMatchObject({ ok: true, noAnswer: true, people: [] });
  });

  it("a foreign elder ID is refused by the unchanged ask()", async () => {
    const { ctx } = await setup();
    const res = await elderAsk(ctx, { question: "Who is my daughter?", elderId: "00000000-0000-4000-8000-000000000000", spoken: false });
    expect(res).toMatchObject({ ok: false });
  });

  it("never returns IDs or storage paths", async () => {
    const { ctx, elder } = await setup();
    const res = await elderAsk(ctx, { question: "Who is my daughter?", elderId: elder.id, spoken: false });
    expect(JSON.stringify(res)).not.toMatch(/u-caregiver\/|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});
