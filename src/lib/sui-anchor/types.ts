/**
 * Sui anchor state. Kept independent of Walrus state: a memory can be
 * "Stored on Walrus" while its Sui anchor is pending or failed.
 *
 *  pending   — row created; transaction not yet sent, OR signed and sent with
 *              an unknown outcome (tx_digest set). Never re-signed blindly.
 *  submitted — the submission RPC reported successful execution. NOT verified.
 *  verified  — Tatum independently returned the transaction and every check
 *              passed (digest, success, package/module/event, sender,
 *              commitment, schema version).
 *  failed    — definitively failed (aborted on chain, dead transaction, or a
 *              verification mismatch). Safe to retry with a new transaction.
 */
export type AnchorStatus = "pending" | "submitted" | "verified" | "failed";

/** Caregiver-readable columns of `memory_anchors` (no salt, payload or commitment). */
export interface MemoryAnchor {
  id: string;
  caregiver_id: string;
  elder_id: string;
  memory_id: string;
  version: number;
  walrus_blob_id: string;
  schema_version: number;
  status: AnchorStatus;
  tx_digest: string | null;
  submitted_at: string | null;
  verified_at: string | null;
  verification_provider: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

/** Server-only secrets (`memory_anchor_secrets`). Never sent to the browser. */
export interface AnchorSecret {
  anchor_id: string;
  commitment: string; // hex
  salt: string; // hex
  canonical_payload: string;
}

/** Server-side view of an anchor: status + signed transaction + secret. */
export type AnchorWithSecret = MemoryAnchor & {
  tx_bytes: string | null; // base64 signed TransactionData
  tx_signature: string | null;
  secret: AnchorSecret;
};

export const ANCHOR_PUBLIC_COLUMNS =
  "id, caregiver_id, elder_id, memory_id, version, walrus_blob_id, schema_version, status, tx_digest, submitted_at, verified_at, verification_provider, error, attempts, created_at, updated_at";
