import { randomUUID } from "node:crypto";
import type { Elder, FamilyMember, Memory, Routine, WalrusKind } from "../lib/domain/types";
import {
  elderSchema,
  familyMemberSchema,
  memorySchema,
  parseForm,
  PHOTO_TYPES,
  routineSchema,
  uuid,
  validatePhoto,
} from "../lib/domain/validation";
import type { SyncSource } from "../lib/walrus-sync/sync";
import { contentHash, familyMemberText, memoryText, profileText, routineText } from "../lib/walrus-sync/text";
import type { Ctx } from "./ports";

/**
 * Business operations for the caregiver app. All input is validated here on
 * the server; data access goes through the caregiver's RLS-scoped repo.
 * Postgres is saved first; Walrus sync is scheduled afterwards and its state
 * is tracked separately, so a database save is never reported as a Walrus write.
 */

export type OpResult = { ok: true; id?: string; message?: string } | { ok: false; message: string; fieldErrors?: Record<string, string> };

const NOT_FOUND: OpResult = { ok: false, message: "That item could not be found. It may have been removed." };
const NO_PROFILE: OpResult = { ok: false, message: "Create the profile first." };
const SAVE_FAILED = "We couldn't save that. Please try again.";

function invalid(fieldErrors: Record<string, string>): OpResult {
  return { ok: false, message: "Please check the highlighted fields.", fieldErrors };
}

async function guard(fn: () => Promise<OpResult>): Promise<OpResult> {
  try {
    return await fn();
  } catch (err) {
    console.error("[daymate] operation failed:", err instanceof Error ? err.message : err);
    return { ok: false, message: SAVE_FAILED };
  }
}

// ── photos ───────────────────────────────────────────────────────────────
async function storePhoto(ctx: Ctx, elderId: string, prefix: string, file: File): Promise<string> {
  const path = `${ctx.userId}/${elderId}/${prefix}-${randomUUID()}.${PHOTO_TYPES[file.type]}`;
  await ctx.photos.upload(path, file);
  return path;
}

async function discardPhoto(ctx: Ctx, path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await ctx.photos.remove([path]);
  } catch (err) {
    console.error("[daymate] photo cleanup failed:", err instanceof Error ? err.message : err);
  }
}

// ── Walrus sources ───────────────────────────────────────────────────────
function source(ctx: Ctx, elder: Elder, kind: WalrusKind, sourceId: string | null, text: string | null): SyncSource {
  return { caregiverId: ctx.userId, elderId: elder.id, kind, sourceId, text };
}

async function memorySource(ctx: Ctx, elder: Elder, memory: Memory): Promise<SyncSource> {
  const related = memory.related_person_id ? await ctx.repo.get("family_members", memory.related_person_id) : null;
  return source(ctx, elder, "memory", memory.id, memoryText(elder.full_name, memory, related));
}

export async function buildSource(ctx: Ctx, elder: Elder, kind: WalrusKind, sourceId: string | null): Promise<SyncSource | null> {
  switch (kind) {
    case "profile":
      return source(ctx, elder, "profile", null, profileText(elder));
    case "family_member": {
      const m = await ctx.repo.get("family_members", sourceId!);
      return m ? source(ctx, elder, kind, m.id, familyMemberText(elder.full_name, m)) : null;
    }
    case "routine": {
      const r = await ctx.repo.get("routines", sourceId!);
      return r ? source(ctx, elder, kind, r.id, routineText(elder.full_name, r)) : null;
    }
    case "memory": {
      const m = await ctx.repo.get("memories", sourceId!);
      return m ? memorySource(ctx, elder, m) : null;
    }
  }
}

