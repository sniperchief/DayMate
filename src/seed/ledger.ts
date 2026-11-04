import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Local audit log of seed writes. It is a convenience record only: it is
 * NEVER treated as proof a memory exists on Walrus. Every seed run re-checks
 * with the relayer (deduplicated write + inventory cross-check).
 */
export interface LedgerEntry {
  seedId: string;
  contentHash: string;
  namespace: string;
  accountId: string;
  state: "confirmed" | "pending" | "failed";
  jobId?: string;
  blobId?: string;
  memoryId?: string;
  error?: string;
  updatedAt: string;
}

export interface Ledger {
  manifestVersion: string;
  entries: Record<string, LedgerEntry>;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text.trim(), "utf8").digest("hex");
}

export function ledgerKey(accountId: string, namespace: string, seedId: string): string {
  return `${accountId}:${namespace}:${seedId}`;
}

export function readLedger(path: string, manifestVersion: string): Ledger {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Ledger;
    if (parsed && typeof parsed === "object" && parsed.entries) return parsed;
  } catch {
    // missing or unreadable ledger: start fresh (the relayer is the source of truth)
  }
  return { manifestVersion, entries: {} };
}

export function writeLedger(path: string, ledger: Ledger): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}
