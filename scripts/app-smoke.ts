/**
 * LIVE end-to-end check of the Phase 2 app logic against REAL Supabase and
 * REAL Walrus Memory Mainnet, using the same operations the web app uses.
 * Walrus writes run synchronously here (the app defers them with after()).
 *
 * Creates a throwaway caregiver, a fictional profile, 1 family member,
 * 1 routine and 1 memory (4 Mainnet writes into a new per-elder namespace),
 * verifies they are recorded as stored with blob IDs, checks an unchanged
 * re-save does not write again, recalls from Walrus with a fresh client, then
 * deletes the caregiver's DB data. The Walrus blobs remain (fictional data).
 *
 *   npm run app:smoke            # add --keep to keep the test caregiver
 */
import { MemoryService } from "../src/lib/memory";
import { supabaseSyncStore } from "../src/lib/walrus-sync/supabase-store";
import { performWrite, prepareSync, type MemoryWriter } from "../src/lib/walrus-sync/sync";
import { elderNamespace } from "../src/lib/walrus-sync/text";
import * as ops from "../src/server/operations";
import type { Ctx, Syncer } from "../src/server/ports";
import { supabasePhotoStore, supabaseRepo } from "../src/server/supabase-repo";
import { loadEnv, main, writeReport } from "./_cli";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./_supabase";

main(async () => {
  const keep = process.argv.includes("--keep");
  loadEnv();
  const service = MemoryService.fromEnv(process.env);
  let calls = 0;
  const writer: MemoryWriter = {
    rememberConfirmed: (t, o) => (calls++, service.rememberConfirmed(t, o)),
    confirmWrite: (j, t, n) => service.confirmWrite(j, t, n),
  };
  const store = supabaseSyncStore(admin());
  const syncer: Syncer = {
    async background(source) {
      const p = await prepareSync(store, source);
      if (p.action === "write") {
        const o = await performWrite(store, writer, p);
        console.log(`  walrus ${source.kind} → ${o.status}${o.blobId ? ` blob=${o.blobId}` : ""}${o.error ? ` (${o.error})` : ""}`);
      }
    },
    async now(source) {
      const p = await prepareSync(store, source, { force: true });
      if (p.action !== "write") return { status: "skipped", reason: p.action === "skip" ? p.reason : "not-applicable" };
      return performWrite(store, writer, p);
    },
  };

  let user: TestUser | undefined;
  let exit = 1;
  try {
    const conn = await service.checkConnection({ verifyCredentials: true });
    console.log(`Walrus relayer ${conn.serverUrl} network=${conn.network}\n`);
    user = await createTestUser("smoke");
    const ctx: Ctx = {
      userId: user.id,
      repo: supabaseRepo(user.client),
      photos: supabasePhotoStore(user.client),
      sync: syncer,
      recall: { recall: async (q, o) => (await service.recall(q, o)).results },
    };

    console.log("Creating profile, family member, routine and memory (fictional data)…");
    const must = (label: string, r: ops.OpResult) => {
      if (!r.ok) throw new Error(`${label}: ${r.message} ${JSON.stringify(r.fieldErrors ?? {})}`);
      return r;
    };
    must("profile", await ops.saveElder(ctx, { full_name: "Edith Harper", description: "Edith is a retired piano teacher who loves Chopin and her cat Biscuit.", timezone: "Europe/London" }, null));
    const person = must("family", await ops.createFamilyMember(ctx, { full_name: "Daniel Harper", relationship: "Son", description: "Daniel is a carpenter who visits every Sunday." }, null));
    must("routine", await ops.createRoutine(ctx, { title: "Afternoon piano practice", recurrence: "daily", time_of_day: "15:00", is_active: "on" }));
    must("memory", await ops.createMemory(ctx, { title: "Daniel fixed the garden gate", description: "Daniel repaired the squeaky garden gate and stayed for tea and scones.", category: "visit", event_date: "2026-11-01", related_person_id: person.id! }));

    const elder = (await ctx.repo.getElder())!;
    const records = await ctx.repo.walrusRecords(elder.id);
    console.log(`\nwalrus_records (read through the caregiver's own RLS session):`);
    for (const r of records) console.log(`  ${r.kind.padEnd(13)} ${r.status.padEnd(7)} job=${r.job_id} blob=${r.blob_id}`);
    const stored = records.filter((r) => r.status === "stored" && r.blob_id);

    const before = calls;
    must("unchanged re-save", await ops.saveElder(ctx, { full_name: "Edith Harper", description: "Edith is a retired piano teacher who loves Chopin and her cat Biscuit.", timezone: "Europe/London" }, null));
    const noDuplicate = calls === before;
    console.log(`\nUnchanged re-save made ${calls - before} new Walrus writes (expected 0).`);

    // Recall from a FRESH client, in the elder's namespace, from Walrus only.
    const fresh = MemoryService.fromEnv({ ...process.env, MEMWAL_NAMESPACE: elderNamespace(elder.id) });
    const recall = await fresh.recall("Who is Edith's son?", { limit: 3 });
    fresh.close();
    console.log(`\nRecall (fresh client, namespace ${elderNamespace(elder.id)}): "Who is Edith's son?"`);
    recall.results.forEach((r, i) => console.log(`  ${i + 1}. [${r.distance.toFixed(3)}] ${r.text}`));
    const grounded = recall.results.some((r) => r.text.includes("Daniel Harper is Edith Harper's son"));

    const ok = stored.length === 4 && noDuplicate && grounded;
    console.log(`\n${ok ? "✓" : "✗"} stored=${stored.length}/4 · no duplicate on unchanged save=${noDuplicate} · recall grounded=${grounded}`);
    console.log(`report: ${writeReport("app-smoke", { ranAt: new Date().toISOString(), namespace: elderNamespace(elder.id), records: records.map((r) => ({ kind: r.kind, status: r.status, job_id: r.job_id, blob_id: r.blob_id })), noDuplicate, recall: recall.results })}`);
    exit = ok ? 0 : 1;
  } finally {
    if (!keep) {
      await deleteTestUser(user);
      console.log("Deleted the test caregiver's DayMate data (Walrus blobs remain, encrypted, in the test namespace).");
    }
    service.close();
  }
  return exit;
});
