// Uses MOCK Walrus writers and an in-memory store (tests/phase2/fakes.ts).
// Tests sync logic only — not evidence of Mainnet storage.
import { describe, expect, it } from "vitest";
import { MemoryServiceError } from "../../src/lib/memory";
import { IN_FLIGHT_GRACE_MS, performWrite, prepareSync, type SyncSource } from "../../src/lib/walrus-sync/sync";
import { contentHash, elderNamespace } from "../../src/lib/walrus-sync/text";
import { fakeDb, fakeSyncStore, mockWriter } from "./fakes";

const ELDER = "11111111-1111-4111-8111-111111111111";
const src = (text: string | null, sourceId = "22222222-2222-4222-8222-222222222222"): SyncSource => ({ caregiverId: "u1", elderId: ELDER, kind: "memory", sourceId, text });

async function sync(store: ReturnType<typeof fakeSyncStore>, writer: ReturnType<typeof mockWriter>, source: SyncSource, opts?: { force?: boolean; now?: number }) {
  const p = await prepareSync(store, source, opts);
  return p.action === "write" ? performWrite(store, writer, p) : p;
}

describe("[mock] Walrus sync — success", () => {
  it("marks stored only after a confirmed write, in the elder's own namespace", async () => {
    const db = fakeDb();
    const store = fakeSyncStore(db);
    const writer = mockWriter();
    const prepared = await prepareSync(store, src("Clara visited."));
    expect(prepared.action).toBe("write");
    expect(db.walrus[0]).toMatchObject({ status: "pending", blob_id: null }); // DB saved, Walrus not yet

    const outcome = await performWrite(store, writer, prepared as Extract<typeof prepared, { action: "write" }>);
    expect(outcome).toEqual({ status: "stored", jobId: "MOCK_JOB_1", blobId: "MOCK_BLOB_1" });
    expect(writer.rememberConfirmed).toHaveBeenCalledWith("Clara visited.", { dedupe: true, namespace: elderNamespace(ELDER) });
    expect(db.walrus[0]).toMatchObject({ status: "stored", blob_id: "MOCK_BLOB_1", job_id: "MOCK_JOB_1", content_hash: contentHash("Clara visited.") });
  });
});

describe("[mock] Walrus sync — failures", () => {
  it("records a failed write with a safe message and never marks it stored", async () => {
    const db = fakeDb();
    const writer = mockWriter(async () => {
      throw new MemoryServiceError("RELAYER_UNAVAILABLE", "relayer down", "retry later");
    });
    const outcome = await sync(fakeSyncStore(db), writer, src("Clara visited."));
    expect(outcome).toMatchObject({ status: "failed" });
    expect(db.walrus[0]).toMatchObject({ status: "failed", blob_id: null });
    expect(db.walrus[0]!.error).toContain("RELAYER_UNAVAILABLE");
  });

  it("keeps a timed-out job as pending with its job id (not stored)", async () => {
    const db = fakeDb();
    const writer = mockWriter(async () => {
      throw new MemoryServiceError("WRITE_PENDING", "still running", "wait", { jobId: "job-77", lastStatus: "uploaded" });
    });
    const outcome = await sync(fakeSyncStore(db), writer, src("Clara visited."));
    expect(outcome).toMatchObject({ status: "pending", jobId: "job-77" });
    expect(db.walrus[0]).toMatchObject({ status: "pending", job_id: "job-77", blob_id: null });
  });

  it("treats unexpected errors (e.g. missing Walrus config) as failed", async () => {
    const db = fakeDb();
    const writer = mockWriter(async () => {
      throw new Error("boom");
    });
    expect(await sync(fakeSyncStore(db), writer, src("x"))).toMatchObject({ status: "failed" });
  });

  it("retry after failure writes again and stores", async () => {
    const db = fakeDb();
    const store = fakeSyncStore(db);
    let fail = true;
    const writer = mockWriter(async (_t, ns) => {
      if (fail) throw new MemoryServiceError("TIMEOUT", "slow", "retry");
      return { status: "done", jobId: "J", blobId: "B", memoryId: "m", owner: "o", namespace: ns };
    });
    await sync(store, writer, src("Clara visited."));
    fail = false;
    expect(await sync(store, writer, src("Clara visited."), { force: true })).toMatchObject({ status: "stored", blobId: "B" });
    expect(db.walrus).toHaveLength(1);
    expect(db.walrus[0]!.attempts).toBe(2);
  });

  it("resumes a pending job id before submitting a new write", async () => {
    const db = fakeDb();
    const store = fakeSyncStore(db);
    const pendingWriter = mockWriter(async () => {
      throw new MemoryServiceError("WRITE_PENDING", "still running", "wait", { jobId: "job-77" });
    });
    await sync(store, pendingWriter, src("Clara visited."));

    const writer = mockWriter();
    writer.confirmWrite.mockResolvedValue({ status: "done", jobId: "job-77", blobId: "B77", memoryId: "m", owner: "o", namespace: elderNamespace(ELDER) });
    expect(await sync(store, writer, src("Clara visited."), { force: true })).toMatchObject({ status: "stored", blobId: "B77" });
    expect(writer.confirmWrite).toHaveBeenCalledWith("job-77", undefined, elderNamespace(ELDER));
    expect(writer.rememberConfirmed).not.toHaveBeenCalled();
  });
});

