/**
 * LIVE check of elder-device pairing and read-only access against your real
 * Supabase project (no Walrus or Sui calls). Creates two throwaway caregivers
 * A and B with their own elders, pairs a device for A using the production
 * store, then checks the device sees only A's elder, can never write, and that
 * caregivers cannot read token hashes or pairing codes. Test users are deleted.
 *
 * Requires the 20261105000000_elder_devices.sql migration.
 *
 *   npm run device:check
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { completePairing, deviceFromToken, startPairing } from "../src/lib/devices/pairing";
import { deviceAdmin, supabaseDeviceStore } from "../src/lib/devices/supabase-store";
import { elderPhotoStore, ReadOnlyError, scopedElderRepo } from "../src/server/elder-repo";
import { admin, anon, createTestUser, deleteTestUser, type TestUser } from "./_supabase";
import { main } from "./_cli";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${!pass && detail ? ` — ${detail}` : ""}`);
}

async function insertOne(db: SupabaseClient, table: string, row: Record<string, unknown>) {
  const { data, error } = await db.from(table).insert(row).select("*").single();
  if (error) throw new Error(`${table} insert: ${error.message}`);
  return data as { id: string } & Record<string, string>;
}

async function refuses(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof ReadOnlyError;
  }
}

main(async () => {
  let a: TestUser | undefined;
  let b: TestUser | undefined;
  try {
    a = await createTestUser("a");
    b = await createTestUser("b");
    const svc = admin();
    const store = supabaseDeviceStore(svc);
    const elderA = await insertOne(a.client, "elders", { full_name: "Elder A", description: "device test" });
    const elderB = await insertOne(b.client, "elders", { full_name: "Elder B", description: "device test" });
    await insertOne(a.client, "family_members", { elder_id: elderA.id, full_name: "Person A", relationship: "Daughter" });
    await insertOne(b.client, "family_members", { elder_id: elderB.id, full_name: "Person B", relationship: "Son" });
    const memA = await insertOne(a.client, "memories", { elder_id: elderA.id, title: "MA", description: "DA", category: "visit" });
    const memB = await insertOne(b.client, "memories", { elder_id: elderB.id, title: "MB", description: "DB", category: "visit" });
    console.log("Created throwaway caregivers A and B.\n");

    // ── pairing ──
    const { code } = await startPairing(store, { caregiverId: a.id, elderId: elderA.id, voiceEnabled: true });
    const paired = await completePairing(store, code);
    check("A's code pairs a device", Boolean(paired));
    check("the same code cannot be used twice", (await completePairing(store, code)) === null);
    check("a made-up code does not pair", (await completePairing(store, "ABCD-EFGH")) === null);
    const { data: codeRows } = await svc.from("elder_pairing_codes").select("code_hash").eq("elder_id", elderA.id);
    check("pairing codes are stored only as hashes", (codeRows ?? []).every((r) => r.code_hash !== code && /^[0-9a-f]{64}$/.test(r.code_hash)));
    const device = await deviceFromToken(store, paired!.token);
    check("the device resolves to A's elder", device?.elder_id === elderA.id && device.caregiver_id === a.id);
    check("voice setting carried from the code", device?.voice_enabled === true);
    if (!device) throw new Error("pairing failed; cannot continue");

    // ── read-only, single-elder access ──
    const repo = scopedElderRepo(svc, a.id, elderA.id);
    check("device reads A's elder", (await repo.getElder())?.id === elderA.id);
    const fam = await repo.list("family_members", elderA.id);
    check("device lists only A's family", fam.length === 1 && fam[0]!.full_name === "Person A");
    check("device cannot list B's family", (await repo.list("family_members", elderB.id)).length === 0);
    check("device cannot fetch B's memory by ID", (await repo.get("memories", memB.id)) === null);
    check("device can fetch A's memory", (await repo.get("memories", memA.id))?.id === memA.id);
    check("device cannot read B's Walrus records", (await repo.walrusRecords(elderB.id)).length === 0);
    check("device writes are refused", (await refuses(() => repo.insert("memories", { elder_id: elderA.id, title: "x", description: "x", category: "other" }))) && (await refuses(() => repo.update("memories", memA.id, { title: "x" }))) && (await refuses(() => repo.remove("memories", memA.id))));
    const { data: still } = await svc.from("memories").select("title").eq("id", memA.id).single();
    check("A's memory unchanged", still?.title === "MA");
    const urls = await elderPhotoStore(svc, a.id).signedUrls([`${b.id}/${elderB.id}/x.png`, `${a.id}/../${b.id}/x.png`]);
    check("device cannot get signed URLs for B's photos", Object.keys(urls).length === 0);

    // ── RLS on the new tables ──
    const own = await a.client.from("elder_devices").select("id, name, voice_enabled, last_seen_at");
    check("A can read own device status", own.data?.length === 1, own.error?.message);
    const hash = await a.client.from("elder_devices").select("token_hash");
    check("A cannot read device token hashes", Boolean(hash.error));
    const other = await b.client.from("elder_devices").select("id");
    check("B cannot see A's devices", (other.data?.length ?? 0) === 0);
    const codesA = await a.client.from("elder_pairing_codes").select("id");
    check("caregivers cannot read pairing codes", Boolean(codesA.error) || (codesA.data?.length ?? 0) === 0);
    const upd = await a.client.from("elder_devices").update({ revoked_at: null, voice_enabled: false }).eq("id", device.id).select("id");
    check("caregivers cannot update devices directly", Boolean(upd.error) || (upd.data?.length ?? 0) === 0);
    const rpc = await a.client.rpc("redeem_pairing_code", { p_code_hash: "0".repeat(64), p_token_hash: "1".repeat(64), p_name: "x" });
    check("caregivers cannot call redeem_pairing_code", Boolean(rpc.error));
    for (const t of ["elder_devices", "elder_pairing_codes"]) {
      const r = await anon().from(t).select("id");
      check(`anonymous users cannot read ${t}`, Boolean(r.error) || (r.data?.length ?? 0) === 0);
    }

    // ── revoke ──
    check("B cannot unpair A's device", (await deviceAdmin(svc, b.id).revoke(device.id)) === false);
    check("device still works after B's attempt", (await deviceFromToken(store, paired!.token)) !== null);
    check("A can unpair the device", await deviceAdmin(svc, a.id).revoke(device.id));
    check("unpaired device stops working", (await deviceFromToken(store, paired!.token)) === null);
  } finally {
    await deleteTestUser(a);
    await deleteTestUser(b);
    console.log("\nDeleted the throwaway caregivers and their data.");
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} device checks passed.`);
  return failed.length === 0 ? 0 : 1;
});