/** Re-sync every record whose text embeds the elder's name. */
async function resyncAll(ctx: Ctx, elder: Elder): Promise<void> {
  const [family, routines, memories] = await Promise.all([
    ctx.repo.list("family_members", elder.id),
    ctx.repo.list("routines", elder.id),
    ctx.repo.list("memories", elder.id),
  ]);
  for (const m of family) await ctx.sync.background(source(ctx, elder, "family_member", m.id, familyMemberText(elder.full_name, m)));
  for (const r of routines) await ctx.sync.background(source(ctx, elder, "routine", r.id, routineText(elder.full_name, r)));
  for (const m of memories) await ctx.sync.background(await memorySource(ctx, elder, m));
}

async function scheduleSync(ctx: Ctx, run: () => Promise<void>): Promise<void> {
  // A sync bookkeeping failure must not undo or misreport a successful DB save;
  // the record simply shows as not yet on Walrus and can be retried.
  try {
    await run();
  } catch (err) {
    console.error("[daymate] could not schedule Walrus sync:", err instanceof Error ? err.message : err);
  }
}

// ── elder profile ────────────────────────────────────────────────────────
export async function saveElder(ctx: Ctx, values: Record<string, string>, photo: FormDataEntryValue | null): Promise<OpResult> {
  const parsed = parseForm(elderSchema, values);
  const p = validatePhoto(photo);
  if (!parsed.ok || p.error) return invalid({ ...(parsed.ok ? {} : parsed.fieldErrors), ...(p.error ? { photo: p.error } : {}) });
  const removePhoto = values.remove_photo === "on";

  return guard(async () => {
    const existing = await ctx.repo.getElder();
    if (!existing) {
      // Need the elder's id for the photo path: insert first, then attach the photo.
      let elder = await ctx.repo.insertElder({ ...parsed.data, photo_path: null });
      if (p.file) {
        const path = await storePhoto(ctx, elder.id, "elder", p.file);
        elder = (await ctx.repo.updateElder(elder.id, { photo_path: path })) ?? elder;
      }
      await scheduleSync(ctx, () => ctx.sync.background(source(ctx, elder, "profile", null, profileText(elder))));
      return { ok: true, id: elder.id, message: "Profile created." } as OpResult;
    }

    const photo_path = p.file ? await storePhoto(ctx, existing.id, "elder", p.file) : removePhoto ? null : existing.photo_path;
    const elder = await ctx.repo.updateElder(existing.id, { ...parsed.data, photo_path });
    if (!elder) return NOT_FOUND;
    if (photo_path !== existing.photo_path) await discardPhoto(ctx, existing.photo_path);

    await scheduleSync(ctx, async () => {
      await ctx.sync.background(source(ctx, elder, "profile", null, profileText(elder)));
      if (elder.full_name !== existing.full_name) await resyncAll(ctx, elder);
    });
    return { ok: true, id: elder.id, message: "Profile saved." } as OpResult;
  });
}

// ── family members ───────────────────────────────────────────────────────
export async function createFamilyMember(ctx: Ctx, values: Record<string, string>, photo: FormDataEntryValue | null): Promise<OpResult> {
  const parsed = parseForm(familyMemberSchema, values);
  const p = validatePhoto(photo);
  if (!parsed.ok || p.error) return invalid({ ...(parsed.ok ? {} : parsed.fieldErrors), ...(p.error ? { photo: p.error } : {}) });

  return guard(async () => {
    const elder = await ctx.repo.getElder();
    if (!elder) return NO_PROFILE;
    const photo_path = p.file ? await storePhoto(ctx, elder.id, "family", p.file) : null;
    let member: FamilyMember;
    try {
      member = await ctx.repo.insert("family_members", { ...parsed.data, elder_id: elder.id, photo_path });
    } catch (err) {
      await discardPhoto(ctx, photo_path);
      throw err;
    }
    await scheduleSync(ctx, () => ctx.sync.background(source(ctx, elder, "family_member", member.id, familyMemberText(elder.full_name, member))));
    return { ok: true, id: member.id, message: `${member.full_name} added.` } as OpResult;
  });
}

