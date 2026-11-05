import type { SupabaseClient } from "@supabase/supabase-js";
import type { Memory, WalrusRecord } from "../domain/types";
import type { AnchorStore } from "./anchor";
import { ANCHOR_PUBLIC_COLUMNS, type AnchorSecret, type AnchorWithSecret } from "./types";

/**
 * AnchorStore over `memory_anchors` + `memory_anchor_secrets`, using the
 * SERVICE-ROLE client. Every query is scoped by the caregiver ID taken from
 * the verified session (or the sync source), never from user input.
 */
export function supabaseAnchorStore(admin: SupabaseClient): AnchorStore {
  function fail(op: string, error: { message: string } | null): never {
    throw new Error(`memory_anchors ${op} failed: ${error?.message ?? "no row"}`);
  }

  return {
    async loadMemoryState(caregiverId, memoryId) {
      const [m, w] = await Promise.all([
        admin.from("memories").select("id, caregiver_id, elder_id").eq("id", memoryId).eq("caregiver_id", caregiverId).maybeSingle(),
        admin.from("walrus_records").select("*").eq("kind", "memory").eq("memory_id", memoryId).eq("caregiver_id", caregiverId).maybeSingle(),
      ]);
      if (m.error) fail("memory select", m.error);
      if (w.error) fail("walrus select", w.error);
      return { memory: (m.data as Memory | null) ?? null, record: (w.data as WalrusRecord | null) ?? null };
    },

    async findAnchor(caregiverId, memoryId, blobId) {
      const { data, error } = await admin
        .from("memory_anchors")
        .select(`${ANCHOR_PUBLIC_COLUMNS}, tx_bytes, tx_signature, secret:memory_anchor_secrets(anchor_id, commitment, salt, canonical_payload)`)
        .eq("caregiver_id", caregiverId)
        .eq("memory_id", memoryId)
        .eq("walrus_blob_id", blobId)
        .maybeSingle();
      if (error) fail("select", error);
      if (!data) return null;
      const row = data as unknown as AnchorWithSecret & { secret: AnchorSecret | AnchorSecret[] | null };
      const secret = Array.isArray(row.secret) ? row.secret[0] : row.secret;
      if (!secret) throw new Error("memory_anchors row has no secret");
      return { ...row, secret };
    },

    async latestVersion(caregiverId, memoryId) {
      const { data, error } = await admin
        .from("memory_anchors")
        .select("version")
        .eq("caregiver_id", caregiverId)
        .eq("memory_id", memoryId)
        .order("version", { ascending: false })
        .limit(1);
      if (error) fail("version select", error);
      return (data?.[0]?.version as number | undefined) ?? 0;
    },

    async createAnchor(r) {
      const { error } = await admin.rpc("create_memory_anchor", {
        p_caregiver_id: r.caregiverId,
        p_elder_id: r.elderId,
        p_memory_id: r.memoryId,
        p_version: r.version,
        p_walrus_blob_id: r.walrusBlobId,
        p_schema_version: r.schemaVersion,
        p_commitment: r.commitment,
        p_salt: r.salt,
        p_canonical_payload: r.canonicalPayload,
      });
      if (!error) return "created";
      if (error.code === "23505") return "conflict";
      fail("insert", error);
    },

    async claim(id, until) {
      const nowIso = new Date().toISOString();
      const { data, error } = await admin
        .from("memory_anchors")
        .update({ locked_until: until.toISOString() })
        .eq("id", id)
        .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
        .select("id");
      if (error) fail("claim", error);
      return (data?.length ?? 0) > 0;
    },

    async release(id) {
      const { error } = await admin.from("memory_anchors").update({ locked_until: null }).eq("id", id);
      if (error) fail("release", error);
    },

    async update(id, patch) {
      const { error } = await admin.from("memory_anchors").update(patch).eq("id", id);
      if (error) fail("update", error);
    },
  };
}
