import type { Memory, WalrusRecord } from "../domain/types";
import { canonicalPayload, computeCommitment, newSalt, SCHEMA_VERSION, toHex } from "./commitment";
import { checkEligibility, type IneligibleReason } from "./eligibility";
import type { AnchorChain, SignedTx } from "./sui-chain";
import type { AnchorStatus, AnchorWithSecret } from "./types";
import { verifyAnchorTransaction, type TransactionSource, type VerifyFailure } from "./verify";

/**
 * Anchoring lifecycle for one memory version.
 *
 * Idempotency:
 *  - one anchor row per (memory_id, walrus_blob_id): a version is never anchored twice;
 *  - the commitment and salt are fixed when the row is created and reused on retries;
 *  - the signed transaction (digest, bytes, signature) is saved BEFORE it is sent;
 *  - once a digest exists, DayMate investigates it (lookup on chain) before doing
 *    anything else, re-sends the SAME signed bytes if it is unknown, and builds a
 *    new transaction only when the old one is proven dead or aborted;
 *  - a short lease stops two workers advancing the same row at once.
 *
 * "verified" is set only by `verifyAnchorTransaction` against the independent
 * provider (Tatum), never from a submission result, cache or assumption.
 */

export interface NewAnchor {
  caregiverId: string;
  elderId: string;
  memoryId: string;
  version: number;
  walrusBlobId: string;
  schemaVersion: number;
  commitment: string;
  salt: string;
  canonicalPayload: string;
}

export type AnchorPatch = Partial<
  Pick<AnchorWithSecret, "status" | "tx_digest" | "tx_bytes" | "tx_signature" | "submitted_at" | "verified_at" | "verification_provider" | "error" | "attempts">
>;

export interface AnchorStore {
  /** Memory + its Walrus record, both scoped by caregiverId (null if not this caregiver's). */
  loadMemoryState(caregiverId: string, memoryId: string): Promise<{ memory: Memory | null; record: WalrusRecord | null }>;
  findAnchor(caregiverId: string, memoryId: string, blobId: string): Promise<AnchorWithSecret | null>;
  latestVersion(caregiverId: string, memoryId: string): Promise<number>;
  /** Atomically inserts the anchor and its secret. "conflict" on a unique violation. */
  createAnchor(row: NewAnchor): Promise<"created" | "conflict">;
  /** Take the row's lease if free or expired. */
  claim(id: string, until: Date): Promise<boolean>;
  release(id: string): Promise<void>;
  /** One atomic row update (digest and signed bytes always change together). */
  update(id: string, patch: AnchorPatch): Promise<void>;
}

export interface AnchorDeps {
  store: AnchorStore;
  chain: AnchorChain;
  verifier: TransactionSource;
  packageId: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Delays between verification polls while the provider catches up. */
  verifyDelaysMs?: number[];
}

export interface AnchorRequest {
  caregiverId: string;
  memoryId: string;
  /** contentHash of the memory text built from the CURRENT Postgres row. */
  expectedContentHash: string;
  /** Optional: the blob the caller believes is current (rejected if superseded). */
  blobId?: string;
}

export type AnchorOutcome =
  | { status: AnchorStatus; digest?: string | null; note?: string }
  | { status: "ineligible"; reason: IneligibleReason }
  | { status: "busy" };

export const LEASE_MS = 2 * 60_000;
export const MAX_ATTEMPTS = 5;
const DEFAULT_VERIFY_DELAYS = [1_500, 3_000, 6_000];

const NOTE = {
  unknown: "Sent to Sui, but the result is not known yet. DayMate will check before sending again.",
  checkFailed: "Could not check the transaction status. Try again later.",
  awaiting: "Submitted to Sui. Waiting for independent verification.",
  aborted: "The Sui transaction failed on chain.",
  tooMany: "Too many attempts. Please try again later.",
} as const;

