// Memory photos (caregiver side) over in-memory MOCK repo, photo store and Walrus writer.
import { describe, expect, it } from "vitest";
import * as ops from "../../src/server/operations";
import { fakeCtx, fakeDb } from "../phase2/fakes";

const png = (name = "a.png") => new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], name, { type: "image/png" });

async function setup() {
  const db = fakeDb();
  const ctx = fakeCtx(db, "u1");
  await ops.saveElder(ctx, { full_name: "Rose Example", description: "Loves gardening.", date_of_birth: "1944-03-02", notes: "", timezone: "Europe/London" }, null);
  if (!db.elders.length) throw new Error("profile not created");
  return { db, ctx };
}

const values = { title: "Garden party", description: "Tea and cake in the garden.", category: "celebration" };

describe("[mock] memory photos", () => {
  it("stores a photo under the caregiver's folder and saves its path", async () => {
    const { db, ctx } = await setup();
    const r = await ops.createMemory(ctx, values, png());
    expect(r.ok).toBe(true);
    const m = db.memories[0]!;
    expect(m.photo_path).toMatch(new RegExp(`^u1/${db.elders[0]!.id}/memory-[0-9a-f-]+\\.png$`));
    expect(ctx.photos.files.has(m.photo_path!)).toBe(true);
  });

  it("works without a photo and does not write photo_path at all", async () => {
    const { db, ctx } = await setup();
    await ops.createMemory(ctx, values);
    expect("photo_path" in db.memories[0]!).toBe(false);
  });

  it("rejects a non-image file with a field error and saves nothing", async () => {
    const { db, ctx } = await setup();
    const r = await ops.createMemory(ctx, values, new File(["x"], "x.pdf", { type: "application/pdf" }));
    expect(r).toMatchObject({ ok: false, fieldErrors: { photo: expect.any(String) } });
    expect(db.memories).toHaveLength(0);
    expect(ctx.photos.files.size).toBe(0);
  });

  it("replacing a photo removes the old file; removing clears it", async () => {
    const { db, ctx } = await setup();
    const { id } = (await ops.createMemory(ctx, values, png())) as { id: string };
    const first = db.memories[0]!.photo_path!;
    await ops.updateMemory(ctx, id, values, png("b.png"));
    const second = db.memories[0]!.photo_path!;
    expect(second).not.toBe(first);
    expect(ctx.photos.files.has(first)).toBe(false);
    expect(ctx.photos.files.has(second)).toBe(true);

    await ops.updateMemory(ctx, id, { ...values, remove_photo: "on" });
    expect(db.memories[0]!.photo_path).toBeNull();
    expect(ctx.photos.files.size).toBe(0);
  });

  it("deleting a memory deletes its photo", async () => {
    const { db, ctx } = await setup();
    const { id } = (await ops.createMemory(ctx, values, png())) as { id: string };
    expect((await ops.deleteMemory(ctx, id)).ok).toBe(true);
    expect(db.memories).toHaveLength(0);
    expect(ctx.photos.files.size).toBe(0);
  });

  it("a photo-only change does not rewrite the memory on Walrus (text unchanged)", async () => {
    const { ctx } = await setup();
    const { id } = (await ops.createMemory(ctx, values)) as { id: string };
    const writes = ctx.writer.rememberConfirmed.mock.calls.length;
    await ops.updateMemory(ctx, id, values, png());
    expect(ctx.writer.rememberConfirmed.mock.calls.length).toBe(writes);
  });
});
