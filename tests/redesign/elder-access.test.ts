// Read-only elder access over the in-memory MOCK repo (tests/phase2/fakes.ts).
// Cross-elder isolation of the real service-role queries is checked live by `npm run device:check`.
import { describe, expect, it } from "vitest";
import { ask } from "../../src/server/ask";
import { noSync, ReadOnlyError, readOnlyRepo } from "../../src/server/elder-repo";
import type { Ctx } from "../../src/server/ports";
import { fakeCtx, fakeDb } from "../phase2/fakes";

async function setup() {
  const db = fakeDb();
  const caregiver = fakeCtx(db, "u-caregiver");
  await caregiver.repo.insertElder({ full_name: "Rose Example", photo_path: null, date_of_birth: "1940-03-02", description: "Loves gardening.", notes: "", timezone: "Europe/London" });
  const elder = (await caregiver.repo.getElder())!;
  await caregiver.repo.insert("family_members", { elder_id: elder.id, full_name: "Helen Example", relationship: "Daughter", description: "Lives nearby." });
  const memory = await caregiver.repo.insert("memories", { elder_id: elder.id, title: "Tea", description: "Tea in the garden.", category: "visit" });
  const elderCtx: Ctx = { userId: caregiver.userId, repo: readOnlyRepo(caregiver.repo), photos: caregiver.photos, sync: noSync, recall: caregiver.recall };
  return { db, elder, memory, elderCtx };
}

describe("[mock] elder device access is read-only", () => {
  it("reads work", async () => {
    const { elder, elderCtx } = await setup();
    expect((await elderCtx.repo.getElder())?.id).toBe(elder.id);
    expect(await elderCtx.repo.list("family_members", elder.id)).toHaveLength(1);
  });

  it("every write is refused and nothing changes", async () => {
    const { db, elder, memory, elderCtx } = await setup();
    const before = JSON.stringify(db);
    await expect(elderCtx.repo.insert("memories", { elder_id: elder.id, title: "x", description: "x", category: "other" })).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(elderCtx.repo.update("memories", memory.id, { title: "hacked" })).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(elderCtx.repo.remove("memories", memory.id)).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(elderCtx.repo.updateElder(elder.id, { full_name: "x" })).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(elderCtx.repo.insertElder({ full_name: "x", photo_path: null, date_of_birth: null, description: "", notes: "", timezone: "UTC" })).rejects.toBeInstanceOf(ReadOnlyError);
    await expect(elderCtx.sync.now({ caregiverId: "u", elderId: elder.id, kind: "memory", sourceId: memory.id, text: "x" })).rejects.toBeInstanceOf(ReadOnlyError);
    expect(JSON.stringify(db)).toBe(before);
  });

  it("anchoring status is not exposed to the device", async () => {
    const { elder, elderCtx } = await setup();
    expect(await elderCtx.repo.memoryAnchors(elder.id)).toEqual([]);
    expect(elderCtx.anchor).toBeUndefined();
  });

  it("Ask DayMate works unchanged through the read-only context", async () => {
    const { elder, elderCtx } = await setup();
    const res = await ask(elderCtx, "Who is my daughter?", { elderId: elder.id });
    expect(res).toMatchObject({ ok: true, answer: { route: "family" } });
    expect(res.ok && res.answer.text).toContain("Helen Example is your daughter");
  });
});
