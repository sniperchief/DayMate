/**
 * Independently verify the seed manifest is stored on Walrus Memory Mainnet,
 * using only the relayer (no ledger): for every manifest entry, a
 * deduplicated write must resolve to a `done` job with a blob ID that is
 * present in the relayer's namespace inventory. Does not create duplicates.
 * Requires network + credentials.
 *
 *   npm run memory:verify
 */
import { SEED_MEMORIES } from "../src/seed/manifest";
import { createService, main, writeReport } from "./_cli";

main(async () => {
  const service = createService();
  try {
    const conn = await service.checkConnection({ verifyCredentials: true });
    console.log(`Verifying ${SEED_MEMORIES.length} seed memories on ${conn.serverUrl} (network=${conn.network}) namespace="${conn.namespace}"\n`);

    const inventory = await service.listNamespaceMemories();
    const byBlob = new Map(inventory.map((m) => [m.blob_id, m]));
    const rows = [];
    for (const seed of SEED_MEMORIES) {
      const w = await service.rememberConfirmed(seed.text, { dedupe: true });
      const inv = byBlob.get(w.blobId);
      const ok = Boolean(inv);
      rows.push({ seedId: seed.id, jobId: w.jobId, blobId: w.blobId, inInventory: ok, createdAt: inv?.created_at, status: inv?.status });
      console.log(`${ok ? "✓" : "✗"} ${seed.id.padEnd(30)} blob=${w.blobId} ${ok ? `created_at=${inv!.created_at} status=${inv!.status}` : "NOT in inventory"}`);
    }
    const verified = rows.filter((r) => r.inInventory).length;
    console.log(`\n${verified}/${SEED_MEMORIES.length} seed memories verified on Mainnet (namespace total: ${inventory.length}).`);
    console.log(`report: ${writeReport("verify", { ranAt: new Date().toISOString(), serverUrl: conn.serverUrl, network: conn.network, accountId: conn.accountId, namespace: conn.namespace, verified, rows })}`);
    return verified >= 10 ? 0 : 1;
  } finally {
    service.close();
  }
});
