/**
 * MOCKS / IN-MEMORY FAKES — FOR ISOLATED UNIT TESTS ONLY.
 * Nothing here talks to Supabase, Sui or Tatum. Passing tests that use these
 * fakes are NOT evidence of Mainnet integration; that is demonstrated only by
 * `npm run sui:anchor-synthetic` + Tatum verification (docs/PHASE3B_SUI.md).
 */
import { randomUUID } from "node:crypto";
import type { Memory, WalrusRecord } from "../../src/lib/domain/types";
import { MemoryCommittedBcs, fromHex } from "../../src/lib/sui-anchor/commitment";
import type { AnchorStore, NewAnchor } from "../../src/lib/sui-anchor/anchor";
import type { AnchorChain, SignedTx } from "../../src/lib/sui-anchor/sui-chain";
import type { AnchorWithSecret } from "../../src/lib/sui-anchor/types";
import type { FetchedTransaction, TransactionSource } from "../../src/lib/sui-anchor/verify";
import { contentHash } from "../../src/lib/walrus-sync/text";

export const CAREGIVER = "c0000000-0000-4000-8000-000000000001";
export const OTHER_CAREGIVER = "c0000000-0000-4000-8000-000000000002";
export const ELDER = "e0000000-0000-4000-8000-000000000001";
export const MEMORY = "a0000000-0000-4000-8000-000000000001";
export const PACKAGE = "0x" + "ab".repeat(32);
export const SIGNER = "0x" + "5e".repeat(32);
export const TEXT = "Memory about Rose Example: Tea with Clara. We talked about the garden.";
export const HASH = contentHash(TEXT);

export function memory(over: Partial<Memory> = {}): Memory {
  return {
    id: MEMORY,
    caregiver_id: CAREGIVER,
    elder_id: ELDER,
    title: "Tea with Clara",
    description: "We talked about the garden.",
    event_date: null,
    related_person_id: null,
    category: "visit",
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...over,
  };
}

export function walrusRecord(over: Partial<WalrusRecord> = {}): WalrusRecord {
  return {
    id: randomUUID(),
    caregiver_id: CAREGIVER,
    elder_id: ELDER,
    kind: "memory",
    family_member_id: null,
    routine_id: null,
    memory_id: MEMORY,
    namespace: `daymate-elder-${ELDER}`,
    content_hash: HASH,
    status: "stored",
    job_id: "MOCK_JOB_1",
    blob_id: "MOCK_BLOB_1",
    previous_blob_ids: [],
    error: null,
    attempts: 1,
    stored_at: "2026-11-01T00:00:00Z",
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    ...over,
  };
}

/** [mock] AnchorStore; enforces the same unique constraints as the migration. */
export function fakeAnchorStore(state: { memory: Memory | null; record: WalrusRecord | null }) {
  const anchors: AnchorWithSecret[] = [];
  const locks = new Map<string, number>();
  const store: AnchorStore & { anchors: AnchorWithSecret[]; locks: Map<string, number>; state: typeof state } = {
    anchors,
    locks,
    state,
    async loadMemoryState(caregiverId, memoryId) {
      const m = state.memory && state.memory.id === memoryId && state.memory.caregiver_id === caregiverId ? state.memory : null;
      const r = state.record && state.record.memory_id === memoryId && state.record.caregiver_id === caregiverId ? state.record : null;
      return { memory: m, record: r };
    },
    async findAnchor(caregiverId, memoryId, blobId) {
      const a = anchors.find((x) => x.caregiver_id === caregiverId && x.memory_id === memoryId && x.walrus_blob_id === blobId);
      return a ? structuredClone(a) : null;
    },
    async latestVersion(caregiverId, memoryId) {
      return Math.max(0, ...anchors.filter((a) => a.caregiver_id === caregiverId && a.memory_id === memoryId).map((a) => a.version));
    },
    async createAnchor(r: NewAnchor) {
      if (anchors.some((a) => a.memory_id === r.memoryId && (a.walrus_blob_id === r.walrusBlobId || a.version === r.version))) return "conflict";
      if (anchors.some((a) => a.secret.commitment === r.commitment)) return "conflict";
      const id = randomUUID();
      anchors.push({
        id,
        caregiver_id: r.caregiverId,
        elder_id: r.elderId,
        memory_id: r.memoryId,
        version: r.version,
        walrus_blob_id: r.walrusBlobId,
        schema_version: r.schemaVersion,
        status: "pending",
        tx_digest: null,
        submitted_at: null,
        verified_at: null,
        verification_provider: null,
        error: null,
        attempts: 0,
        tx_bytes: null,
        tx_signature: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        secret: { anchor_id: id, commitment: r.commitment, salt: r.salt, canonical_payload: r.canonicalPayload },
      });
      return "created";
    },
    async claim(id, until) {
      const held = locks.get(id);
      if (held && held > Date.now()) return false;
      locks.set(id, until.getTime());
      return true;
    },
    async release(id) {
      locks.delete(id);
    },
    async update(id, patch) {
      const a = anchors.find((x) => x.id === id)!;
      if (patch.status === "verified" && !(patch.verified_at && (patch.verification_provider ?? a.verification_provider))) throw new Error("check constraint: verified shape");
      Object.assign(a, patch, { updated_at: new Date().toISOString() });
      if (a.status === "submitted" && !a.tx_digest) throw new Error("check constraint: submitted shape");
    },
  };
  return store;
}

