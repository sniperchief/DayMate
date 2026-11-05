import { createHash, randomBytes } from "node:crypto";
import { bcs } from "@mysten/sui/bcs";

/**
 * Salted, domain-separated memory commitments (schema version 1).
 *
 * Only the 32-byte commitment and the schema version are ever published on
 * Sui. The canonical payload and the salt stay private in Supabase
 * (`memory_anchor_secrets`, service-role only) so DayMate can later prove
 * which memory version a commitment refers to. Without the salt, the
 * commitment reveals nothing usable about the memory. This is a plain hash
 * commitment, NOT a zero-knowledge proof and NOT encryption.
 *
 * Preimage (all integers big-endian):
 *
 *   u32(len(DOMAIN)) || DOMAIN || u16(schema_version)
 *   || u32(len(payload)) || payload || salt[32]
 *
 * Length prefixes make the concatenation unambiguous.
 *
 * Canonical payload (schema 1): UTF-8 JSON with exactly these keys in this
 * order and no whitespace:
 *
 *   {"memory_id":"<lowercase uuid>","version":<int ≥ 1>,
 *    "walrus_blob_id":"<blob id>","walrus_content_hash":"<64 lowercase hex>"}
 *
 * `walrus_content_hash` is SHA-256 of the exact memory text DayMate stored on
 * Walrus (`walrus_records.content_hash`), so the commitment binds the memory
 * content without copying the raw text into another table. Every value is
 * format-checked, so JSON.stringify output is deterministic.
 */

export const COMMITMENT_DOMAIN = "daymate/memory-commitment";
export const SCHEMA_VERSION = 1;
export const SALT_BYTES = 32;

export interface MemoryVersion {
  memoryId: string;
  version: number;
  walrusBlobId: string;
  walrusContentHash: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BLOB_RE = /^[A-Za-z0-9_-]{1,128}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

export class CommitmentInputError extends Error {
  constructor(field: string) {
    super(`Invalid commitment input: ${field}`);
    this.name = "CommitmentInputError";
  }
}

export function canonicalPayload(v: MemoryVersion): string {
  const memoryId = v.memoryId.toLowerCase();
  if (!UUID_RE.test(memoryId)) throw new CommitmentInputError("memory_id");
  if (!Number.isSafeInteger(v.version) || v.version < 1) throw new CommitmentInputError("version");
  if (!BLOB_RE.test(v.walrusBlobId)) throw new CommitmentInputError("walrus_blob_id");
  if (!HASH_RE.test(v.walrusContentHash)) throw new CommitmentInputError("walrus_content_hash");
  return JSON.stringify({ memory_id: memoryId, version: v.version, walrus_blob_id: v.walrusBlobId, walrus_content_hash: v.walrusContentHash });
}

export function newSalt(): Uint8Array {
  return new Uint8Array(randomBytes(SALT_BYTES));
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}

export function computeCommitment(payload: string, salt: Uint8Array, schemaVersion = SCHEMA_VERSION): Uint8Array {
  if (salt.length !== SALT_BYTES) throw new CommitmentInputError("salt");
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 0xffff) throw new CommitmentInputError("schema_version");
  const domain = Buffer.from(COMMITMENT_DOMAIN, "utf8");
  const body = Buffer.from(payload, "utf8");
  const hash = createHash("sha256");
  for (const part of [u32(domain.length), domain, u16(schemaVersion), u32(body.length), body, salt]) hash.update(part);
  return new Uint8Array(hash.digest());
}

export const toHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");
export const fromHex = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));

/** BCS layout of the Move event `daymate_anchor::anchor::MemoryCommitted`. */
export const MemoryCommittedBcs = bcs.struct("MemoryCommitted", {
  commitment: bcs.vector(bcs.u8()),
  schema_version: bcs.u16(),
});

export const EVENT_MODULE = "anchor";
export const EVENT_STRUCT = "MemoryCommitted";
export const COMMIT_FUNCTION = "commit";
