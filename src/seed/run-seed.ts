import { MemoryServiceError, toMemoryError, type ConfirmedWrite, type MemoryService } from "../lib/memory";
import { contentHash, ledgerKey, type Ledger, type LedgerEntry } from "./ledger";
import type { SeedMemory } from "./manifest";

export interface SeedItemResult {
  seedId: string;
  outcome: "confirmed" | "pending" | "failed";
  jobId?: string;
  blobId?: string;
  /** True when the relayer resolved this write to a memory that already existed. */
  deduplicated?: boolean;
  error?: string;
  errorCode?: string;
}

export interface SeedReport {
  namespace: string;
  attempted: number;
  confirmed: number;
  pending: number;
  failed: number;
  items: SeedItemResult[];
}

type SeedService = Pick<MemoryService, "rememberConfirmed" | "confirmWrite" | "config">;

/**
 * Write every manifest entry to Walrus Memory, counting an entry only once
 * the relayer confirms it `done` with a blob ID.
 *
 * Duplicate prevention is done by the relayer (`dedupe: true` resolves
 * identical text in the namespace to the existing memory), not by trusting
 * the local ledger. The ledger is only used to resume a job left pending.
 */
export async function runSeed(
  service: SeedService,
  manifest: readonly SeedMemory[],
  ledger: Ledger,
  { onItem, persist }: { onItem?: (r: SeedItemResult) => void; persist?: (l: Ledger) => void } = {},
): Promise<SeedReport> {
  const { accountId, namespace } = service.config;
  const items: SeedItemResult[] = [];

  for (const seed of manifest) {
    const key = ledgerKey(accountId, namespace, seed.id);
    const hash = contentHash(seed.text);
    const previous: LedgerEntry | undefined = ledger.entries[key];
    let result: SeedItemResult;

    try {
      let write: ConfirmedWrite | undefined;
      // Resume a job a previous run left pending (same text only).
      if (previous?.state === "pending" && previous.jobId && previous.contentHash === hash) {
        try {
          write = await service.confirmWrite(previous.jobId);
        } catch (err) {
          const e = toMemoryError(err, "resume pending write");
          if (e.code !== "JOB_NOT_FOUND" && e.code !== "WRITE_FAILED") throw e;
        }
      }
      write ??= await service.rememberConfirmed(seed.text, { dedupe: true });
      result = {
        seedId: seed.id,
        outcome: "confirmed",
        jobId: write.jobId,
        blobId: write.blobId,
        deduplicated: previous?.blobId !== undefined && previous.blobId === write.blobId,
      };
    } catch (err) {
      const e = err instanceof MemoryServiceError ? err : toMemoryError(err, "seed write");
      result = {
        seedId: seed.id,
        outcome: e.code === "WRITE_PENDING" ? "pending" : "failed",
        jobId: e.details.jobId,
        error: e.toSafeString(),
        errorCode: e.code,
      };
    }

    ledger.entries[key] = {
      seedId: seed.id,
      contentHash: hash,
      namespace,
      accountId,
      state: result.outcome,
      jobId: result.jobId ?? (result.outcome === "failed" ? undefined : previous?.jobId),
      // keep a previously confirmed blob ID visible even if this run failed, but state reflects this run
      blobId: result.blobId ?? previous?.blobId,
      error: result.error,
      updatedAt: new Date().toISOString(),
    };
    persist?.(ledger);
    onItem?.(result);
    items.push(result);
  }

  return {
    namespace,
    attempted: items.length,
    confirmed: items.filter((i) => i.outcome === "confirmed").length,
    pending: items.filter((i) => i.outcome === "pending").length,
    failed: items.filter((i) => i.outcome === "failed").length,
    items,
  };
}

/** Grade recall results against expected phrases. Never fabricates answers. */
export function gradeRecall(texts: readonly string[], mustContain: readonly string[], topN = 3): boolean {
  return texts.slice(0, topN).some((t) => {
    const lower = t.toLowerCase();
    return mustContain.every((p) => lower.includes(p.toLowerCase()));
  });
}
