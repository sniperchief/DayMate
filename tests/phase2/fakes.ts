/**
 * MOCKS / IN-MEMORY FAKES — FOR ISOLATED UNIT TESTS ONLY.
 * Nothing here talks to Supabase or Walrus. The fake repo imitates the
 * owner-only RLS rules so application logic can be tested; real RLS is
 * verified separately against Supabase (`npm run app:rls-check`).
 */
import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import type { Elder, Memory, WalrusRecord } from "../../src/lib/domain/types";
import type { ConfirmedWrite } from "../../src/lib/memory";
import { performWrite, prepareSync, type MemoryWriter, type SyncSource, type SyncStore } from "../../src/lib/walrus-sync/sync";
import type { ContentTable, Ctx, PhotoStore, RecallHit, Recaller, Repo, Syncer, Tables } from "../../src/server/ports";
import { keywords, normalize, stem, words } from "../../src/lib/ask/router";

export interface FakeDb {
  elders: Elder[];
  family_members: Tables["family_members"][];
  routines: Tables["routines"][];
  memories: Tables["memories"][];
  walrus: WalrusRecord[];
}

export function fakeDb(): FakeDb {
  return { elders: [], family_members: [], routines: [], memories: [], walrus: [] };
}

const stamp = () => new Date().toISOString();

/** [mock] Repo for one caregiver; rows of other caregivers are invisible, like RLS. */
export function fakeRepo(db: FakeDb, userId: string): Repo {
  const own = <T extends { caregiver_id: string }>(rows: T[]) => rows.filter((r) => r.caregiver_id === userId);
  return {
    async getElder() {
      return own(db.elders)[0] ?? null;
    },
    async insertElder(row) {
      if (own(db.elders).length) throw new Error("elders_one_per_caregiver");
      const elder: Elder = { ...row, id: randomUUID(), caregiver_id: userId, created_at: stamp(), updated_at: stamp() };
      db.elders.push(elder);
      return elder;
    },
    async updateElder(id, patch) {
      const e = own(db.elders).find((x) => x.id === id);
      if (!e) return null;
      Object.assign(e, patch, { updated_at: stamp() });
      return { ...e };
    },
    async list<T extends ContentTable>(table: T, elderId: string) {
      return own(db[table] as Tables[T][]).filter((r) => r.elder_id === elderId).map((r) => ({ ...r }));
    },
    async get<T extends ContentTable>(table: T, id: string) {
      const r = own(db[table] as Tables[T][]).find((x) => x.id === id);
      return r ? { ...r } : null;
    },
    async insert<T extends ContentTable>(table: T, row: Partial<Tables[T]>) {
      // composite FK (elder_id, caregiver_id) → elders
      if (!db.elders.some((e) => e.id === row.elder_id && e.caregiver_id === userId)) throw new Error("violates foreign key elder");
      const full = { description: "", ...row, id: randomUUID(), caregiver_id: userId, created_at: stamp(), updated_at: stamp() } as Tables[T];
      (db[table] as Tables[T][]).push(full);
      return { ...full };
    },
    async update<T extends ContentTable>(table: T, id: string, patch: Partial<Tables[T]>) {
      const r = own(db[table] as Tables[T][]).find((x) => x.id === id);
      if (!r) return null;
      Object.assign(r, patch, { updated_at: stamp() });
      return { ...r };
    },
    async remove(table, id) {
      const rows = db[table] as { id: string; caregiver_id: string }[];
      const i = rows.findIndex((x) => x.id === id && x.caregiver_id === userId);
      if (i < 0) return false;
      rows.splice(i, 1);
      if (table === "family_members") for (const m of db.memories) if (m.related_person_id === id) m.related_person_id = null;
      const col = { family_members: "family_member_id", routines: "routine_id", memories: "memory_id" }[table] as keyof WalrusRecord;
      db.walrus = db.walrus.filter((w) => w[col] !== id);
      return true;
    },
    async memoriesForPerson(personId) {
      return own(db.memories).filter((m) => m.related_person_id === personId) as Memory[];
    },
    async walrusRecords(elderId) {
      return own(db.walrus).filter((w) => w.elder_id === elderId);
    },
    async memoryAnchors() {
      return []; // Phase 3B anchors are tested with their own fakes (tests/phase3b)
    },
  };
}

