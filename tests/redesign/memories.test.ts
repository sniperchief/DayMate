// Elder memories browsing — pure, no network.
import { describe, expect, it } from "vitest";
import type { FamilyMember, Memory } from "../../src/lib/domain/types";
import { memoriesForTab, memoryOfTheDay, memorySpeech, parseTab, pastMemories } from "../../src/lib/elder/memories";

const stamp = "2026-10-01T00:00:00Z";
const mem = (title: string, over: Partial<Memory> = {}): Memory => ({ id: title, caregiver_id: "c", elder_id: "e", title, description: `${title} text`, event_date: null, related_person_id: null, category: "other", created_at: stamp, updated_at: stamp, ...over });
const TODAY = "2026-11-05";
const all = [
  mem("Lunch with Helen", { event_date: "2026-11-01", related_person_id: "h", category: "visit" }),
  mem("Gardening", { event_date: "2026-10-20", category: "preference" }),
  mem("Old wedding", { event_date: "1965-06-12", category: "milestone", photo_path: "c/e/memory-1.png" }),
  mem("Future trip", { event_date: "2026-12-01", category: "activity" }),
  mem("Choir", { category: "activity" }),
];

describe("elder memories", () => {
  it("only past or undated memories, newest first", () => {
    // undated memories sort by the day they were saved (here 2026-10-01)
    expect(pastMemories(all, TODAY).map((m) => m.title)).toEqual(["Lunch with Helen", "Gardening", "Choir", "Old wedding"]);
  });

  it("tabs: with family / things I enjoy", () => {
    expect(memoriesForTab(all, "family", TODAY).map((m) => m.title)).toEqual(["Lunch with Helen"]);
    expect(memoriesForTab(all, "enjoy", TODAY).map((m) => m.title).sort()).toEqual(["Choir", "Gardening"]);
    expect(parseTab("enjoy")).toBe("enjoy");
    expect(parseTab("<script>")).toBe("recent");
    expect(parseTab(undefined)).toBe("recent");
  });

  it("memory of the day is stable for a day, prefers photos, never a future memory", () => {
    const a = memoryOfTheDay(all, TODAY, "elder-1");
    expect(memoryOfTheDay(all, TODAY, "elder-1")).toBe(a);
    expect(a?.title).toBe("Old wedding"); // the only past memory with a photo
    const noPhotos = all.map((m) => ({ ...m, photo_path: null }));
    const picks = new Set(["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09"].map((d) => memoryOfTheDay(noPhotos, d, "elder-1")?.title));
    expect(picks.has("Future trip")).toBe(false);
    expect(memoryOfTheDay([], TODAY, "x")).toBeNull();
  });

  it("speech says title, when, what happened and who", () => {
    const helen: FamilyMember = { id: "h", caregiver_id: "c", elder_id: "e", full_name: "Helen Example", relationship: "Daughter", description: "", photo_path: null, created_at: stamp, updated_at: stamp };
    expect(memorySpeech(all[0]!, helen, TODAY)).toBe("Lunch with Helen. On Sunday. Lunch with Helen text. With Helen, your daughter.");
    expect(memorySpeech(all[4]!, undefined, TODAY)).toBe("Choir. Choir text.");
  });
});
