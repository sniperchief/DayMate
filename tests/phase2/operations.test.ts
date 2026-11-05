// Uses IN-MEMORY FAKES and MOCK Walrus writers (tests/phase2/fakes.ts).
// Application-logic tests only — not evidence of Supabase RLS or Mainnet storage.
import { describe, expect, it } from "vitest";
import { MemoryServiceError } from "../../src/lib/memory";
import * as ops from "../../src/server/operations";
import { fakeCtx, fakeDb, mockWriter, type FakeDb } from "./fakes";

const PROFILE = { full_name: "Margaret Ellison", description: "Loves roses and swing music.", date_of_birth: "1944-03-02", notes: "Private note", timezone: "Europe/London" };

async function withProfile(db: FakeDb, user = "caregiver-a") {
  const ctx = fakeCtx(db, user);
  const r = await ops.saveElder(ctx, PROFILE, null);
  expect(r.ok).toBe(true);
  return ctx;
}

describe("[mock] elder profile", () => {
  it("creates, then edits the single profile", async () => {
    const db = fakeDb();
    const ctx = await withProfile(db);
    expect(db.elders).toHaveLength(1);
    const r = await ops.saveElder(ctx, { ...PROFILE, full_name: "Margaret E. Ellison" }, null);
    expect(r).toMatchObject({ ok: true, message: "Profile saved." });
    expect(db.elders).toHaveLength(1);
    expect(db.elders[0]!.full_name).toBe("Margaret E. Ellison");
  });

  it("writes only the description to Walrus — never DOB or notes", async () => {
    const db = fakeDb();
    const ctx = await withProfile(db);
    const texts = ctx.writer.rememberConfirmed.mock.calls.map((c) => c[0]);
    expect(texts).toEqual(["About Margaret Ellison: Loves roses and swing music."]);
    expect(texts.join(" ")).not.toMatch(/1944|Private note/);
  });

  it("re-saving an unchanged profile does not write to Walrus again", async () => {
    const db = fakeDb();
    const ctx = await withProfile(db);
    await ops.saveElder(ctx, PROFILE, null);
    await ops.saveElder(ctx, { ...PROFILE, notes: "changed private note only" }, null);
    expect(ctx.writer.rememberConfirmed).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid input on the server", async () => {
    const ctx = fakeCtx(fakeDb(), "a");
    const r = await ops.saveElder(ctx, { full_name: "", description: "" }, null);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.fieldErrors).toMatchObject({ full_name: expect.any(String), description: expect.any(String) });
  });

  it("stores a valid photo under the caregiver's folder and rejects bad files", async () => {
    const db = fakeDb();
    const ctx = fakeCtx(db, "caregiver-a");
    await ops.saveElder(ctx, PROFILE, new File(["img"], "me.png", { type: "image/png" }));
    expect(db.elders[0]!.photo_path).toMatch(/^caregiver-a\/[0-9a-f-]+\/elder-[0-9a-f-]+\.png$/);
    const bad = await ops.saveElder(ctx, PROFILE, new File(["x"], "x.gif", { type: "image/gif" }));
    expect(!bad.ok && bad.fieldErrors?.photo).toBeTruthy();
  });
});