/** [mock] SyncStore over the fake db's walrus table. */
export function fakeSyncStore(db: FakeDb): SyncStore {
  const col = { family_member: "family_member_id", routine: "routine_id", memory: "memory_id" } as const;
  const byId = (id: string) => db.walrus.find((w) => w.id === id)!;
  const cond = (id: string, hash: string, patch: Partial<WalrusRecord>) => {
    const r = db.walrus.find((w) => w.id === id && w.content_hash === hash);
    if (!r) return false;
    Object.assign(r, patch, { updated_at: stamp() });
    return true;
  };
  return {
    async find(s) {
      return (
        db.walrus.find((w) => w.caregiver_id === s.caregiverId && w.elder_id === s.elderId && w.kind === s.kind && (s.kind === "profile" || w[col[s.kind]] === s.sourceId)) ?? null
      );
    },
    async insertPending(s, namespace, hash) {
      const r: WalrusRecord = {
        id: randomUUID(),
        caregiver_id: s.caregiverId,
        elder_id: s.elderId,
        kind: s.kind,
        family_member_id: s.kind === "family_member" ? s.sourceId : null,
        routine_id: s.kind === "routine" ? s.sourceId : null,
        memory_id: s.kind === "memory" ? s.sourceId : null,
        namespace,
        content_hash: hash,
        status: "pending",
        job_id: null,
        blob_id: null,
        previous_blob_ids: [],
        error: null,
        attempts: 1,
        stored_at: null,
        created_at: stamp(),
        updated_at: stamp(),
      };
      db.walrus.push(r);
      return { ...r };
    },
    async resetPending(id, hash, attempts, keepJobId) {
      const r = byId(id);
      Object.assign(r, { content_hash: hash, status: "pending", error: null, attempts, stored_at: null, updated_at: stamp() }, keepJobId ? {} : { job_id: null });
      return { ...r };
    },
    async markStored(id, hash, w) {
      const r = db.walrus.find((x) => x.id === id);
      if (!r) return false;
      const previous = new Set(r.previous_blob_ids);
      if (r.blob_id && r.blob_id !== w.blobId) previous.add(r.blob_id);
      previous.delete(w.blobId);
      return cond(id, hash, { status: "stored", job_id: w.jobId, blob_id: w.blobId, previous_blob_ids: [...previous], error: null, stored_at: stamp() });
    },
    async markPendingJob(id, hash, jobId, note) {
      return cond(id, hash, { status: "pending", job_id: jobId, error: note });
    },
    async markFailed(id, hash, error, jobId) {
      return cond(id, hash, { status: "failed", error, ...(jobId ? { job_id: jobId } : {}) });
    },
    async appendPreviousBlob(id, blobId) {
      const r = db.walrus.find((w) => w.id === id);
      if (r && r.blob_id !== blobId && !r.previous_blob_ids.includes(blobId)) r.previous_blob_ids = [...r.previous_blob_ids, blobId];
    },
    async remove(id) {
      db.walrus = db.walrus.filter((w) => w.id !== id);
    },
  };
}

/** [mock] Walrus writer: returns MOCK blob IDs; never touches Mainnet. */
export function mockWriter(impl?: (text: string, namespace: string) => Promise<ConfirmedWrite>) {
  let n = 0;
  const rememberConfirmed = vi.fn(
    impl
      ? (text: string, opts: { namespace: string }) => impl(text, opts.namespace)
      : async (_text: string, opts: { namespace: string }): Promise<ConfirmedWrite> => {
          n++;
          return { status: "done", jobId: `MOCK_JOB_${n}`, blobId: `MOCK_BLOB_${n}`, memoryId: `m${n}`, owner: "0xMOCK", namespace: opts.namespace };
        },
  );
  const confirmWrite = vi.fn<MemoryWriter["confirmWrite"]>();
  return { rememberConfirmed, confirmWrite } satisfies MemoryWriter;
}

