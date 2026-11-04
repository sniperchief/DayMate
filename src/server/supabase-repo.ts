import type { SupabaseClient } from "@supabase/supabase-js";
import type { Elder, Memory, WalrusRecord } from "../lib/domain/types";
import type { ContentTable, PhotoStore, Repo, Tables } from "./ports";

const ORDER: Record<ContentTable, { column: string; ascending: boolean }> = {
  family_members: { column: "created_at", ascending: true },
  routines: { column: "time_of_day", ascending: true },
  memories: { column: "created_at", ascending: false },
};

function check<T>(op: string, res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw new Error(`${op}: ${res.error.message}${res.error.code ? ` (${res.error.code})` : ""}`);
  return res.data;
}

/** Repo over the caregiver's own session — RLS filters every query. */
export function supabaseRepo(db: SupabaseClient): Repo {
  return {
    async getElder() {
      return check("get elder", await db.from("elders").select("*").maybeSingle()) as Elder | null;
    },
    async insertElder(row) {
      return check("insert elder", await db.from("elders").insert(row).select("*").single()) as Elder;
    },
    async updateElder(id, patch) {
      return check("update elder", await db.from("elders").update(patch).eq("id", id).select("*").maybeSingle()) as Elder | null;
    },
    async list<T extends ContentTable>(table: T, elderId: string) {
      const o = ORDER[table];
      return check(`list ${table}`, await db.from(table).select("*").eq("elder_id", elderId).order(o.column, { ascending: o.ascending })) as Tables[T][];
    },
    async get<T extends ContentTable>(table: T, id: string) {
      return check(`get ${table}`, await db.from(table).select("*").eq("id", id).maybeSingle()) as Tables[T] | null;
    },
    async insert<T extends ContentTable>(table: T, row: Partial<Tables[T]>) {
      return check(`insert ${table}`, await db.from(table).insert(row as Record<string, unknown>).select("*").single()) as Tables[T];
    },
    async update<T extends ContentTable>(table: T, id: string, patch: Partial<Tables[T]>) {
      return check(`update ${table}`, await db.from(table).update(patch as Record<string, unknown>).eq("id", id).select("*").maybeSingle()) as Tables[T] | null;
    },
    async remove(table, id) {
      const data = check(`delete ${table}`, await db.from(table).delete().eq("id", id).select("id"));
      return (data?.length ?? 0) > 0;
    },
    async memoriesForPerson(personId) {
      return check("memories for person", await db.from("memories").select("*").eq("related_person_id", personId)) as Memory[];
    },
    async walrusRecords(elderId) {
      return check("walrus records", await db.from("walrus_records").select("*").eq("elder_id", elderId)) as WalrusRecord[];
    },
  };
}

const BUCKET = "photos";

/** Private bucket; storage RLS limits each caregiver to "<uid>/..." paths. */
export function supabasePhotoStore(db: SupabaseClient): PhotoStore {
  return {
    async upload(path, file) {
      const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(`photo upload: ${error.message}`);
    },
    async remove(paths) {
      if (!paths.length) return;
      const { error } = await db.storage.from(BUCKET).remove(paths);
      if (error) throw new Error(`photo remove: ${error.message}`);
    },
    async signedUrls(paths) {
      const unique = [...new Set(paths.filter(Boolean))];
      if (!unique.length) return {};
      const { data, error } = await db.storage.from(BUCKET).createSignedUrls(unique, 60 * 60);
      if (error || !data) return {};
      const out: Record<string, string> = {};
      for (const item of data) if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
      return out;
    },
  };
}
