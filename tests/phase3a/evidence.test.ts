// Pure unit tests of the Walrus evidence filter (synthetic records; no I/O).
import { describe, expect, it } from "vitest";
import { currentEvidence, rankEvidence } from "../../src/lib/ask/evidence";
import type { WalrusRecord } from "../../src/lib/domain/types";
import { contentHash } from "../../src/lib/walrus-sync/text";

function record(p: Partial<WalrusRecord> & { id: string; text: string }): WalrusRecord {
  return {
    caregiver_id: "c",
    elder_id: "e",
    kind: "memory",
    family_member_id: null,
    routine_id: null,
    memory_id: p.id,
    namespace: "daymate-elder-e",
    status: "stored",
    job_id: "j",
    blob_id: `blob-${p.id}`,
    previous_blob_ids: [],
    error: null,
    attempts: 1,
    stored_at: "2026-11-01T00:00:00Z",
    created_at: "",
    updated_at: "",
    content_hash: contentHash(p.text),
    ...p,
  };
}

describe("currentEvidence", () => {
  const current = record({ id: "m1", text: "Clara visited for lunch.", previous_blob_ids: ["blob-old"] });
  const pending = record({ id: "m2", text: "Tom came round.", status: "pending" });
  const failed = record({ id: "m3", text: "Sophie got engaged.", status: "failed" });
  const records = [current, pending, failed];

  it("accepts only the current blob of a stored record with matching text", () => {
    const { accepted, rejected } = currentEvidence(
      [
        { blobId: "blob-m1", text: "Clara visited for lunch.", distance: 0.3 },
        { blobId: "blob-old", text: "Clara visited for lunch.", distance: 0.1 }, // superseded (even with today's text)
        { blobId: "blob-m2", text: "Tom came round.", distance: 0.2 },
        { blobId: "blob-m3", text: "Sophie got engaged.", distance: 0.2 },
        { blobId: "blob-m1", text: "Clara stole the silver.", distance: 0.05 }, // forged text
        { blobId: "blob-foreign", text: "Someone else's memory.", distance: 0.01 },
      ],
      records,
    );
    expect(accepted.map((a) => a.record.id)).toEqual(["m1"]);
    expect(accepted[0]!.hit.text).toBe("Clara visited for lunch.");
    expect(rejected).toEqual({ superseded: 1, "not-stored": 2, "text-mismatch": 1, "unknown-blob": 1 });
  });

  it("keeps one (closest) hit per record", () => {
    const { accepted } = currentEvidence(
      [
        { blobId: "blob-m1", text: "Clara visited for lunch.", distance: 0.4 },
        { blobId: "blob-m1", text: "Clara visited for lunch.", distance: 0.2 },
      ],
      [current],
    );
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.hit.distance).toBe(0.2);
  });

  it("accepts nothing when there are no records", () => {
    expect(currentEvidence([{ blobId: "x", text: "y", distance: 0 }], []).accepted).toEqual([]);
  });
});

describe("rankEvidence", () => {
  const r = record({ id: "m", text: "x" });
  const item = (text: string, distance: number) => ({ hit: { blobId: "b", text, distance }, record: r });

  it("requires a shared keyword unless semantically very close", () => {
    expect(rankEvidence([item("Rose loves swing music.", 0.7)], ["music"])).toHaveLength(1);
    expect(rankEvidence([item("Rose loves crosswords.", 0.7)], ["music"])).toHaveLength(0);
    expect(rankEvidence([item("Rose loves crosswords.", 0.4)], ["music"])).toHaveLength(1);
  });

  it("is stricter for unrecognised questions", () => {
    expect(rankEvidence([item("Rose loves swing music.", 0.7)], ["music"], { strict: true })).toHaveLength(0);
    expect(rankEvidence([item("Rose loves crosswords.", 0.4)], ["music"], { strict: true })).toHaveLength(0);
  });

  it("ranks keyword matches ahead of slightly closer non-matches", () => {
    const ranked = rankEvidence([item("Unrelated but close.", 0.42), item("Swing music after lunch.", 0.44)], ["music", "lunch"]);
    expect(ranked[0]!.hit.text).toBe("Swing music after lunch.");
  });
});
