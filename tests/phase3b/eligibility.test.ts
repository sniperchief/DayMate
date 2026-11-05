// Pure eligibility rules — no network.
import { describe, expect, it } from "vitest";
import { checkEligibility } from "../../src/lib/sui-anchor/eligibility";
import { CAREGIVER, HASH, MEMORY, memory, OTHER_CAREGIVER, walrusRecord } from "./fakes";

const base = { caregiverId: CAREGIVER, memoryId: MEMORY, expectedContentHash: HASH };

describe("anchor eligibility", () => {
  it("accepts the current, stored Walrus version of this caregiver's memory", () => {
    expect(checkEligibility({ ...base, memory: memory(), record: walrusRecord() })).toMatchObject({ ok: true, blobId: "MOCK_BLOB_1", contentHash: HASH });
  });

  it("rejects a deleted memory (row no longer exists)", () => {
    expect(checkEligibility({ ...base, memory: null, record: walrusRecord() })).toEqual({ ok: false, reason: "memory-not-found" });
  });

  it("rejects another caregiver's memory and Walrus record", () => {
    expect(checkEligibility({ ...base, memory: memory({ caregiver_id: OTHER_CAREGIVER }), record: walrusRecord() })).toEqual({ ok: false, reason: "wrong-owner" });
    expect(checkEligibility({ ...base, memory: memory(), record: walrusRecord({ caregiver_id: OTHER_CAREGIVER }) })).toEqual({ ok: false, reason: "wrong-owner" });
    expect(checkEligibility({ ...base, memory: memory(), record: walrusRecord({ memory_id: "a0000000-0000-4000-8000-000000000099" }) })).toEqual({ ok: false, reason: "wrong-owner" });
    expect(checkEligibility({ ...base, memory: memory(), record: walrusRecord({ kind: "profile" }) })).toEqual({ ok: false, reason: "wrong-owner" });
  });

  it("rejects pending and failed Walrus writes", () => {
    expect(checkEligibility({ ...base, memory: memory(), record: walrusRecord({ status: "pending", blob_id: null, stored_at: null }) })).toEqual({ ok: false, reason: "walrus-pending" });
    expect(checkEligibility({ ...base, memory: memory(), record: walrusRecord({ status: "failed", blob_id: null, stored_at: null }) })).toEqual({ ok: false, reason: "walrus-failed" });
    // a failed rewrite still points at the old blob — not the current version
    expect(checkEligibility({ ...base, memory: memory(), record: walrusRecord({ status: "failed" }) })).toEqual({ ok: false, reason: "walrus-failed" });
  });

  it("rejects a memory with no Walrus record or no blob", () => {
    expect(checkEligibility({ ...base, memory: memory(), record: null })).toEqual({ ok: false, reason: "no-walrus-record" });
    expect(checkEligibility({ ...base, memory: memory(), record: walrusRecord({ blob_id: null }) })).toEqual({ ok: false, reason: "no-blob" });
  });

  it("rejects superseded versions", () => {
    const record = walrusRecord({ blob_id: "MOCK_BLOB_2", previous_blob_ids: ["MOCK_BLOB_1"] });
    expect(checkEligibility({ ...base, memory: memory(), record, blobId: "MOCK_BLOB_1" })).toEqual({ ok: false, reason: "superseded-blob" });
    expect(checkEligibility({ ...base, memory: memory(), record, blobId: "SOME_OTHER_BLOB" })).toEqual({ ok: false, reason: "superseded-blob" });
    expect(checkEligibility({ ...base, memory: memory(), record, blobId: "MOCK_BLOB_2" })).toMatchObject({ ok: true, blobId: "MOCK_BLOB_2" });
  });

  it("rejects a stored record whose text no longer matches the current Postgres row", () => {
    expect(checkEligibility({ ...base, expectedContentHash: "0".repeat(64), memory: memory(), record: walrusRecord() })).toEqual({ ok: false, reason: "stale-content" });
  });
});
