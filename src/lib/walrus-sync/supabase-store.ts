import type { SupabaseClient } from "@supabase/supabase-js";
import type { WalrusRecord } from "../domain/types";
import type { SyncSource, SyncStore } from "./sync";

const SOURCE_COLUMN = { family_member: "family_member_id", routine: "routine_id", memory: "memory_id" } as const;

/**
 * SyncStore backed by `walrus_records`, using the SERVICE-ROLE client (RLS
 * bypassed). Every query is explicitly scoped by caregiver_id/elder_id taken
 * from the verified session, never from user input.
 */
export function supabaseSyncStore(admin: SupabaseClient): SyncStore {
  const table = () => admin.from("walrus_records");

  function fail(op: string, error: { message: string } | null): never {
    throw new Error(`walrus_records ${op} failed: ${error?.message ?? "no row"}`);
  }

  async function conditionalUpdate(id: string, hash: string, patch: Record<string, unknown>): Promise<boolean> {
    const { data, error } = await table().update(patch).eq("id", id).eq("content_hash", hash).select("id");
    if (error) fail("update", error);
    return (data?.length ?? 0) > 0;
  }

  return {
    async find(source) {
      let q = table().select("*").eq("caregiver_id", source.caregiverId).eq("elder_id", source.elderId).eq("kind", source.kind);
      q = source.kind === "profile" ? q : q.eq(SOURCE_COLUMN[source.kind], source.sourceId!);
      const { data, error } = await q.maybeSingle();
      if (error) fail("select", error);
      return (data as WalrusRecord | null) ?? null;
    },

    async insertPending(source: SyncSource, namespace: string, hash: string) {
      const row: Record<string, unknown> = {
        caregiver_id: source.caregiverId,
        elder_id: source.elderId,
        kind: source.kind,
        namespace,
        content_hash: hash,
        status: "pending",
        attempts: 1,
      };
      if (source.kind !== "profile") row[SOURCE_COLUMN[source.kind]] = source.sourceId;
      const { data, error } = await table().insert(row).select("*").single();
      if (error || !data) fail("insert", error);
      return data as WalrusRecord;
    },

    async resetPending(id, hash, attempts, keepJobId) {
      const patch: Record<string, unknown> = { content_hash: hash, status: "pending", error: null, attempts, stored_at: null };
      if (!keepJobId) patch.job_id = null;
      const { data, error } = await table().update(patch).eq("id", id).select("*").single();
      if (error || !data) fail("reset", error);
      return data as WalrusRecord;
    },

    async markStored(id, hash, write) {
      const { data: current, error } = await table().select("blob_id, previous_blob_ids").eq("id", id).maybeSingle();
      if (error) fail("select", error);
      if (!current) return false;
      const previous = new Set<string>((current.previous_blob_ids as string[]) ?? []);
      if (current.blob_id && current.blob_id !== write.blobId) previous.add(current.blob_id);
      previous.delete(write.blobId);
      return conditionalUpdate(id, hash, {
        status: "stored",
        job_id: write.jobId,
        blob_id: write.blobId,
        previous_blob_ids: [...previous],
        error: null,
        stored_at: new Date().toISOString(),
      });
    },

    markPendingJob: (id, hash, jobId, note) => conditionalUpdate(id, hash, { status: "pending", job_id: jobId, error: note }),

    markFailed: (id, hash, error, jobId) => conditionalUpdate(id, hash, { status: "failed", error, ...(jobId ? { job_id: jobId } : {}) }),

    async appendPreviousBlob(id, blobId) {
      const { data, error } = await table().select("blob_id, previous_blob_ids").eq("id", id).maybeSingle();
      if (error) fail("select", error);
      if (!data) return; // source deleted meanwhile; nothing to attach to
      const previous = (data.previous_blob_ids as string[]) ?? [];
      if (data.blob_id === blobId || previous.includes(blobId)) return;
      const upd = await table().update({ previous_blob_ids: [...previous, blobId] }).eq("id", id);
      if (upd.error) fail("update", upd.error);
    },

    async remove(id) {
      const { error } = await table().delete().eq("id", id);
      if (error) fail("delete", error);
    },
  };
}