export async function updateFamilyMember(ctx: Ctx, id: string, values: Record<string, string>, photo: FormDataEntryValue | null): Promise<OpResult> {
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  const parsed = parseForm(familyMemberSchema, values);
  const p = validatePhoto(photo);
  if (!parsed.ok || p.error) return invalid({ ...(parsed.ok ? {} : parsed.fieldErrors), ...(p.error ? { photo: p.error } : {}) });
  const removePhoto = values.remove_photo === "on";

  return guard(async () => {
    const elder = await ctx.repo.getElder();
    const existing = await ctx.repo.get("family_members", id);
    if (!elder || !existing || existing.elder_id !== elder.id) return NOT_FOUND;
    const photo_path = p.file ? await storePhoto(ctx, elder.id, "family", p.file) : removePhoto ? null : existing.photo_path;
    const member = await ctx.repo.update("family_members", id, { ...parsed.data, photo_path });
    if (!member) return NOT_FOUND;
    if (photo_path !== existing.photo_path) await discardPhoto(ctx, existing.photo_path);

    await scheduleSync(ctx, async () => {
      await ctx.sync.background(source(ctx, elder, "family_member", member.id, familyMemberText(elder.full_name, member)));
      if (member.full_name !== existing.full_name || member.relationship !== existing.relationship) {
        for (const m of await ctx.repo.memoriesForPerson(member.id)) await ctx.sync.background(await memorySource(ctx, elder, m));
      }
    });
    return { ok: true, id, message: `${member.full_name} updated.` } as OpResult;
  });
}

export async function deleteFamilyMember(ctx: Ctx, id: string): Promise<OpResult> {
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  return guard(async () => {
    const elder = await ctx.repo.getElder();
    const existing = await ctx.repo.get("family_members", id);
    if (!elder || !existing) return NOT_FOUND;
    const linked = await ctx.repo.memoriesForPerson(id);
    if (!(await ctx.repo.remove("family_members", id))) return NOT_FOUND;
    await discardPhoto(ctx, existing.photo_path);
    // memories.related_person_id is set null by the DB; refresh their text.
    await scheduleSync(ctx, async () => {
      for (const m of linked) await ctx.sync.background(await memorySource(ctx, elder, { ...m, related_person_id: null }));
    });
    return { ok: true, message: `${existing.full_name} removed.` } as OpResult;
  });
}

// ── routines ─────────────────────────────────────────────────────────────
export async function createRoutine(ctx: Ctx, values: Record<string, string>): Promise<OpResult> {
  const parsed = parseForm(routineSchema, values);
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  return guard(async () => {
    const elder = await ctx.repo.getElder();
    if (!elder) return NO_PROFILE;
    const routine = await ctx.repo.insert("routines", { ...parsed.data, elder_id: elder.id });
    await scheduleSync(ctx, () => ctx.sync.background(source(ctx, elder, "routine", routine.id, routineText(elder.full_name, routine))));
    return { ok: true, id: routine.id, message: `"${routine.title}" added.` } as OpResult;
  });
}

export async function updateRoutine(ctx: Ctx, id: string, values: Record<string, string>): Promise<OpResult> {
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  const parsed = parseForm(routineSchema, values);
  if (!parsed.ok) return invalid(parsed.fieldErrors);
  return guard(async () => {
    const elder = await ctx.repo.getElder();
    if (!elder) return NOT_FOUND;
    const routine = await ctx.repo.update("routines", id, parsed.data);
    if (!routine) return NOT_FOUND;
    await scheduleSync(ctx, () => ctx.sync.background(source(ctx, elder, "routine", routine.id, routineText(elder.full_name, routine))));
    return { ok: true, id, message: `"${routine.title}" updated.` } as OpResult;
  });
}

export async function setRoutineActive(ctx: Ctx, id: string, active: boolean): Promise<OpResult> {
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  return guard(async () => {
    const elder = await ctx.repo.getElder();
    if (!elder) return NOT_FOUND;
    const routine = await ctx.repo.update("routines", id, { is_active: active } as Partial<Routine>);
    if (!routine) return NOT_FOUND;
    await scheduleSync(ctx, () => ctx.sync.background(source(ctx, elder, "routine", routine.id, routineText(elder.full_name, routine))));
    return { ok: true, id, message: active ? "Activity turned on." : "Activity paused." } as OpResult;
  });
}

