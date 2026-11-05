/**
 * LIVE Row Level Security verification for the Phase 3B anchor tables, against
 * your real Supabase project (no Sui or Tatum calls). Creates two throwaway
 * caregivers, seeds one anchor through the service role, then checks that
 * caregivers can read only their own anchor STATUS and never salts,
 * commitments, payloads or signed transactions. Test users are deleted afterwards.
 *
 * Requires the Phase 3B migration to be applied.
 *
 *   npm run sui:rls-check
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  return data as Record<string, string>;
}

main(async () => {
  let a: TestUser | undefined;
  let b: TestUser | undefined;
  try {
    a = await createTestUser("a");
    b = await createTestUser("b");
    const svc = admin();
    const elder = await insertOne(a.client, "elders", { full_name: "Test Elder A", description: "RLS test" });
    const memory = await insertOne(a.client, "memories", { elder_id: elder.id, title: "M", description: "D", category: "visit" });
    await insertOne(svc, "walrus_records", {
      caregiver_id: a.id, elder_id: elder.id, kind: "memory", memory_id: memory.id, namespace: "rls-test", content_hash: "0".repeat(64), status: "stored", blob_id: "RLS_TEST_BLOB", stored_at: new Date().toISOString(),
    });
    const rpc = await svc.rpc("create_memory_anchor", {
      p_caregiver_id: a.id, p_elder_id: elder.id, p_memory_id: memory.id, p_version: 1, p_walrus_blob_id: "RLS_TEST_BLOB", p_schema_version: 1,
      p_commitment: randomBytes(32).toString("hex"), p_salt: randomBytes(32).toString("hex"), p_canonical_payload: "{}",
    });
    if (rpc.error) throw new Error(`create_memory_anchor: ${rpc.error.message}`);
    const anchorId = rpc.data as string;
    console.log("Seeded one anchor for caregiver A (service role).\n");

    const own = await a.client.from("memory_anchors").select("id, status, tx_digest, version").eq("id", anchorId);
    check("A can read own anchor status", own.data?.length === 1, own.error?.message);
    const star = await a.client.from("memory_anchors").select("*").eq("id", anchorId);
    check("A cannot select * (internal columns not granted)", Boolean(star.error));
    const lock = await a.client.from("memory_anchors").select("locked_until").eq("id", anchorId);
    check("A cannot read the internal lease column", Boolean(lock.error));
    const txc = await a.client.from("memory_anchors").select("tx_bytes, tx_signature").eq("id", anchorId);
    check("A cannot read the signed transaction columns", Boolean(txc.error));
    for (const cols of ["*", "salt", "commitment", "canonical_payload"]) {
      const s = await a.client.from("memory_anchor_secrets").select(cols);
      check(`A cannot read memory_anchor_secrets.${cols}`, Boolean(s.error) || (s.data?.length ?? 0) === 0, s.error ? undefined : `${s.data?.length} rows`);
    }
    const forge = await a.client.from("memory_anchors").update({ status: "verified" }).eq("id", anchorId).select("id");
    check("A cannot mark an anchor verified", Boolean(forge.error) || (forge.data?.length ?? 0) === 0);
    const ins = await a.client.from("memory_anchors").insert({ caregiver_id: a.id, elder_id: elder.id, memory_id: memory.id, version: 2, walrus_blob_id: "X", schema_version: 1, status: "verified" });
    check("A cannot insert anchors", Boolean(ins.error));
    const call = await a.client.rpc("create_memory_anchor", {
      p_caregiver_id: a.id, p_elder_id: elder.id, p_memory_id: memory.id, p_version: 3, p_walrus_blob_id: "Y", p_schema_version: 1,
      p_commitment: randomBytes(32).toString("hex"), p_salt: randomBytes(32).toString("hex"), p_canonical_payload: "{}",
    });
    check("A cannot call create_memory_anchor", Boolean(call.error));

    const other = await b.client.from("memory_anchors").select("id").eq("id", anchorId);
    check("B cannot read A's anchor", (other.data?.length ?? 0) === 0);
    const anonClient = anon();
    for (const t of ["memory_anchors", "memory_anchor_secrets"]) {
      const { data, error } = await anonClient.from(t).select(t === "memory_anchor_secrets" ? "anchor_id" : "id");
      check(`Anonymous users cannot read ${t}`, Boolean(error) || (data?.length ?? 0) === 0);
    }

    await a.client.from("memories").delete().eq("id", memory.id);
    const gone = await svc.from("memory_anchor_secrets").select("anchor_id").eq("anchor_id", anchorId);
    check("Deleting the memory deletes its anchor salt", (gone.data?.length ?? 1) === 0);
  } finally {
    await deleteTestUser(a);
    await deleteTestUser(b);
    console.log("\nDeleted the throwaway caregivers and their data.");
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} anchor RLS checks passed.`);
  return failed.length === 0 ? 0 : 1;
});
