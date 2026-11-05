import type { SupabaseClient } from "@supabase/supabase-js";
import type { Elder, Memory, WalrusRecord } from "../lib/domain/types";
import type { ContentTable, PhotoStore, Repo, Syncer, Tables } from "./ports";

/**
 * Data access for a PAIRED ELDER DEVICE. A device has no Supabase session, so
 * reads go through the service-role client — every query is explicitly scoped
 * to the one caregiver + elder the device was paired with — and every write
 * is refused. Ask DayMate and the elder screens reuse the normal Repo port.
 */

export class ReadOnlyError extends Error {
  constructor(op: string) {
    super(`Elder devices are read-only (${op}).`);
    this.name = "ReadOnlyError";
  }
}

const ORDER: Record<ContentTable, { column: string; ascending: boolean }> = {
  family_members: { column: "created_at", ascending: true },
  routines: { column: "time_of_day", ascending: true },
  memories: { column: "created_at", ascending: false },
};

function check<T>(op: string, res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`${op}: ${res.error.message}`);
  return res.data;
}

/** Wraps any Repo so that every write throws. */
export function readOnlyRepo(inner: Repo): Repo {
  const deny = (op: string) => async (): Promise<never> => {
    throw new ReadOnlyError(op);
  };
  return {
    getElder: () => inner.getElder(),
    list: (table, elderId) => inner.list(table, elderId),
    get: (table, id) => inner.get(table, id),
    memoriesForPerson: (id) => inner.memoriesForPerson(id),
    walrusRecords: (elderId) => inner.walrusRecords(elderId),
    memoryAnchors: async () => [], // anchoring status is caregiver-only
    insertElder: deny("insertElder"),
    updateElder: deny("updateElder"),
    insert: deny("insert"),
    update: deny("update"),
    remove: deny("remove"),
  };
}

/** Reads limited to one caregiver + elder, via the service-role client. */
export function scopedElderRepo(admin: SupabaseClient, caregiverId: string, elderId: string): Repo {
  const scoped = (table: string) => admin.from(table).select("*").eq("caregiver_id", caregiverId);
  const own = (requested: string) => requested === elderId;
  const repo: Repo = {
    async getElder() {
      return check("get elder", await scoped("elders").eq("id", elderId).maybeSingle()) as Elder | null;
    },
    async list<T extends ContentTable>(table: T, requestedElder: string) {
      if (!own(requestedElder)) return [];
      const o = ORDER[table];
      return check(`list ${table}`, await scoped(table).eq("elder_id", elderId).order(o.column, { ascending: o.ascending })) as Tables[T][];
    },
    async get<T extends ContentTable>(table: T, id: string) {
      return check(`get ${table}`, await scoped(table).eq("elder_id", elderId).eq("id", id).maybeSingle()) as Tables[T] | null;
    },
    async memoriesForPerson(personId) {
      return check("memories for person", await scoped("memories").eq("elder_id", elderId).eq("related_person_id", personId)) as Memory[];
    },
    async walrusRecords(requestedElder) {
      if (!own(requestedElder)) return [];
      return check("walrus records", await scoped("walrus_records").eq("elder_id", elderId)) as WalrusRecord[];
    },
    memoryAnchors: async () => [],
    insertElder: async () => {
      throw new ReadOnlyError("insertElder");
    },
    updateElder: async () => {
      throw new ReadOnlyError("updateElder");
    },
    insert: async () => {
      throw new ReadOnlyError("insert");
    },
    update: async () => {
      throw new ReadOnlyError("update");
    },
    remove: async () => {
      throw new ReadOnlyError("remove");
    },
  };
  return readOnlyRepo(repo);
}

/** Signed photo URLs for this caregiver's files only; uploads/removals refused. */
export function elderPhotoStore(admin: SupabaseClient, caregiverId: string): PhotoStore {
  return {
    async upload() {
      throw new ReadOnlyError("photo upload");
    },
    async remove() {
      throw new ReadOnlyError("photo remove");
    },
    async signedUrls(paths) {
      const unique = [...new Set(paths.filter((p) => typeof p === "string" && p.startsWith(`${caregiverId}/`) && !p.includes("..")))];
      if (!unique.length) return {};
      const { data, error } = await admin.storage.from("photos").createSignedUrls(unique, 60 * 60);
      if (error || !data) return {};
      const out: Record<string, string> = {};
      for (const item of data) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
      return out;
    },
  };
}

/** Elder devices never write to Walrus. */
export const noSync: Syncer = {
  async background() {
    throw new ReadOnlyError("sync");
  },
  async now() {
    throw new ReadOnlyError("sync");
  },
};