export async function deleteRoutine(ctx: Ctx, id: string): Promise<OpResult> {
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  return guard(async () => ((await ctx.repo.remove("routines", id)) ? ({ ok: true, message: "Activity removed." } as OpResult) : NOT_FOUND));
}

// ── memories ─────────────────────────────────────────────────────────────
async function checkRelatedPerson(ctx: Ctx, elder: Elder, personId: string | null): Promise<boolean> {
  if (!personId) return true;
  const person = await ctx.repo.get("family_members", personId);
  return Boolean(person && person.elder_id === elder.id);
}

export async function createMemory(ctx: Ctx, values: Record<string, string>, photo: FormDataEntryValue | null = null): Promise<OpResult> {
  const parsed = parseForm(memorySchema, values);
  const p = validatePhoto(photo);
  if (!parsed.ok || p.error) return invalid({ ...(parsed.ok ? {} : parsed.fieldErrors), ...(p.error ? { photo: p.error } : {}) });
  return guard(async () => {
    const elder = await ctx.repo.getElder();
    if (!elder) return NO_PROFILE;
    if (!(await checkRelatedPerson(ctx, elder, parsed.data.related_person_id))) return invalid({ related_person_id: "Choose a person from the list." });
    // photo_path is only written when a photo is chosen (works before the M5 migration otherwise)
    const photo_path = p.file ? await storePhoto(ctx, elder.id, "memory", p.file) : null;
    let memory: Memory;
    try {
      memory = await ctx.repo.insert("memories", { ...parsed.data, elder_id: elder.id, ...(photo_path ? { photo_path } : {}) });
    } catch (err) {
      await discardPhoto(ctx, photo_path);
      throw err;
    }
    await scheduleSync(ctx, async () => ctx.sync.background(await memorySource(ctx, elder, memory)));
    return { ok: true, id: memory.id, message: "Memory saved." } as OpResult;
  });
}

export async function updateMemory(ctx: Ctx, id: string, values: Record<string, string>, photo: FormDataEntryValue | null = null): Promise<OpResult> {
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  const parsed = parseForm(memorySchema, values);
  const p = validatePhoto(photo);
  if (!parsed.ok || p.error) return invalid({ ...(parsed.ok ? {} : parsed.fieldErrors), ...(p.error ? { photo: p.error } : {}) });
  const removePhoto = values.remove_photo === "on";
  return guard(async () => {
    const elder = await ctx.repo.getElder();
    if (!elder) return NOT_FOUND;
    if (!(await checkRelatedPerson(ctx, elder, parsed.data.related_person_id))) return invalid({ related_person_id: "Choose a person from the list." });
    const existing = await ctx.repo.get("memories", id);
    if (!existing) return NOT_FOUND;
    const oldPhoto = existing.photo_path ?? null;
    const photo_path = p.file ? await storePhoto(ctx, elder.id, "memory", p.file) : removePhoto ? null : oldPhoto;
    const photoChanged = photo_path !== oldPhoto;
    const memory = await ctx.repo.update("memories", id, { ...parsed.data, ...(photoChanged ? { photo_path } : {}) });
    if (!memory) {
      if (p.file) await discardPhoto(ctx, photo_path);
      return NOT_FOUND;
    }
    if (photoChanged) await discardPhoto(ctx, oldPhoto);
    await scheduleSync(ctx, async () => ctx.sync.background(await memorySource(ctx, elder, memory)));
    return { ok: true, id, message: "Memory updated." } as OpResult;
  });
}