export async function anchorMemory(deps: AnchorDeps, req: AnchorRequest, { retryFailed = false } = {}): Promise<AnchorOutcome> {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());

  const { memory, record } = await store.loadMemoryState(req.caregiverId, req.memoryId);
  const elig = checkEligibility({ caregiverId: req.caregiverId, memoryId: req.memoryId, expectedContentHash: req.expectedContentHash, memory, record, blobId: req.blobId });
  if (!elig.ok) return { status: "ineligible", reason: elig.reason };

  let anchor = await store.findAnchor(req.caregiverId, req.memoryId, elig.blobId);
  if (!anchor) anchor = await createAnchor(store, { caregiverId: req.caregiverId, elderId: elig.elderId, memoryId: req.memoryId, blobId: elig.blobId, contentHash: elig.contentHash });
  if (anchor.status === "verified") return { status: "verified", digest: anchor.tx_digest };
  if (anchor.status === "failed" && !retryFailed) return { status: "failed", digest: anchor.tx_digest, note: anchor.error ?? undefined };

  if (!(await store.claim(anchor.id, new Date(now().getTime() + LEASE_MS)))) return { status: "busy" };
  try {
    return await advance(deps, anchor, retryFailed);
  } finally {
    await store.release(anchor.id);
  }
}

async function createAnchor(store: AnchorStore, a: { caregiverId: string; elderId: string; memoryId: string; blobId: string; contentHash: string }): Promise<AnchorWithSecret> {
  for (let i = 0; i < 3; i++) {
    const version = (await store.latestVersion(a.caregiverId, a.memoryId)) + 1;
    const payload = canonicalPayload({ memoryId: a.memoryId, version, walrusBlobId: a.blobId, walrusContentHash: a.contentHash });
    const salt = newSalt(); // fresh per memory version
    const commitment = computeCommitment(payload, salt, SCHEMA_VERSION);
    const res = await store.createAnchor({
      caregiverId: a.caregiverId,
      elderId: a.elderId,
      memoryId: a.memoryId,
      version,
      walrusBlobId: a.blobId,
      schemaVersion: SCHEMA_VERSION,
      commitment: toHex(commitment),
      salt: toHex(salt),
      canonicalPayload: payload,
    });
    const found = await store.findAnchor(a.caregiverId, a.memoryId, a.blobId);
    if (found) return found; // created, or another worker created it first
    if (res === "created") throw new Error("anchor row missing after insert");
    // conflict on (memory_id, version) with a different blob: take the next version
  }
  throw new Error("could not allocate an anchor version");
}

function signedOf(a: AnchorWithSecret): SignedTx | null {
  return a.tx_digest && a.tx_bytes && a.tx_signature ? { digest: a.tx_digest, bytes: a.tx_bytes, signature: a.tx_signature } : null;
}

