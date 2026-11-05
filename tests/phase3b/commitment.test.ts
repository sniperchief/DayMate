// Pure commitment logic — no network.
import { Transaction } from "@mysten/sui/transactions";
import { describe, expect, it } from "vitest";
import {
  canonicalPayload,
  COMMITMENT_DOMAIN,
  CommitmentInputError,
  computeCommitment,
  MemoryCommittedBcs,
  newSalt,
  SALT_BYTES,
  SCHEMA_VERSION,
  toHex,
} from "../../src/lib/sui-anchor/commitment";
import { createHash } from "node:crypto";
import { HASH, MEMORY, PACKAGE } from "./fakes";

const v1 = { memoryId: MEMORY, version: 1, walrusBlobId: "MOCK_BLOB_1", walrusContentHash: HASH };
const SALT_A = new Uint8Array(32).fill(1);
const SALT_B = new Uint8Array(32).fill(2);

describe("canonical payload", () => {
  it("is deterministic with a fixed key order and no whitespace", () => {
    const a = canonicalPayload(v1);
    expect(a).toBe(`{"memory_id":"${MEMORY}","version":1,"walrus_blob_id":"MOCK_BLOB_1","walrus_content_hash":"${HASH}"}`);
    expect(canonicalPayload({ walrusContentHash: HASH, walrusBlobId: "MOCK_BLOB_1", version: 1, memoryId: MEMORY })).toBe(a);
  });

  it("normalises the memory UUID to lowercase", () => {
    expect(canonicalPayload({ ...v1, memoryId: MEMORY.toUpperCase() })).toBe(canonicalPayload(v1));
  });

  it.each([
    ["memory_id", { memoryId: "not-a-uuid" }],
    ["version", { version: 0 }],
    ["version", { version: 1.5 }],
    ["walrus_blob_id", { walrusBlobId: 'x"y' }],
    ["walrus_blob_id", { walrusBlobId: "" }],
    ["walrus_content_hash", { walrusContentHash: "ABC" }],
  ])("rejects an invalid %s", (_f, over) => {
    expect(() => canonicalPayload({ ...v1, ...over })).toThrow(CommitmentInputError);
  });
});

describe("commitment", () => {
  it("matches the documented, length-prefixed preimage", () => {
    const payload = canonicalPayload(v1);
    const domain = Buffer.from(COMMITMENT_DOMAIN);
    const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
    const expected = createHash("sha256")
      .update(Buffer.concat([u32(domain.length), domain, Buffer.from([0, 1]), u32(Buffer.byteLength(payload)), Buffer.from(payload), SALT_A]))
      .digest("hex");
    expect(toHex(computeCommitment(payload, SALT_A))).toBe(expected);
  });

  it("is deterministic for the same payload and salt", () => {
    const p = canonicalPayload(v1);
    expect(toHex(computeCommitment(p, SALT_A))).toBe(toHex(computeCommitment(p, SALT_A)));
    expect(computeCommitment(p, SALT_A)).toHaveLength(32);
  });

  it("different salts give different commitments", () => {
    const p = canonicalPayload(v1);
    expect(toHex(computeCommitment(p, SALT_A))).not.toBe(toHex(computeCommitment(p, SALT_B)));
  });

  it("different memory versions give different commitments", () => {
    const a = computeCommitment(canonicalPayload(v1), SALT_A);
    const b = computeCommitment(canonicalPayload({ ...v1, version: 2 }), SALT_A);
    const c = computeCommitment(canonicalPayload({ ...v1, walrusBlobId: "MOCK_BLOB_2" }), SALT_A);
    expect(new Set([toHex(a), toHex(b), toHex(c)]).size).toBe(3);
  });

  it("schema version is bound into the commitment", () => {
    const p = canonicalPayload(v1);
    expect(toHex(computeCommitment(p, SALT_A, 1))).not.toBe(toHex(computeCommitment(p, SALT_A, 2)));
  });

  it("requires a 32-byte salt and generates fresh random salts", () => {
    expect(() => computeCommitment(canonicalPayload(v1), new Uint8Array(16))).toThrow(CommitmentInputError);
    const salts = new Set(Array.from({ length: 50 }, () => toHex(newSalt())));
    expect(salts.size).toBe(50);
    expect(newSalt()).toHaveLength(SALT_BYTES);
  });
});

describe("on-chain payload contains no personal information", () => {
  const PII = ["Rose", "Example", "Clara", "garden", "Tea with Clara", MEMORY, "MOCK_BLOB_1", HASH, "1931-04-02", "Daughter"];

  it("the event is exactly a 32-byte commitment and a u16 schema version", () => {
    const commitment = computeCommitment(canonicalPayload(v1), SALT_A);
    const bytes = MemoryCommittedBcs.serialize({ commitment: [...commitment], schema_version: SCHEMA_VERSION }).toBytes();
    expect(bytes).toHaveLength(1 + 32 + 2); // ULEB length + digest + u16
    expect(Object.keys(MemoryCommittedBcs.parse(bytes)).sort()).toEqual(["commitment", "schema_version"]);
  });

  it("the transaction's Move call carries only the commitment and schema version", async () => {
    const commitment = computeCommitment(canonicalPayload(v1), SALT_A);
    const tx = new Transaction();
    tx.moveCall({ target: `${PACKAGE}::anchor::commit`, arguments: [tx.pure.vector("u8", commitment), tx.pure.u16(SCHEMA_VERSION)] });
    const kind = await tx.build({ onlyTransactionKind: true });
    const data = tx.getData();
    expect(data.inputs).toHaveLength(2);
    const text = Buffer.from(kind).toString("latin1");
    const asHex = Buffer.from(kind).toString("hex");
    for (const s of PII) {
      expect(text).not.toContain(s);
      expect(asHex).not.toContain(Buffer.from(s).toString("hex"));
    }
    expect(asHex).toContain(toHex(commitment));
  });
});