/** [mock] Syncer that runs the real prepare/perform logic synchronously against fakes. */
export function fakeSyncer(store: SyncStore, writer: MemoryWriter): Syncer & { sources: SyncSource[] } {
  const sources: SyncSource[] = [];
  return {
    sources,
    async background(source) {
      sources.push(source);
      const p = await prepareSync(store, source);
      if (p.action === "write") await performWrite(store, writer, p);
    },
    async now(source) {
      sources.push(source);
      const p = await prepareSync(store, source, { force: true });
      if (p.action === "skip") return { status: "skipped", reason: p.reason };
      if (p.action === "removed") return { status: "skipped", reason: "not-applicable" };
      return performWrite(store, writer, p);
    },
  };
}

export function fakePhotos(): PhotoStore & { files: Map<string, File> } {
  const files = new Map<string, File>();
  return {
    files,
    async upload(path, file) {
      files.set(path, file);
    },
    async remove(paths) {
      for (const p of paths) files.delete(p);
    },
    async signedUrls() {
      return {};
    },
  };
}

/**
 * [mock] In-memory stand-in for Walrus Memory. Like the real service it keeps
 * EVERY blob ever written (edits and deletes leave old blobs behind), so the
 * Ask DayMate filtering is tested against realistic stale data. Its "semantic"
 * distance is a deterministic keyword-overlap heuristic — not real embeddings.
 */
export interface FakeWalrus {
  blobs: { namespace: string; blobId: string; text: string }[];
  /** Extra hits returned for every recall (e.g. to simulate foreign or forged blobs). */
  injected: RecallHit[];
  recallCalls: { query: string; namespace: string; limit: number }[];
  failRecall?: boolean;
  /** Return no hits for this many calls (simulates a transient empty relayer response). */
  emptyCalls?: number;
}

export function fakeWalrus(): FakeWalrus {
  return { blobs: [], injected: [], recallCalls: [] };
}

function fakeDistance(query: string, text: string): number {
  const q = new Set(keywords(query));
  if (!q.size) return 0.9;
  const t = new Set(words(normalize(text)).map(stem));
  const shared = [...q].filter((k) => t.has(k)).length;
  return Math.round((0.85 - 0.5 * (shared / q.size)) * 1000) / 1000;
}

export function walrusWriter(walrus: FakeWalrus): MemoryWriter {
  return {
    rememberConfirmed: async (text, opts) => {
      // relayer-side dedupe: identical text in a namespace resolves to the existing blob
      const existing = walrus.blobs.find((b) => b.namespace === opts.namespace && b.text === text);
      const blobId = existing?.blobId ?? `FAKE_WALRUS_BLOB_${walrus.blobs.length + 1}`;
      if (!existing) walrus.blobs.push({ namespace: opts.namespace, blobId, text });
      return { status: "done", jobId: `FAKE_JOB_${blobId}`, blobId, memoryId: blobId, owner: "0xMOCK", namespace: opts.namespace };
    },
    confirmWrite: async () => {
      throw new Error("not used");
    },
  };
}

export function fakeRecaller(walrus: FakeWalrus): Recaller {
  return {
    async recall(query, { namespace, limit }) {
      walrus.recallCalls.push({ query, namespace, limit });
      if (walrus.failRecall) throw new Error("relayer unavailable (mock)");
      if (walrus.emptyCalls) {
        walrus.emptyCalls--;
        return [];
      }
      const own = walrus.blobs.filter((b) => b.namespace === namespace).map((b) => ({ text: b.text, blobId: b.blobId, distance: fakeDistance(query, b.text) }));
      return [...own, ...walrus.injected].sort((a, b) => a.distance - b.distance).slice(0, limit);
    },
  };
}

export function fakeCtx(
  db: FakeDb,
  userId: string,
  writer: MemoryWriter = mockWriter(),
  walrus: FakeWalrus = fakeWalrus(),
): Ctx & { writer: ReturnType<typeof mockWriter>; syncer: ReturnType<typeof fakeSyncer>; photos: ReturnType<typeof fakePhotos>; walrus: FakeWalrus } {
  const syncer = fakeSyncer(fakeSyncStore(db), writer);
  const photos = fakePhotos();
  return { userId, repo: fakeRepo(db, userId), photos, sync: syncer, recall: fakeRecaller(walrus), writer: writer as ReturnType<typeof mockWriter>, syncer, walrus };
}