export async function deleteMemory(ctx: Ctx, id: string): Promise<OpResult> {
  if (!uuid.safeParse(id).success) return NOT_FOUND;
  return guard(async () => {
    const existing = await ctx.repo.get("memories", id);
    if (!existing || !(await ctx.repo.remove("memories", id))) return NOT_FOUND;
    await discardPhoto(ctx, existing.photo_path);
    return { ok: true, message: "Memory deleted." } as OpResult;
  });
}

// ── Walrus retry ─────────────────────────────────────────────────────────
const KINDS: readonly WalrusKind[] = ["profile", "family_member", "routine", "memory"];

/** Re-attempt the Walrus write for one record and wait for the result. */
export async function retryWalrus(ctx: Ctx, kind: string, sourceId: string): Promise<OpResult> {
  if (!KINDS.includes(kind as WalrusKind)) return NOT_FOUND;
  if (kind !== "profile" && !uuid.safeParse(sourceId).success) return NOT_FOUND;
  return guard(async () => {
    const elder = await ctx.repo.getElder();
    if (!elder) return NOT_FOUND;
    const src = await buildSource(ctx, elder, kind as WalrusKind, kind === "profile" ? null : sourceId);
    if (!src) return NOT_FOUND;
    const outcome = await ctx.sync.now(src);
    switch (outcome.status) {
      case "stored":
        return { ok: true, message: "Stored on Walrus." } as OpResult;
      case "skipped":
        return { ok: true, message: outcome.reason === "unchanged" ? "Already stored on Walrus." : "Nothing to store for this item." } as OpResult;
      case "pending":
        return { ok: false, message: "Walrus is still processing this write. Check again in a minute." } as OpResult;
      case "superseded":
        return { ok: true, message: "This item changed while saving; the latest version is being stored." } as OpResult;
      default:
        return { ok: false, message: "The Walrus write failed again. Please try later." } as OpResult;
    }
  });
}

// ── Sui anchor retry (Phase 3B) ──────────────────────────────────────────
const ANCHOR_INELIGIBLE: Record<string, string> = {
  "walrus-pending": "This memory is still being saved to Walrus. It can be anchored once it is stored.",
  "walrus-failed": "Save this memory to Walrus first.",
  "no-walrus-record": "Save this memory to Walrus first.",
  "no-blob": "Save this memory to Walrus first.",
  "stale-content": "This memory changed since it was stored on Walrus. It can be anchored once the latest version is stored.",
};

/** Anchor (or re-check) the current version of one memory on Sui and wait for the result. */
export async function retrySuiAnchor(ctx: Ctx, memoryId: string): Promise<OpResult> {
  if (!uuid.safeParse(memoryId).success) return NOT_FOUND;
  if (!ctx.anchor?.enabled) return { ok: false, message: "Sui anchoring is not turned on." };
  return guard(async () => {
    const elder = await ctx.repo.getElder();
    if (!elder) return NOT_FOUND;
    const src = await buildSource(ctx, elder, "memory", memoryId); // RLS: own memories only
    if (!src?.text) return NOT_FOUND;
    const outcome = await ctx.anchor!.anchor({ caregiverId: ctx.userId, memoryId, expectedContentHash: contentHash(src.text) }, { retryFailed: true });
    switch (outcome.status) {
      case "verified":
        return { ok: true, message: "Verified on Sui." } as OpResult;
      case "submitted":
        return { ok: true, message: "Submitted to Sui. Waiting for independent verification — check again in a minute." } as OpResult;
      case "pending":
        return { ok: false, message: "Sent to Sui, but the result is not confirmed yet. Check again in a minute." } as OpResult;
      case "busy":
        return { ok: false, message: "This memory is already being anchored. Check again in a minute." } as OpResult;
      case "ineligible":
        return { ok: false, message: ANCHOR_INELIGIBLE[outcome.reason] ?? NOT_FOUND.message } as OpResult;
      case "disabled":
        return { ok: false, message: "Sui anchoring is not turned on." } as OpResult;
      default:
        return { ok: false, message: "Anchoring on Sui failed. Please try again later." } as OpResult;
    }
  });
}
