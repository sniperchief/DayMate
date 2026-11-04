// Uses MOCK services — application-logic tests only, not Mainnet evidence.
import { describe, expect, it, vi } from "vitest";
import { MemoryServiceError, type ConfirmedWrite } from "../src/lib/memory";
import { contentHash, ledgerKey, type Ledger } from "../src/seed/ledger";
import { RECALL_CHECKS, SEED_MEMORIES } from "../src/seed/manifest";
import { gradeRecall, runSeed } from "../src/seed/run-seed";

const config = { accountId: "0xacc", namespace: "daymate-test", serverUrl: "https://relayer.memory.walrus.xyz" };
const emptyLedger = (): Ledger => ({ manifestVersion: "t", entries: {} });

function mockSeedService(impl?: (text: string) => Promise<ConfirmedWrite>) {
  let n = 0;
  return {
    config,
    rememberConfirmed: vi.fn(impl ?? (async (): Promise<ConfirmedWrite> => ({ status: "done", jobId: `job-${++n}`, blobId: `MOCK_BLOB_${n}`, memoryId: `m${n}`, owner: "o", namespace: config.namespace }))),
    confirmWrite: vi.fn<(jobId: string) => Promise<ConfirmedWrite>>(),
  };
}

describe("seed manifest", () => {
  it("has at least 10 distinct memories with unique IDs", () => {
    expect(SEED_MEMORIES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(SEED_MEMORIES.map((s) => s.id)).size).toBe(SEED_MEMORIES.length);
    expect(new Set(SEED_MEMORIES.map((s) => contentHash(s.text))).size).toBe(SEED_MEMORIES.length);
  });

  it("covers all ten required categories", () => {
    const cats = new Set(SEED_MEMORIES.map((s) => s.category));
    for (const c of ["family-relationship", "family-description", "recent-visit", "upcoming-visit", "morning-routine", "favourite-activity", "favourite-music", "milestone", "social-activity", "family-event"]) {
      expect(cats.has(c as never)).toBe(true);
    }
  });

  it("every recall check is answerable by its expected seed entry", () => {
    for (const check of RECALL_CHECKS) {
      const seed = SEED_MEMORIES.find((s) => s.id === check.expectSeedId);
      expect(seed, check.question).toBeDefined();
      expect(gradeRecall([seed!.text], check.mustContain)).toBe(true);
    }
  });
});

describe("[mock] runSeed", () => {
  it("counts only confirmed writes and uses relayer dedupe", async () => {
    const svc = mockSeedService();
    const report = await runSeed(svc, SEED_MEMORIES, emptyLedger());
    expect(report.confirmed).toBe(SEED_MEMORIES.length);
    expect(svc.rememberConfirmed).toHaveBeenCalledWith(SEED_MEMORIES[0]!.text, { dedupe: true });
  });

  it("does not count pending or failed writes", async () => {
    let i = 0;
    const svc = mockSeedService(async (): Promise<ConfirmedWrite> => {
      i++;
      if (i === 1) throw new MemoryServiceError("WRITE_PENDING", "pending", "h", { jobId: "job-p" });
      if (i === 2) throw new MemoryServiceError("WRITE_FAILED", "failed", "h", { jobId: "job-f" });
      return { status: "done", jobId: `job-${i}`, blobId: `B${i}`, memoryId: "m", owner: "o", namespace: config.namespace };
    });
    const ledger = emptyLedger();
    const report = await runSeed(svc, SEED_MEMORIES.slice(0, 4), ledger);
    expect(report).toMatchObject({ attempted: 4, confirmed: 2, pending: 1, failed: 1 });
    expect(ledger.entries[ledgerKey(config.accountId, config.namespace, SEED_MEMORIES[0]!.id)]).toMatchObject({ state: "pending", jobId: "job-p" });
  });

  it("does not trust a confirmed ledger entry — it re-checks with the relayer", async () => {
    const svc = mockSeedService(async (): Promise<ConfirmedWrite> => ({ status: "done", jobId: "job-old", blobId: "B-old", memoryId: "m", owner: "o", namespace: config.namespace }));
    const seed = SEED_MEMORIES[0]!;
    const ledger = emptyLedger();
    ledger.entries[ledgerKey(config.accountId, config.namespace, seed.id)] = { seedId: seed.id, contentHash: contentHash(seed.text), namespace: config.namespace, accountId: config.accountId, state: "confirmed", jobId: "job-old", blobId: "B-old", updatedAt: "" };
    const report = await runSeed(svc, [seed], ledger);
    expect(svc.rememberConfirmed).toHaveBeenCalledTimes(1);
    expect(report.items[0]).toMatchObject({ outcome: "confirmed", deduplicated: true });
  });

  it("resumes a pending job before re-submitting", async () => {
    const svc = mockSeedService();
    svc.confirmWrite.mockResolvedValue({ status: "done", jobId: "job-p", blobId: "B-p", memoryId: "m", owner: "o", namespace: config.namespace });
    const seed = SEED_MEMORIES[0]!;
    const ledger = emptyLedger();
    ledger.entries[ledgerKey(config.accountId, config.namespace, seed.id)] = { seedId: seed.id, contentHash: contentHash(seed.text), namespace: config.namespace, accountId: config.accountId, state: "pending", jobId: "job-p", updatedAt: "" };
    const report = await runSeed(svc, [seed], ledger);
    expect(svc.confirmWrite).toHaveBeenCalledWith("job-p");
    expect(svc.rememberConfirmed).not.toHaveBeenCalled();
    expect(report.confirmed).toBe(1);
  });

  it("re-submits when a resumed job is unknown to the relayer", async () => {
    const svc = mockSeedService();
    svc.confirmWrite.mockRejectedValue(new MemoryServiceError("JOB_NOT_FOUND", "nf", "h"));
    const seed = SEED_MEMORIES[0]!;
    const ledger = emptyLedger();
    ledger.entries[ledgerKey(config.accountId, config.namespace, seed.id)] = { seedId: seed.id, contentHash: contentHash(seed.text), namespace: config.namespace, accountId: config.accountId, state: "pending", jobId: "job-gone", updatedAt: "" };
    const report = await runSeed(svc, [seed], ledger);
    expect(svc.rememberConfirmed).toHaveBeenCalledTimes(1);
    expect(report.confirmed).toBe(1);
  });
});

describe("gradeRecall", () => {
  it("requires all phrases in one of the top results", () => {
    expect(gradeRecall(["Clara visited on 1 November"], ["clara", "1 november"])).toBe(true);
    expect(gradeRecall(["Clara visited", "on 1 November"], ["clara", "1 november"])).toBe(false);
    expect(gradeRecall(["a", "b", "c", "Clara"], ["clara"])).toBe(false);
    expect(gradeRecall([], ["clara"])).toBe(false);
  });
});
