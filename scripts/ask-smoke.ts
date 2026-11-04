/**
 * LIVE Ask DayMate check against REAL Supabase and REAL Walrus Memory Mainnet
 * with fictional data. Creates a throwaway caregiver, saves a profile, family,
 * routines and memories through the app's own operations (Walrus writes run
 * synchronously here), edits one memory (leaving a superseded blob on
 * Walrus) and deletes another (leaving an orphaned blob), then asks real
 * questions through the same `ask()` the web app uses.
 *
 *   npm run ask:smoke            # add --keep to keep the test caregiver
 */
import { currentEvidence } from "../src/lib/ask/evidence";
import { addDays, localNow } from "../src/lib/domain/schedule";
import { MemoryService } from "../src/lib/memory";
import { supabaseSyncStore } from "../src/lib/walrus-sync/supabase-store";
import { performWrite, prepareSync, type MemoryWriter } from "../src/lib/walrus-sync/sync";
import { elderNamespace } from "../src/lib/walrus-sync/text";
import { ask, NOT_SAVED, UNKNOWN } from "../src/server/ask";
import * as ops from "../src/server/operations";
import type { Ctx, Syncer } from "../src/server/ports";
import { supabasePhotoStore, supabaseRepo } from "../src/server/supabase-repo";
import { loadEnv, main, writeReport } from "./_cli";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./_supabase";

