/**
 * LIVE Row Level Security verification against your real Supabase project.
 * Creates two throwaway caregivers (A and B), has A create data, then checks
 * that B (and anonymous users) can neither see nor change it, and that no
 * caregiver can write Walrus sync state. Test users are deleted afterwards.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and
 * SUPABASE_SERVICE_ROLE_KEY (only to create/delete the test users).
 *
 *   npm run app:rls-check
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { anon, createTestUser, deleteTestUser, type TestUser } from "./_supabase";
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
    console.log(`Created throwaway caregivers A and B.\n`);

    // ── A creates data ──
    const elderA = await insertOne(a.client, "elders", { full_name: "Test Elder A", description: "RLS test" });
    const personA = await insertOne(a.client, "family_members", { elder_id: elderA.id, full_name: "Person A", relationship: "Daughter" });
    const routineA = await insertOne(a.client, "routines", { elder_id: elderA.id, title: "Tea", recurrence: "daily", time_of_day: "07:00" });
    const memoryA = await insertOne(a.client, "memories", { elder_id: elderA.id, title: "M", description: "D", category: "visit", related_person_id: personA.id });
    const photoPath = `${a.id}/${elderA.id}/rls-test.png`;
    const up = await a.client.storage.from("photos").upload(photoPath, new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), { contentType: "image/png" });
    check("A can upload a photo to their own folder", !up.error, up.error?.message);
    const elderB = await insertOne(b.client, "elders", { full_name: "Test Elder B", description: "RLS test" });

    // ── A sees own data ──
    for (const t of ["elders", "family_members", "routines", "memories"]) {
      const { data } = await a.client.from(t).select("id");
      check(`A sees own ${t}`, (data?.length ?? 0) === 1);
    }

    // ── B cannot read A's data ──
    for (const [t, id] of [["elders", elderA.id], ["family_members", personA.id], ["routines", routineA.id], ["memories", memoryA.id]] as const) {
      const { data } = await b.client.from(t).select("id").eq("id", id);
      check(`B cannot read A's ${t}`, (data?.length ?? 0) === 0);
    }
    const { data: bAll } = await b.client.from("memories").select("id");
    check("B's unfiltered memory query returns none of A's rows", (bAll ?? []).every((r) => r.id !== memoryA.id));

    // ── B cannot modify A's data ──
    const upd = await b.client.from("memories").update({ title: "hacked" }).eq("id", memoryA.id).select("id");
    check("B cannot update A's memory", (upd.data?.length ?? 0) === 0);
    const del = await b.client.from("family_members").delete().eq("id", personA.id).select("id");
    check("B cannot delete A's family member", (del.data?.length ?? 0) === 0);
    const delR = await b.client.from("routines").delete().eq("id", routineA.id).select("id");
    check("B cannot delete A's routine", (delR.data?.length ?? 0) === 0);
    const steal = await b.client.from("elders").update({ caregiver_id: b.id }).eq("id", elderA.id).select("id");
    check("B cannot take over A's elder", (steal.data?.length ?? 0) === 0);

    // ── B cannot attach rows to A's elder or impersonate A ──
    const attach = await b.client.from("family_members").insert({ elder_id: elderA.id, full_name: "Intruder", relationship: "x" });
    check("B cannot add a family member to A's elder", Boolean(attach.error));
    const impersonate = await b.client.from("memories").insert({ elder_id: elderA.id, caregiver_id: a.id, title: "x", description: "x", category: "other" });
    check("B cannot insert rows as A", Boolean(impersonate.error));
    const crossLink = await b.client.from("memories").insert({ elder_id: elderB.id, title: "x", description: "x", category: "other", related_person_id: personA.id });
    check("B cannot link a memory to A's family member", Boolean(crossLink.error));
    const second = await a.client.from("elders").insert({ full_name: "Second", description: "x" });
    check("A cannot create a second elder profile (MVP: one per caregiver)", Boolean(second.error));

    // ── storage ──
    const read = await b.client.storage.from("photos").download(photoPath);
    check("B cannot download A's photo", Boolean(read.error));
    const plant = await b.client.storage.from("photos").upload(`${a.id}/${elderA.id}/planted.png`, new Blob([new Uint8Array([1])], { type: "image/png" }), { contentType: "image/png" });
    check("B cannot upload into A's photo folder", Boolean(plant.error));
    const signed = await b.client.storage.from("photos").createSignedUrl(photoPath, 60);
    check("B cannot create a signed URL for A's photo", Boolean(signed.error));

    // ── Walrus sync state is server-only ──
    const fake = await a.client.from("walrus_records").insert({
      caregiver_id: a.id, elder_id: elderA.id, kind: "memory", memory_id: memoryA.id, namespace: "x", content_hash: "x", status: "stored", blob_id: "FAKE", stored_at: new Date().toISOString(),
    });
    check("A cannot forge a Walrus 'stored' record", Boolean(fake.error));
    const { data: wr } = await a.client.from("walrus_records").select("id");
    check("A can read walrus_records (own rows only, none yet)", Array.isArray(wr));

    // ── anonymous ──
    const anonClient = anon();
    for (const t of ["elders", "family_members", "routines", "memories", "walrus_records", "caregivers"]) {
      const { data, error } = await anonClient.from(t).select("id");
      check(`Anonymous users cannot read ${t}`, Boolean(error) || (data?.length ?? 0) === 0);
    }

    // ── A's data intact ──
    const { data: still } = await a.client.from("memories").select("title").eq("id", memoryA.id).single();
    check("A's memory is unchanged after B's attempts", still?.title === "M");
  } finally {
    await deleteTestUser(a);
    await deleteTestUser(b);
    console.log("\nDeleted the throwaway caregivers and their data.");
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} RLS checks passed.`);
  return failed.length === 0 ? 0 : 1;
});
