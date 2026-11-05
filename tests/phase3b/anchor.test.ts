// Anchoring lifecycle against MOCK chain / MOCK Tatum / in-memory store — not evidence of Mainnet.
import { describe, expect, it } from "vitest";
import { anchorMemory, MAX_ATTEMPTS, type AnchorDeps } from "../../src/lib/sui-anchor/anchor";
import { canonicalPayload, computeCommitment, toHex } from "../../src/lib/sui-anchor/commitment";
import { SourceError } from "../../src/lib/sui-anchor/verify";
import { CAREGIVER, fakeAnchorStore, fakeChain, fakeTatum, HASH, ledger, MEMORY, memory, OTHER_CAREGIVER, PACKAGE, unhex, walrusRecord } from "./fakes";

function setup(opts: { record?: ReturnType<typeof walrusRecord> | null; mode?: NonNullable<Parameters<typeof fakeChain>[1]>["mode"]; tamper?: Parameters<typeof fakeTatum>[1] } = {}) {
  const l = ledger();
  const store = fakeAnchorStore({ memory: memory(), record: opts.record === undefined ? walrusRecord() : opts.record });
  const chain = fakeChain(l, { mode: opts.mode });
  const verifier = fakeTatum(l, opts.tamper);
  const deps: AnchorDeps = { store, chain, verifier, packageId: PACKAGE, sleep: async () => {}, verifyDelaysMs: [1, 1] };
  return { l, store, chain, verifier, deps };
}

const req = { caregiverId: CAREGIVER, memoryId: MEMORY, expectedContentHash: HASH };

describe("[mock] anchoring — success", () => {
  it("creates a private commitment, submits, and marks verified only after Tatum verification", async () => {
    const { store, chain, verifier, deps } = setup();
    const out = await anchorMemory(deps, req);
    expect(out).toMatchObject({ status: "verified" });
    expect(chain.calls.built).toBe(1);
    expect(verifier.calls).toBeGreaterThanOrEqual(1);

    const a = store.anchors[0]!;
    expect(a).toMatchObject({ status: "verified", version: 1, walrus_blob_id: "MOCK_BLOB_1", verification_provider: "tatum", attempts: 1 });
    expect(a.verified_at).toBeTruthy();
    expect(a.tx_digest).toBe(out.status === "verified" ? out.digest : null);
    // the stored commitment recomputes from the private payload + salt
    expect(a.secret.canonical_payload).toBe(canonicalPayload({ memoryId: MEMORY, version: 1, walrusBlobId: "MOCK_BLOB_1", walrusContentHash: HASH }));
    expect(toHex(computeCommitment(a.secret.canonical_payload, unhex(a.secret.salt)))).toBe(a.secret.commitment);
    expect(store.locks.size).toBe(0); // lease released
  });

  it("is idempotent: a verified version is never re-anchored", async () => {
    const { store, chain, deps } = setup();
    await anchorMemory(deps, req);
    expect(await anchorMemory(deps, req)).toMatchObject({ status: "verified" });
    expect(await anchorMemory(deps, req, { retryFailed: true })).toMatchObject({ status: "verified" });
    expect(chain.calls.built).toBe(1);
    expect(store.anchors).toHaveLength(1);
  });

  it("an edit creates a new version with a new salt and commitment; the old anchor stays as history", async () => {
    const { store, deps } = setup();
    await anchorMemory(deps, req);
    store.state.record = walrusRecord({ blob_id: "MOCK_BLOB_2", previous_blob_ids: ["MOCK_BLOB_1"], content_hash: "b".repeat(64) });
    expect(await anchorMemory(deps, { ...req, expectedContentHash: "b".repeat(64) })).toMatchObject({ status: "verified" });
    expect(store.anchors.map((a) => [a.version, a.walrus_blob_id, a.status])).toEqual([[1, "MOCK_BLOB_1", "verified"], [2, "MOCK_BLOB_2", "verified"]]);
    expect(store.anchors[0]!.secret.salt).not.toBe(store.anchors[1]!.secret.salt);
    expect(store.anchors[0]!.secret.commitment).not.toBe(store.anchors[1]!.secret.commitment);
  });
});

