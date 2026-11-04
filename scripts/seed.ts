/**
 * Write the deterministic Phase 1 seed memories to Walrus Memory Mainnet.
 * Requires network access and real credentials. Safe to re-run: the relayer
 * deduplicates identical text in the namespace.
 *
 *   npm run memory:seed
 */
import { join } from "node:path";
import { MANIFEST_VERSION, SEED_MEMORIES } from "../src/seed/manifest";
import { readLedger, writeLedger } from "../src/seed/ledger";
import { runSeed } from "../src/seed/run-seed";
import { STATE_DIR, createService, main, writeReport } from "./_cli";

const MIN_CONFIRMED = 10;

main(async () => {
  const service = createService();
  try {
    const conn = await service.checkConnection({ verifyCredentials: true });
    if (!conn.writeReady) {
      console.error(`✗ relayer is not accepting writes (writes=${conn.writes}). Nothing was written.`);
      return 2;
    }
    console.log(`Seeding ${SEED_MEMORIES.length} memories → ${conn.serverUrl} (network=${conn.network}) namespace="${conn.namespace}"`);
    console.log(`Memories already in namespace before run: ${conn.memoriesInNamespace}\n`);

    const ledgerPath = join(STATE_DIR, "seed-ledger.json");
    const ledger = readLedger(ledgerPath, MANIFEST_VERSION);

    const report = await runSeed(service, SEED_MEMORIES, ledger, {
      persist: (l) => writeLedger(ledgerPath, l),
      onItem: (r) => {
        const mark = r.outcome === "confirmed" ? "✓" : r.outcome === "pending" ? "…" : "✗";
        const extra = r.outcome === "confirmed" ? `blob=${r.blobId}${r.deduplicated ? " (already stored; relayer deduplicated)" : ""}` : r.error;
        console.log(`${mark} ${r.seedId.padEnd(30)} job=${r.jobId ?? "-"} ${extra}`);
      },
    });

    // Independent cross-check against the relayer's inventory for this namespace.
    const inventory = await service.listNamespaceMemories();
    const inventoryBlobs = new Set(inventory.map((m) => m.blob_id));
    const confirmed = report.items.filter((i) => i.outcome === "confirmed");
    const inInventory = confirmed.filter((i) => i.blobId && inventoryBlobs.has(i.blobId)).length;

    console.log("\n── Seed summary ──");
    console.log(`attempted:                ${report.attempted}`);
    console.log(`confirmed Mainnet writes: ${report.confirmed}`);
    console.log(`pending (not counted):    ${report.pending}`);
    console.log(`failed:                   ${report.failed}`);
    console.log(`confirmed blobs found in relayer inventory: ${inInventory}/${confirmed.length} (namespace total: ${inventory.length})`);
    for (const f of report.items.filter((i) => i.outcome !== "confirmed")) console.log(`  ${f.outcome}: ${f.seedId} — ${f.error}`);

    const path = writeReport("seed", {
      ranAt: new Date().toISOString(),
      manifestVersion: MANIFEST_VERSION,
      serverUrl: conn.serverUrl,
      network: conn.network,
      accountId: conn.accountId,
      ...report,
      inventoryCheck: { confirmedInInventory: inInventory, namespaceTotal: inventory.length },
    });
    console.log(`report: ${path}`);

    const ok = report.confirmed >= MIN_CONFIRMED && inInventory >= MIN_CONFIRMED;
    console.log(ok ? `\n✓ ${report.confirmed} confirmed Mainnet writes (≥ ${MIN_CONFIRMED}).` : `\n✗ fewer than ${MIN_CONFIRMED} confirmed writes.`);
    return ok ? 0 : 1;
  } finally {
    service.close();
  }
});