/** A chain "ledger" shared by the fake submitter and the fake Tatum source. */
export interface Ledger {
  txs: Map<string, { success: boolean; commitment: Uint8Array; schemaVersion: number; sender: string; packageId: string }>;
}

export function ledger(): Ledger {
  return { txs: new Map() };
}

type ExecMode = "ok" | "abort" | "timeout-landed" | "timeout-lost" | "throw-build";

/** [mock] Submission chain. `mode` controls what the next execute does. */
export function fakeChain(l: Ledger, opts: { mode?: ExecMode; dead?: boolean } = {}) {
  let n = 0;
  const pending = new Map<string, { commitment: Uint8Array; schemaVersion: number }>();
  const calls = { built: 0, executed: [] as string[], lookups: 0 };
  const chain: AnchorChain & { calls: typeof calls; mode: ExecMode; dead: boolean; lookupThrows: boolean } = {
    signerAddress: SIGNER,
    calls,
    mode: opts.mode ?? "ok",
    dead: opts.dead ?? false,
    lookupThrows: false,
    async buildAndSign(commitment, schemaVersion) {
      if (chain.mode === "throw-build") throw new Error("insufficient gas: balance 0");
      calls.built++;
      n++;
      const digest = `MOCKDIGEST${String(n).padStart(34, "0")}`;
      pending.set(digest, { commitment, schemaVersion });
      return { digest, bytes: Buffer.from(`tx-${n}`).toString("base64"), signature: `sig-${n}` };
    },
    async execute(tx: SignedTx) {
      calls.executed.push(tx.digest);
      const p = pending.get(tx.digest)!;
      const land = (success: boolean) => l.txs.set(tx.digest, { success, commitment: p.commitment, schemaVersion: p.schemaVersion, sender: SIGNER, packageId: PACKAGE });
      switch (chain.mode) {
        case "abort":
          land(false);
          return { executed: true, success: false, error: "MoveAbort(anchor, 0)" };
        case "timeout-landed":
          land(true);
          throw new Error("deadline exceeded");
        case "timeout-lost":
          throw new Error("deadline exceeded");
        default:
          land(true);
          return { executed: true, success: true, error: null };
      }
    },
    async lookup(digest) {
      calls.lookups++;
      if (chain.lookupThrows) throw new Error("network down");
      const t = l.txs.get(digest);
      return t ? { found: true, success: t.success } : { found: false };
    },
    async isDead() {
      return chain.dead;
    },
  };
  return chain;
}

export function eventBcs(commitment: Uint8Array, schemaVersion: number): Uint8Array {
  return MemoryCommittedBcs.serialize({ commitment: [...commitment], schema_version: schemaVersion }).toBytes();
}

/** [mock] Tatum: answers from the shared ledger, with optional tampering. */
export function fakeTatum(l: Ledger, tamper: (tx: FetchedTransaction) => FetchedTransaction | null = (t) => t): TransactionSource & { calls: number; errors: Error[] } {
  const src = {
    name: "tatum",
    calls: 0,
    errors: [] as Error[],
    async getTransaction(digest: string) {
      src.calls++;
      const e = src.errors.shift();
      if (e) throw e;
      const t = l.txs.get(digest);
      if (!t) return null;
      return tamper({
        digest,
        success: t.success,
        error: t.success ? null : "aborted",
        events: t.success ? [{ packageId: t.packageId, module: "anchor", sender: t.sender, eventType: `${t.packageId}::anchor::MemoryCommitted`, bcs: eventBcs(t.commitment, t.schemaVersion) }] : [],
      });
    },
  };
  return src;
}

export const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
export const unhex = fromHex;