describe("[mock] anchoring — eligibility gate", () => {
  it.each([
    ["pending Walrus write", walrusRecord({ status: "pending", blob_id: null, stored_at: null }), "walrus-pending"],
    ["failed Walrus write", walrusRecord({ status: "failed", blob_id: null, stored_at: null }), "walrus-failed"],
    ["no Walrus record", null, "no-walrus-record"],
  ])("never submits for a %s", async (_n, record, reason) => {
    const { store, chain, deps } = setup({ record });
    expect(await anchorMemory(deps, req)).toEqual({ status: "ineligible", reason });
    expect(chain.calls.built).toBe(0);
    expect(store.anchors).toHaveLength(0);
  });

  it("rejects a deleted memory", async () => {
    const { store, chain, deps } = setup();
    store.state.memory = null;
    expect(await anchorMemory(deps, req)).toEqual({ status: "ineligible", reason: "memory-not-found" });
    expect(chain.calls.built).toBe(0);
  });

  it("rejects another caregiver's memory (store scoping hides it)", async () => {
    const { chain, deps } = setup();
    expect(await anchorMemory(deps, { ...req, caregiverId: OTHER_CAREGIVER })).toEqual({ status: "ineligible", reason: "memory-not-found" });
    expect(chain.calls.built).toBe(0);
  });

  it("rejects a superseded blob and stale content", async () => {
    const { chain, deps, store } = setup();
    store.state.record = walrusRecord({ blob_id: "MOCK_BLOB_2", previous_blob_ids: ["MOCK_BLOB_1"] });
    expect(await anchorMemory(deps, { ...req, blobId: "MOCK_BLOB_1" })).toEqual({ status: "ineligible", reason: "superseded-blob" });
    expect(await anchorMemory(deps, { ...req, expectedContentHash: "f".repeat(64) })).toEqual({ status: "ineligible", reason: "stale-content" });
    expect(chain.calls.built).toBe(0);
  });
});

describe("[mock] anchoring — submission failures and retries", () => {
  it("failed submission (aborted on chain) → failed; explicit retry builds a new transaction", async () => {
    const { store, chain, deps } = setup({ mode: "abort" });
    expect(await anchorMemory(deps, req)).toMatchObject({ status: "failed" });
    expect(store.anchors[0]!.status).toBe("failed");
    const firstDigest = store.anchors[0]!.tx_digest;

    // automatic triggers do not retry a failed anchor
    expect(await anchorMemory(deps, req)).toMatchObject({ status: "failed" });
    expect(chain.calls.built).toBe(1);

    chain.mode = "ok";
    expect(await anchorMemory(deps, req, { retryFailed: true })).toMatchObject({ status: "verified" });
    expect(chain.calls.built).toBe(2);
    expect(store.anchors[0]!.tx_digest).not.toBe(firstDigest);
    expect(store.anchors).toHaveLength(1); // same version, same commitment
  });

  it("build failure (e.g. no gas) → failed with a safe message, nothing sent", async () => {
    const { store, chain, deps } = setup({ mode: "throw-build" });
    const out = await anchorMemory(deps, req);
    expect(out).toMatchObject({ status: "failed" });
    expect(chain.calls.executed).toHaveLength(0);
    expect(store.anchors[0]!.error).toContain("Could not prepare");
  });

  it("timeout with unknown outcome → pending with digest; retry investigates and does NOT re-sign (tx landed)", async () => {
    const { store, chain, deps } = setup({ mode: "timeout-landed" });
    expect(await anchorMemory(deps, req)).toMatchObject({ status: "pending" });
    const a = store.anchors[0]!;
    expect(a).toMatchObject({ status: "pending" });
    expect(a.tx_digest).toBeTruthy();
    expect(a.tx_bytes).toBeTruthy(); // write-ahead before sending

    chain.mode = "ok";
    expect(await anchorMemory(deps, req)).toMatchObject({ status: "verified", digest: a.tx_digest });
    expect(chain.calls.built).toBe(1);
    expect(chain.calls.executed).toHaveLength(1); // found on lookup; not re-sent
  });

  it("timeout with unknown outcome, tx not on chain and still valid → re-sends the SAME signed bytes", async () => {
    const { store, chain, deps } = setup({ mode: "timeout-lost" });
    await anchorMemory(deps, req);
    const digest = store.anchors[0]!.tx_digest!;
    chain.mode = "ok";
    expect(await anchorMemory(deps, req)).toMatchObject({ status: "verified", digest });
    expect(chain.calls.built).toBe(1);
    expect(chain.calls.executed).toEqual([digest, digest]);
  });

  it("tx not on chain and provably dead → safe to build a new one", async () => {
    const { store, chain, deps } = setup({ mode: "timeout-lost" });
    await anchorMemory(deps, req);
    const first = store.anchors[0]!.tx_digest!;
    chain.mode = "ok";
    chain.dead = true;
    expect(await anchorMemory(deps, req)).toMatchObject({ status: "verified" });
    expect(chain.calls.built).toBe(2);
    expect(store.anchors[0]!.tx_digest).not.toBe(first);
  });

  it("if the status lookup itself fails, nothing is sent", async () => {
    const { store, chain, deps } = setup({ mode: "timeout-lost" });
    await anchorMemory(deps, req);
    chain.lookupThrows = true;
    chain.mode = "ok";
    expect(await anchorMemory(deps, req)).toMatchObject({ status: "pending" });
    expect(chain.calls.executed).toHaveLength(1);
    expect(chain.calls.built).toBe(1);
    expect(store.anchors[0]!.status).toBe("pending");
  });

  it("concurrent calls: the lease lets only one worker advance", async () => {
    const { store, chain, deps } = setup();
    // first call creates the row; hold its lease as if another worker were running
    await anchorMemory({ ...deps, verifier: { name: "tatum", getTransaction: async () => null } }, req);
    const id = store.anchors[0]!.id;
    store.locks.set(id, Date.now() + 60_000);
    expect(await anchorMemory(deps, req)).toEqual({ status: "busy" });
    expect(chain.calls.built).toBe(1);
  });

  it("never creates duplicate anchor rows for the same version", async () => {
    const { store, deps } = setup();
    await Promise.all([anchorMemory(deps, req), anchorMemory(deps, req), anchorMemory(deps, req)]);
    expect(store.anchors).toHaveLength(1);
    expect(new Set(store.anchors.map((a) => a.secret.commitment)).size).toBe(1);
  });

  it("stops after MAX_ATTEMPTS new transactions", async () => {
    const { store, chain, deps } = setup({ mode: "abort" });
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await anchorMemory(deps, req, { retryFailed: true });
    expect(chain.calls.built).toBe(MAX_ATTEMPTS);
    expect(store.anchors[0]!.error).toMatch(/Too many attempts/);
  });
});