describe("[mock] family members", () => {
  it("creates, edits and removes a family member, syncing to Walrus", async () => {
    const db = fakeDb();
    const ctx = await withProfile(db);
    const created = await ops.createFamilyMember(ctx, { full_name: "Clara Moore", relationship: "Daughter", description: "Red hair" }, null);
    expect(created.ok).toBe(true);
    const id = (created as { id: string }).id;
    expect(ctx.writer.rememberConfirmed).toHaveBeenLastCalledWith("Clara Moore is Margaret Ellison's daughter. Red hair.", expect.anything());
    expect(db.walrus.find((w) => w.family_member_id === id)).toMatchObject({ status: "stored" });

    const updated = await ops.updateFamilyMember(ctx, id, { full_name: "Clara Moore", relationship: "Daughter", description: "Curly red hair" }, null);
    expect(updated.ok).toBe(true);
    expect(db.family_members[0]!.description).toBe("Curly red hair");
    expect(db.walrus.find((w) => w.family_member_id === id)!.previous_blob_ids).toHaveLength(1);

    const removed = await ops.deleteFamilyMember(ctx, id);
    expect(removed.ok).toBe(true);
    expect(db.family_members).toHaveLength(0);
    expect(db.walrus.some((w) => w.family_member_id === id)).toBe(false);
  });

  it("requires a profile first", async () => {
    const ctx = fakeCtx(fakeDb(), "a");
    expect(await ops.createFamilyMember(ctx, { full_name: "Clara", relationship: "Daughter" }, null)).toMatchObject({ ok: false, message: "Create the profile first." });
  });

  it("renaming a person refreshes memories that mention them", async () => {
    const db = fakeDb();
    const ctx = await withProfile(db);
    const p = (await ops.createFamilyMember(ctx, { full_name: "Sophie", relationship: "Granddaughter" }, null)) as { id: string };
    await ops.createMemory(ctx, { title: "Engaged", description: "Sophie got engaged.", category: "celebration", related_person_id: p.id });
    await ops.updateFamilyMember(ctx, p.id, { full_name: "Sophie Moore", relationship: "Granddaughter" }, null);
    expect(ctx.writer.rememberConfirmed.mock.calls.at(-1)![0]).toContain("This involves Sophie Moore");
  });
});

describe("[mock] routines", () => {
  it("creates and edits a routine; pausing removes it from Walrus tracking", async () => {
    const db = fakeDb();
    const ctx = await withProfile(db);
    const r = (await ops.createRoutine(ctx, { title: "Morning tea", recurrence: "daily", time_of_day: "07:00", is_active: "on" })) as { ok: true; id: string };
    expect(r.ok).toBe(true);
    expect(db.routines[0]).toMatchObject({ recurrence: "daily", time_of_day: "07:00", activity_date: null, weekday: null, is_active: true });
    expect(db.walrus.find((w) => w.routine_id === r.id)).toMatchObject({ status: "stored" });

    const edited = await ops.updateRoutine(ctx, r.id, { title: "Coffee morning", recurrence: "weekly", weekday: "3", time_of_day: "10:30", is_active: "on" });
    expect(edited.ok).toBe(true);
    expect(db.routines[0]).toMatchObject({ title: "Coffee morning", recurrence: "weekly", weekday: 3 });

    await ops.setRoutineActive(ctx, r.id, false);
    expect(db.routines[0]!.is_active).toBe(false);
    expect(db.walrus.some((w) => w.routine_id === r.id)).toBe(false);
  });

  it("validates schedules server-side", async () => {
    const ctx = await withProfile(fakeDb());
    const r = await ops.createRoutine(ctx, { title: "Visit", recurrence: "none", time_of_day: "14:00" });
    expect(!r.ok && r.fieldErrors?.activity_date).toBeTruthy();
  });
});