async function advance(deps: AnchorDeps, a: AnchorWithSecret, retryFailed: boolean): Promise<AnchorOutcome> {
  const { store, chain } = deps;
  const signed = signedOf(a);

  if (signed) {
    // Investigate the existing transaction before doing anything else.
    let look;
    try {
      look = await chain.lookup(signed.digest);
    } catch {
      await store.update(a.id, { error: NOTE.checkFailed });
      return { status: a.status, digest: signed.digest, note: NOTE.checkFailed };
    }
    if (look.found && look.success) {
      if (a.status !== "submitted") await store.update(a.id, { status: "submitted", submitted_at: a.submitted_at ?? new Date().toISOString(), error: NOTE.awaiting });
      return verify(deps, a, signed.digest);
    }
    if (look.found && !look.success) {
      // Executed and aborted: no event exists, so a new transaction is safe — but only on an explicit retry.
      if (!retryFailed) {
        await store.update(a.id, { status: "failed", error: NOTE.aborted });
        return { status: "failed", digest: signed.digest, note: NOTE.aborted };
      }
    } else {
      let dead: boolean;
      try {
        dead = await chain.isDead(signed);
      } catch {
        await store.update(a.id, { error: NOTE.checkFailed });
        return { status: a.status, digest: signed.digest, note: NOTE.checkFailed };
      }
      // Not on chain and still valid: re-send the identical signed bytes (same digest, cannot run twice).
      if (!dead) return submit(deps, a, signed);
    }
  } else if (a.status === "failed" && !retryFailed) {
    return { status: "failed", note: a.error ?? undefined };
  }

  // Build a new transaction (first attempt, proven-dead tx, or explicit retry after an abort).
  if (a.attempts >= MAX_ATTEMPTS) {
    await store.update(a.id, { status: "failed", error: NOTE.tooMany });
    return { status: "failed", digest: a.tx_digest, note: NOTE.tooMany };
  }
  let fresh: SignedTx;
  try {
    fresh = await chain.buildAndSign(Buffer.from(a.secret.commitment, "hex"), a.schema_version);
  } catch (err) {
    const note = `Could not prepare the Sui transaction: ${safeMessage(err)}`;
    await store.update(a.id, { status: "failed", error: note, tx_digest: null, tx_bytes: null, tx_signature: null, attempts: a.attempts + 1 });
    return { status: "failed", note };
  }
  // Write-ahead: persist the signed transaction before sending it.
  await store.update(a.id, { status: "pending", tx_digest: fresh.digest, tx_bytes: fresh.bytes, tx_signature: fresh.signature, submitted_at: null, verified_at: null, error: null, attempts: a.attempts + 1 });
  return submit(deps, { ...a, status: "pending", tx_digest: fresh.digest, attempts: a.attempts + 1 }, fresh);
}

async function submit(deps: AnchorDeps, a: AnchorWithSecret, signed: SignedTx): Promise<AnchorOutcome> {
  const { store, chain } = deps;
  let res;
  try {
    res = await chain.execute(signed);
  } catch {
    // Timeout / network: the transaction may or may not have executed.
    await store.update(a.id, { status: "pending", error: NOTE.unknown });
    return { status: "pending", digest: signed.digest, note: NOTE.unknown };
  }
  if (!res.success) {
    const note = `${NOTE.aborted}${res.error ? ` (${res.error})` : ""}`.slice(0, 500);
    await store.update(a.id, { status: "failed", error: note });
    return { status: "failed", digest: signed.digest, note };
  }
  await store.update(a.id, { status: "submitted", submitted_at: new Date().toISOString(), error: NOTE.awaiting });
  return verify(deps, a, signed.digest);
}

async function verify(deps: AnchorDeps, a: AnchorWithSecret, digest: string): Promise<AnchorOutcome> {
  const { store, verifier, chain } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const delays = deps.verifyDelaysMs ?? DEFAULT_VERIFY_DELAYS;
  const expected = { digest, packageId: deps.packageId, sender: chain.signerAddress, commitmentHex: a.secret.commitment, schemaVersion: a.schema_version };

  let last: VerifyFailure = "not-found";
  for (let i = 0; i <= delays.length; i++) {
    const r = await verifyAnchorTransaction(verifier, expected);
    if (r.ok) {
      await store.update(a.id, { status: "verified", verified_at: new Date().toISOString(), verification_provider: r.provider, error: null });
      return { status: "verified", digest };
    }
    if (!r.retryable) {
      const note = `Verification failed: ${r.reason}.`;
      await store.update(a.id, { status: "failed", error: note });
      return { status: "failed", digest, note };
    }
    last = r.reason;
    if (r.reason === "auth") break; // retrying will not help
    if (i < delays.length) await sleep(delays[i]!);
  }
  const note = `${NOTE.awaiting} (${last})`;
  await store.update(a.id, { status: "submitted", error: note });
  return { status: "submitted", digest, note };
}

/** Never includes keys or payloads: SDK messages are trimmed and stripped of long hex/base64 runs. */
function safeMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.replace(/[A-Za-z0-9+/=_-]{40,}/g, "[…]").slice(0, 200);
}