describe("[mock] anchoring — verification outcomes", () => {
  it("Tatum lagging (not found yet) → stays submitted, never verified; later check verifies", async () => {
    const { store, deps, verifier, chain } = setup();
    const lagging = { name: "tatum", getTransaction: async () => null };
    expect(await anchorMemory({ ...deps, verifier: lagging }, req)).toMatchObject({ status: "submitted" });
    expect(store.anchors[0]).toMatchObject({ status: "submitted", verified_at: null });

    expect(await anchorMemory(deps, req)).toMatchObject({ status: "verified" });
    expect(chain.calls.built).toBe(1);
    expect(verifier.calls).toBeGreaterThan(0);
  });

  it("rate limiting and timeouts are retried, then left as submitted (not failed, not verified)", async () => {
    const { store, deps, verifier } = setup();
    verifier.errors.push(new SourceError("rate-limited", "429"), new SourceError("timeout", "t"), new SourceError("rate-limited", "429"));
    expect(await anchorMemory(deps, req)).toMatchObject({ status: "submitted" });
    expect(store.anchors[0]!.status).toBe("submitted");
    expect(store.anchors[0]!.error).toContain("rate-limited");
  });

  it("a mismatch (wrong commitment) → failed, never verified", async () => {
    const { store, deps } = setup({ tamper: (t) => ({ ...t, events: t.events.map((e) => ({ ...e, bcs: new Uint8Array([32, ...new Uint8Array(32).fill(9), 1, 0]) })) }) });
    expect(await anchorMemory(deps, req)).toMatchObject({ status: "failed", note: expect.stringContaining("commitment-mismatch") });
    expect(store.anchors[0]).toMatchObject({ status: "failed", verified_at: null });
  });

  it("retrying a verification failure on an executed tx re-verifies without sending a duplicate", async () => {
    let tamper = true;
    const { store, deps, chain } = setup({ tamper: (t) => (tamper ? { ...t, events: [] } : t) });
    expect(await anchorMemory(deps, req)).toMatchObject({ status: "failed" });
    tamper = false;
    expect(await anchorMemory(deps, req, { retryFailed: true })).toMatchObject({ status: "verified" });
    expect(chain.calls.built).toBe(1);
    expect(store.anchors[0]!.status).toBe("verified");
  });
});
