import type { WalrusRecord } from "../domain/types";
import { contentHash } from "../walrus-sync/text";
import { normalize, stem, words } from "./router";

/**
 * Filtering and ranking of Walrus recall results. A relayer result is never
 * trusted on its own: it must be the CURRENT blob of a `stored` record that
 * belongs to this caregiver (records come from an RLS-scoped query), and its
 * text must hash to what DayMate wrote for that record.
 */

export interface Hit {
  text: string;
  blobId: string;
  distance: number;
}

export interface Evidence {
  hit: Hit;
  record: WalrusRecord;
  /** Question keywords found in the memory text. */
  overlap: number;
  /** Lower is better. */
  score: number;
}

export type RejectReason = "unknown-blob" | "superseded" | "not-stored" | "text-mismatch";

/** Keep only hits that are the current, confirmed blob of an authorised record. */
export function currentEvidence(hits: readonly Hit[], records: readonly WalrusRecord[]): { accepted: { hit: Hit; record: WalrusRecord }[]; rejected: Record<RejectReason, number> } {
  const byCurrentBlob = new Map<string, WalrusRecord>();
  const superseded = new Set<string>();
  const notStored = new Set<string>();
  for (const r of records) {
    for (const b of r.previous_blob_ids ?? []) superseded.add(b);
    if (!r.blob_id) continue;
    if (r.status === "stored") byCurrentBlob.set(r.blob_id, r);
    else notStored.add(r.blob_id); // pending/failed: its last blob no longer matches the saved item
  }

  const rejected: Record<RejectReason, number> = { "unknown-blob": 0, superseded: 0, "not-stored": 0, "text-mismatch": 0 };
  const best = new Map<string, { hit: Hit; record: WalrusRecord }>();
  for (const hit of hits) {
    const record = byCurrentBlob.get(hit.blobId);
    if (!record) {
      rejected[superseded.has(hit.blobId) ? "superseded" : notStored.has(hit.blobId) ? "not-stored" : "unknown-blob"]++;
      continue;
    }
    if (contentHash(hit.text) !== record.content_hash) {
      rejected["text-mismatch"]++;
      continue;
    }
    const prev = best.get(record.id);
    if (!prev || hit.distance < prev.hit.distance) best.set(record.id, { hit, record });
  }
  return { accepted: [...best.values()], rejected };
}

export function textStems(text: string): Set<string> {
  return new Set(words(normalize(text)).map(stem));
}

/**
 * Relevance gate + ranking. Semantic distance alone is not a reliable
 * threshold, so a result must either be very close semantically or share a
 * content keyword with the question. `strict` is used for questions the
 * router did not recognise.
 */
export function rankEvidence(items: readonly { hit: Hit; record: WalrusRecord }[], questionKeywords: readonly string[], { strict = false } = {}): Evidence[] {
  const maxWithOverlap = strict ? 0.65 : 0.75;
  const maxWithout = strict ? 0.35 : 0.45;
  const out: Evidence[] = [];
  for (const it of items) {
    const stems = textStems(it.hit.text);
    const overlap = questionKeywords.filter((k) => stems.has(k)).length;
    const ok = (overlap > 0 && it.hit.distance <= maxWithOverlap) || it.hit.distance <= maxWithout;
    if (ok) out.push({ ...it, overlap, score: it.hit.distance - 0.05 * Math.min(overlap, 3) });
  }
  return out.sort((a, b) => a.score - b.score);
}

/** Two results are "too close to call" when their scores are within this margin. */
export const AMBIGUITY_MARGIN = 0.03;