main(async () => {
  const keep = process.argv.includes("--keep");
  loadEnv();
  const service = MemoryService.fromEnv(process.env); // the one Walrus client for this process
  const writer: MemoryWriter = { rememberConfirmed: (t, o) => service.rememberConfirmed(t, o), confirmWrite: (j, t, n) => service.confirmWrite(j, t, n) };
  const store = supabaseSyncStore(admin());
  let writes = 0;
  const syncer: Syncer = {
    async background(source) {
      const p = await prepareSync(store, source);
      if (p.action !== "write") return;
      const o = await performWrite(store, writer, p);
      writes++;
      console.log(`  walrus ${source.kind.padEnd(13)} → ${o.status}${o.error ? ` (${o.error})` : ""}`);
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
    user = await createTestUser("ask");
    const ctx: Ctx = {
      userId: user.id,
      repo: supabaseRepo(user.client),
      photos: supabasePhotoStore(user.client),
      sync: syncer,
      recall: { recall: async (q, o) => (await service.recall(q, o)).results },
    };
    const must = async (label: string, p: Promise<ops.OpResult>) => {
      const r = await p;
      if (!r.ok) throw new Error(`${label}: ${r.message} ${JSON.stringify(r.fieldErrors ?? {})}`);
      return r.id!;
    };

    const today = localNow(new Date(), "Europe/London").date;
    console.log(`Saving fictional data (today in Europe/London: ${today})…`);
    await must("profile", ops.saveElder(ctx, { full_name: "Rose Whitfield", description: "Rose is a retired nurse who loves crosswords and brass band music.", date_of_birth: "1945-05-17", timezone: "Europe/London" }, null));
    const helen = await must("helen", ops.createFamilyMember(ctx, { full_name: "Helen Whitfield", relationship: "Daughter", description: "Helen is a vet with curly brown hair." }, null));
    const sam = await must("sam", ops.createFamilyMember(ctx, { full_name: "Sam Whitfield", relationship: "Grandson", description: "Sam is 12 and loves football." }, null));
    await must("walk", ops.createRoutine(ctx, { title: "Daily walk", recurrence: "daily", time_of_day: "09:30", is_active: "on" }));
    await must("coffee", ops.createRoutine(ctx, { title: "Coffee morning", recurrence: "weekly", weekday: "3", time_of_day: "10:30", is_active: "on" }));
    await must("visit", ops.createRoutine(ctx, { title: "Helen visits", recurrence: "none", activity_date: addDays(today, 3), time_of_day: "14:00", is_active: "on" }));
    await must("m-rose", ops.createMemory(ctx, { title: "Helen brought a rose bush", description: "Helen visited and planted a yellow climbing rose by the back door.", category: "visit", event_date: addDays(today, -1), related_person_id: helen }));
    const samLunch = await must("m-sam", ops.createMemory(ctx, { title: "Sam came for Sunday lunch", description: "Sam visited and talked about his football match.", category: "visit", event_date: addDays(today, -10), related_person_id: sam }));
    const music = await must("m-music", ops.createMemory(ctx, { title: "Favourite music", description: "Rose loves brass band music, especially the Grimethorpe Colliery Band.", category: "preference" }));
    await must("m-birthday", ops.createMemory(ctx, { title: "80th birthday party", description: "At the 80th birthday party the family sang together in the garden and Helen baked a lemon cake.", category: "celebration", event_date: `${Number(today.slice(0, 4)) - 1}-05-17` }));

    console.log("\nEditing the music memory (old blob becomes superseded) and deleting Sam's lunch memory (blob orphaned)…");
    await must("edit", ops.updateMemory(ctx, music, { title: "Favourite music", description: "Rose loves choir music and singing old hymns.", category: "preference" }));
    await must("delete", ops.deleteMemory(ctx, samLunch));

    // Show the filtering at work on raw Mainnet recall results.
    const elder = (await ctx.repo.getElder())!;
    const records = await ctx.repo.walrusRecords(elder.id);
    const raw = await ctx.recall.recall("Grimethorpe Colliery brass band music", { namespace: elderNamespace(elder.id), limit: 20 });
    const filtered = currentEvidence(raw, records);
    console.log(`\nRaw Walrus recall: ${raw.length} hits; accepted ${filtered.accepted.length}; rejected ${JSON.stringify(filtered.rejected)}`);
    const staleOnWalrus = raw.some((h) => h.text.includes("Grimethorpe"));
    const deletedOnWalrus = (await ctx.recall.recall("Sam Sunday lunch football match", { namespace: elderNamespace(elder.id), limit: 20 })).some((h) => h.text.includes("football match"));
    console.log(`Superseded "Grimethorpe" blob still returned by Walrus: ${staleOnWalrus} · deleted "football match" blob still returned: ${deletedOnWalrus}`);

    const checks: { q: string; expect: (t: string) => boolean; why: string }[] = [
      { q: "Who is my daughter?", expect: (t) => t.startsWith("Helen Whitfield is your daughter."), why: "family (Supabase)" },
      { q: "Who are my grandchildren?", expect: (t) => t.includes("Sam Whitfield is your grandson"), why: "family plural" },
      { q: "Who visited me recently?", expect: (t) => t.startsWith("Helen Whitfield, your daughter, visited you yesterday."), why: "recent visit (Walrus + event_date)" },
      { q: "When did Sam last visit?", expect: (t) => !t.includes("football match"), why: "deleted memory excluded" },
      { q: "What am I doing tomorrow?", expect: (t) => t.includes("Daily walk at 9:30 AM"), why: "schedule (daily)" },
      { q: "When is Helen coming?", expect: (t) => t.includes("Helen visits"), why: "planned visit (one-time)" },
      { q: "When is Michael coming?", expect: (t) => t.startsWith("I don't see a visit from Michael planned."), why: "no invented visit" },
      { q: "What music do I enjoy?", expect: (t) => /choir|brass band/.test(t) && !t.includes("Grimethorpe"), why: "preference; superseded blob excluded" },
      { q: "Tell me about the Grimethorpe Colliery", expect: (t) => t === NOT_SAVED, why: "only the superseded blob mentions it" },
      { q: "What happened at my birthday celebration?", expect: (t) => t.includes("80th birthday party"), why: "past event (Walrus)" },
      { q: "Tell me about Helen", expect: (t) => t.includes("is your daughter") && t.includes("Helen visits") && t.includes("climbing rose"), why: "mixed: family + routines + memories" },
      { q: "What's the weather like?", expect: (t) => t === UNKNOWN, why: "unknown → honest" },
      { q: "How old am I?", expect: (t) => /^You are \d+ years old\.$/.test(t), why: "profile" },
    ];

    console.log("\n── Ask DayMate (real Supabase + real Walrus Mainnet) ──");
    const results = [];
    for (const c of checks) {
      const r = await ask(ctx, c.q);
      const text = r.ok ? r.answer.text : `ERROR: ${r.error}`;
      const pass = r.ok && c.expect(r.answer.text);
      results.push({ question: c.q, answer: text, sources: r.ok ? r.answer.sources : [], pass, why: c.why });
      console.log(`\n${pass ? "✓" : "✗"} Q: ${c.q}   [${c.why}]\n  A: ${text.replace(/\n/g, "\n     ")}${r.ok ? `\n     (from: ${r.answer.sources.join(", ") || "—"})` : ""}`);
    }

    const passed = results.filter((r) => r.pass).length;
    console.log(`\n${passed}/${results.length} live Ask DayMate checks passed · ${writes} Walrus writes made.`);
    console.log(`report: ${writeReport("ask-smoke", { ranAt: new Date().toISOString(), namespace: elderNamespace(elder.id), rawRecall: { hits: raw.length, accepted: filtered.accepted.length, rejected: filtered.rejected }, staleOnWalrus, deletedOnWalrus, results })}`);
    exit = passed === results.length ? 0 : 1;
  } finally {
    if (!keep) {
      await deleteTestUser(user);
      console.log("Deleted the test caregiver's DayMate data (fictional Walrus blobs remain, encrypted, in the test namespace).");
    }
    service.close();
  }
  return exit;
});