describe("[mock] Walrus sync — duplicate prevention", () => {
  it("does not write again when the text is unchanged", async () => {
    const db = fakeDb();
    const store = fakeSyncStore(db);
    const writer = mockWriter();
    await sync(store, writer, src("Clara visited."));
    const again = await sync(store, writer, src("  Clara visited.  "));
    expect(again).toMatchObject({ action: "skip", reason: "unchanged" });
    expect(writer.rememberConfirmed).toHaveBeenCalledTimes(1);
  });

  it("does not start a second write while one is in flight", async () => {
    const db = fakeDb();
    const store = fakeSyncStore(db);
    await prepareSync(store, src("Clara visited."));
    expect(await prepareSync(store, src("Clara visited."))).toMatchObject({ action: "skip", reason: "in-flight" });
    // but an abandoned pending write may be retried
    expect((await prepareSync(store, src("Clara visited."), { now: Date.now() + IN_FLIGHT_GRACE_MS + 1 })).action).toBe("write");
  });

  it("an edit updates the same record and keeps the old blob as superseded", async () => {
    const db = fakeDb();
    const store = fakeSyncStore(db);
    const writer = mockWriter();
    await sync(store, writer, src("Clara visited."));
    await sync(store, writer, src("Clara visited for lunch."));
    expect(db.walrus).toHaveLength(1);
    expect(db.walrus[0]).toMatchObject({ status: "stored", blob_id: "MOCK_BLOB_2", previous_blob_ids: ["MOCK_BLOB_1"] });
  });

  it("a stale result from an older edit cannot overwrite the newer one", async () => {
    const db = fakeDb();
    const store = fakeSyncStore(db);
    const first = await prepareSync(store, src("version 1"));
    await prepareSync(store, src("version 2"), { force: true }); // edited before write 1 finished
    const outcome = await performWrite(store, mockWriter(), first as Extract<typeof first, { action: "write" }>);
    expect(outcome.status).toBe("superseded");
    // the newer edit stays pending, and the blob written for version 1 is still tracked
    expect(db.walrus[0]).toMatchObject({ status: "pending", content_hash: contentHash("version 2"), previous_blob_ids: [outcome.blobId] });
  });

  it("the newer write keeps the superseded blob when it finishes later (race)", async () => {
    const db = fakeDb();
    const store = fakeSyncStore(db);
    const writer = mockWriter();
    const first = (await prepareSync(store, src("version 1"))) as Extract<Awaited<ReturnType<typeof prepareSync>>, { action: "write" }>;
    const second = (await prepareSync(store, src("version 2"), { force: true })) as typeof first;
    const o1 = await performWrite(store, writer, first); // superseded, blob 1 recorded
    const o2 = await performWrite(store, writer, second); // stored, must not wipe blob 1
    expect(o1.status).toBe("superseded");
    expect(o2.status).toBe("stored");
    expect(db.walrus[0]).toMatchObject({ status: "stored", blob_id: o2.blobId, previous_blob_ids: [o1.blobId] });
  });

  it("a superseded write for a deleted item is dropped without error", async () => {
    const db = fakeDb();
    const store = fakeSyncStore(db);
    const first = await prepareSync(store, src("version 1"));
    db.walrus = []; // source deleted (FK cascade) while the write ran
    const outcome = await performWrite(store, mockWriter(), first as Extract<typeof first, { action: "write" }>);
    expect(outcome.status).toBe("superseded");
    expect(db.walrus).toHaveLength(0);
  });

  it("removes the record when an item should no longer be on Walrus", async () => {
    const db = fakeDb();
    const store = fakeSyncStore(db);
    await sync(store, mockWriter(), src("Morning walk"));
    expect(await prepareSync(store, src(null))).toEqual({ action: "removed" });
    expect(db.walrus).toHaveLength(0);
  });
});
