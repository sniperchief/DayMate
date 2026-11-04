// [mock] The session module is MOCKED so the server action's auth handling
// can be tested without Next.js or Supabase.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as ops from "../../src/server/operations";
import { fakeCtx, fakeDb, fakeWalrus, walrusWriter } from "../phase2/fakes";

const session = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock("@/server/context", () => ({ optionalCtx: async () => session.ctx }));

const { askAction } = await import("../../src/app/(app)/ask/actions");

describe("[mock] askAction (server action)", () => {
  beforeEach(() => {
    session.ctx = null;
  });

  it("refuses unauthenticated requests without touching data", async () => {
    expect(await askAction("Who is my daughter?", "00000000-0000-4000-8000-000000000000")).toEqual({ ok: false, error: "Your session has ended. Please sign in again." });
  });

  it("rejects non-string arguments from the client", async () => {
    session.ctx = fakeCtx(fakeDb(), "a");
    expect(await askAction({ evil: true }, "x")).toMatchObject({ ok: false });
    expect(await askAction("Who is my daughter?", 42)).toMatchObject({ ok: false });
  });

  it("answers for the signed-in caregiver's own elder only", async () => {
    const db = fakeDb();
    const walrus = fakeWalrus();
    const ctx = fakeCtx(db, "caregiver-a", walrusWriter(walrus), walrus);
    await ops.saveElder(ctx, { full_name: "Rose Whitfield", description: "Rose.", timezone: "UTC" }, null);
    await ops.createFamilyMember(ctx, { full_name: "Helen Whitfield", relationship: "Daughter" }, null);
    session.ctx = ctx;
    const elderId = db.elders[0]!.id;
    expect(await askAction("Who is my daughter?", elderId)).toMatchObject({ ok: true, answer: { text: "Helen Whitfield is your daughter." } });
    expect(await askAction("Who is my daughter?", "11111111-1111-4111-8111-111111111111")).toEqual({ ok: false, error: "That profile isn't available." });
  });
});