describe("[mock] memories", () => {
  it("creates and deletes a memory; Walrus status is tracked separately from the DB save", async () => {
    const db = fakeDb();
    const ctx = await withProfile(db);
    const m = (await ops.createMemory(ctx, { title: "Clara visited", description: "Roast chicken lunch.", category: "visit", event_date: "2026-11-01" })) as { ok: true; id: string };
    expect(m.ok).toBe(true);
    expect(db.walrus.find((w) => w.memory_id === m.id)).toMatchObject({ status: "stored", blob_id: expect.stringMatching(/^MOCK_BLOB_/) });

    expect((await ops.deleteMemory(ctx, m.id)).ok).toBe(true);
    expect(db.memories).toHaveLength(0);
    expect(db.walrus.some((w) => w.memory_id === m.id)).toBe(false);
  });

  it("a DB save succeeds even when the Walrus write fails, and the failure is visible", async () => {
    const db = fakeDb();
    const writer = mockWriter(async () => {
      throw new MemoryServiceError("RELAYER_UNAVAILABLE", "down", "retry");
    });
    const ctx = fakeCtx(db, "a", writer);
    await ops.saveElder(ctx, PROFILE, null);
    const m = (await ops.createMemory(ctx, { title: "Clara visited", description: "Lunch.", category: "visit" })) as { ok: true; id: string };
    expect(m.ok).toBe(true);
    expect(db.memories).toHaveLength(1);
    expect(db.walrus.find((w) => w.memory_id === m.id)).toMatchObject({ status: "failed", blob_id: null });
  });

  it("retry re-writes a failed memory and reports the confirmed result", async () => {
    const db = fakeDb();
    let down = true;
    const writer = mockWriter(async (_t, ns) => {
      if (down) throw new MemoryServiceError("RELAYER_UNAVAILABLE", "down", "retry");
      return { status: "done", jobId: "J1", blobId: "B1", memoryId: "m", owner: "o", namespace: ns };
    });
    const ctx = fakeCtx(db, "a", writer);
    await ops.saveElder(ctx, PROFILE, null);
    const m = (await ops.createMemory(ctx, { title: "Clara visited", description: "Lunch.", category: "visit" })) as { ok: true; id: string };
    down = false;
    expect(await ops.retryWalrus(ctx, "memory", m.id)).toEqual({ ok: true, message: "Stored on Walrus." });
    expect(db.walrus.find((w) => w.memory_id === m.id)).toMatchObject({ status: "stored", blob_id: "B1" });
    expect(await ops.retryWalrus(ctx, "memory", m.id)).toEqual({ ok: true, message: "Already stored on Walrus." });
  });

  it("rejects a related person from another elder", async () => {
    const db = fakeDb();
    const a = await withProfile(db, "caregiver-a");
    const b = await withProfile(db, "caregiver-b");
    const bPerson = (await ops.createFamilyMember(b, { full_name: "Bob", relationship: "Son" }, null)) as { id: string };
    const r = await ops.createMemory(a, { title: "t", description: "d", category: "family", related_person_id: bPerson.id });
    expect(!r.ok && r.fieldErrors?.related_person_id).toBeTruthy();
  });
});

describe("[mock] caregiver data isolation", () => {
  it("caregiver B cannot read, edit or delete caregiver A's records", async () => {
    const db = fakeDb();
    const a = await withProfile(db, "caregiver-a");
    const b = await withProfile(db, "caregiver-b");
    const person = (await ops.createFamilyMember(a, { full_name: "Clara", relationship: "Daughter" }, null)) as { id: string };
    const routine = (await ops.createRoutine(a, { title: "Tea", recurrence: "daily", time_of_day: "07:00", is_active: "on" })) as { id: string };
    const memory = (await ops.createMemory(a, { title: "Visit", description: "Lunch", category: "visit" })) as { id: string };

    expect(await b.repo.get("family_members", person.id)).toBeNull();
    expect((await ops.updateFamilyMember(b, person.id, { full_name: "Hacked", relationship: "x" }, null)).ok).toBe(false);
    expect((await ops.deleteFamilyMember(b, person.id)).ok).toBe(false);
    expect((await ops.updateRoutine(b, routine.id, { title: "Hacked", recurrence: "daily", time_of_day: "01:00" })).ok).toBe(false);
    expect((await ops.deleteRoutine(b, routine.id)).ok).toBe(false);
    expect((await ops.updateMemory(b, memory.id, { title: "Hacked", description: "x", category: "other" })).ok).toBe(false);
    expect((await ops.deleteMemory(b, memory.id)).ok).toBe(false);
    expect((await ops.retryWalrus(b, "memory", memory.id)).ok).toBe(false);

    expect(db.family_members.find((f) => f.id === person.id)!.full_name).toBe("Clara");
    expect(db.memories).toHaveLength(1);
    expect(await b.repo.list("memories", db.elders.find((e) => e.caregiver_id === "caregiver-a")!.id)).toEqual([]);
  });

  it("each elder's Walrus memories go to that elder's own namespace", async () => {
    const db = fakeDb();
    const a = await withProfile(db, "caregiver-a");
    const b = await withProfile(db, "caregiver-b");
    const nsA = a.writer.rememberConfirmed.mock.calls[0]![1].namespace;
    const nsB = b.writer.rememberConfirmed.mock.calls[0]![1].namespace;
    expect(nsA).not.toBe(nsB);
    expect(nsA).not.toBe("daymate-phase1");
  });

  it("rejects malformed IDs before touching the database", async () => {
    const ctx = await withProfile(fakeDb());
    expect(await ops.deleteMemory(ctx, "../../etc")).toMatchObject({ ok: false });
    expect(await ops.retryWalrus(ctx, "admin", "x")).toMatchObject({ ok: false });
  });
});
