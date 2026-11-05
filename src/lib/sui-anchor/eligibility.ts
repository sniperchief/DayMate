import type { Memory, WalrusRecord } from "../domain/types";

/**
 * A memory may be anchored only when its CURRENT version is confirmed on
 * Walrus. Same rule as Ask DayMate's evidence filter: the record must be this
 * caregiver's, `stored`, carry a current blob, and hash to the text built from
 * the current Postgres row. A row merely existing is never enough.
 */

export type IneligibleReason =
  | "memory-not-found" // deleted, or belongs to another caregiver
  | "no-walrus-record"
  | "wrong-owner"
  | "walrus-pending"
  | "walrus-failed"
  | "no-blob"
  | "stale-content" // edited since the Walrus write: current version not yet stored
  | "superseded-blob"; // requested blob is a previous version

export interface EligibilityInput {
  caregiverId: string;
  memoryId: string;
  /** contentHash(memoryText(...)) of the current Postgres row. */
  expectedContentHash: string;
  memory: Pick<Memory, "id" | "caregiver_id" | "elder_id"> | null;
  record: WalrusRecord | null;
  /** If the caller targets a specific blob, it must be the current one. */
  blobId?: string;
}

export type Eligibility = { ok: true; blobId: string; contentHash: string; elderId: string } | { ok: false; reason: IneligibleReason };

export function checkEligibility(i: EligibilityInput): Eligibility {
  const { memory, record } = i;
  if (!memory || memory.id !== i.memoryId) return { ok: false, reason: "memory-not-found" };
  if (memory.caregiver_id !== i.caregiverId) return { ok: false, reason: "wrong-owner" };
  if (!record) return { ok: false, reason: "no-walrus-record" };
  if (record.caregiver_id !== i.caregiverId || record.kind !== "memory" || record.memory_id !== memory.id || record.elder_id !== memory.elder_id) {
    return { ok: false, reason: "wrong-owner" };
  }
  if (i.blobId && (record.previous_blob_ids ?? []).includes(i.blobId)) return { ok: false, reason: "superseded-blob" };
  if (record.status === "pending") return { ok: false, reason: "walrus-pending" };
  if (record.status === "failed") return { ok: false, reason: "walrus-failed" };
  if (record.status !== "stored" || !record.blob_id || !record.stored_at) return { ok: false, reason: "no-blob" };
  if (i.blobId && i.blobId !== record.blob_id) return { ok: false, reason: "superseded-blob" };
  if (record.content_hash !== i.expectedContentHash) return { ok: false, reason: "stale-content" };
  return { ok: true, blobId: record.blob_id, contentHash: record.content_hash, elderId: memory.elder_id };
}
