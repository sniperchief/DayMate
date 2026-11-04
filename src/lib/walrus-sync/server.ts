import "server-only";
import { after } from "next/server";
import { MemoryService } from "../memory";
import { adminClient } from "../supabase/admin";
import { performWrite, prepareSync, type MemoryWriter, type SyncSource } from "./sync";
import { supabaseSyncStore } from "./supabase-store";
import type { Recaller, Syncer } from "../../server/ports";

/**
 * Production wiring: reuses the Phase 1 MemoryService (one instance per
 * server process) — no second Walrus client or integration.
 */
let service: MemoryService | undefined;

/** The one MemoryService (and SDK client) for this server process. */
function memoryService(): MemoryService {
  service ??= MemoryService.fromEnv(process.env);
  return service;
}

function memoryWriter(): MemoryWriter {
  return {
    rememberConfirmed: (text, opts) => memoryService().rememberConfirmed(text, opts),
    confirmWrite: (jobId, timeoutMs, namespace) => memoryService().confirmWrite(jobId, timeoutMs, namespace),
  };
}

/** Recall through the same MemoryService used for writes. */
export const walrusRecaller: Recaller = {
  async recall(query, { namespace, limit }) {
    const outcome = await memoryService().recall(query, { namespace, limit });
    return outcome.results.map((r) => ({ text: r.text, blobId: r.blobId, distance: r.distance }));
  },
};

function log(source: SyncSource, status: string, extra = ""): void {
  console.info(`[daymate] walrus ${source.kind}${source.sourceId ? `:${source.sourceId}` : ""} → ${status}${extra}`);
}

export const walrusSyncer: Syncer = {
  async background(source) {
    const store = supabaseSyncStore(adminClient());
    const prepared = await prepareSync(store, source);
    if (prepared.action !== "write") return;
    after(async () => {
      const outcome = await performWrite(store, memoryWriter(), prepared);
      log(source, outcome.status, outcome.blobId ? ` blob=${outcome.blobId}` : outcome.error ? ` (${outcome.error})` : "");
    });
  },

  async now(source) {
    const store = supabaseSyncStore(adminClient());
    const prepared = await prepareSync(store, source, { force: true });
    if (prepared.action === "skip") return { status: "skipped", reason: prepared.reason };
    if (prepared.action === "removed") return { status: "skipped", reason: "not-applicable" };
    const outcome = await performWrite(store, memoryWriter(), prepared);
    log(source, outcome.status, outcome.blobId ? ` blob=${outcome.blobId}` : "");
    return outcome;
  },
};
