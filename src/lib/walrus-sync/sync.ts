import { MemoryServiceError, toMemoryError, type ConfirmedWrite } from "../memory";
import type { WalrusKind, WalrusRecord, WalrusStatus } from "../domain/types";
import { contentHash, elderNamespace } from "./text";

/**
 * Keeps one Walrus memory per DayMate source record, tracked in the
 * `walrus_records` table. Postgres is authoritative for structured data; a
 * record is marked `stored` only after the Walrus SDK confirms the write is
 * `done` and returns a blob ID.
 *
 * Duplicate prevention:
 *  - unchanged text (same content hash, already stored) is never rewritten;
 *  - identical text in the namespace is collapsed by the relayer (`dedupe`);
 *  - edits point the record at the new blob and keep the old one in
 *    `previous_blob_ids` (Walrus blobs cannot be edited in place).
 */

export interface SyncSource {
  caregiverId: string;
  elderId: string;
  kind: WalrusKind;
  /** ID of the family member / routine / memory; null for the profile. */
  sourceId: string | null;
  /** Text to store, or null when the record should not be on Walrus. */
  text: string | null;
}

export interface SyncStore {
  find(source: Pick<SyncSource, "caregiverId" | "elderId" | "kind" | "sourceId">): Promise<WalrusRecord | null>;
  insertPending(source: SyncSource, namespace: string, hash: string): Promise<WalrusRecord>;
  /** Reset to pending for `hash`. Keeps job_id only when `keepJobId`. */
  resetPending(id: string, hash: string, attempts: number, keepJobId: boolean): Promise<WalrusRecord>;
  /**
   * Each mark* applies only while the row still has `hash`; returns false if superseded.
   * markStored moves the row's current blob (if different) into previous_blob_ids,
   * merging with the row's current list (never a stale snapshot).
   */
  markStored(id: string, hash: string, write: ConfirmedWrite): Promise<boolean>;
  markPendingJob(id: string, hash: string, jobId: string, note: string): Promise<boolean>;
  markFailed(id: string, hash: string, error: string, jobId: string | null): Promise<boolean>;
  /** Record a blob written for content that was superseded before it could be marked stored. */
  appendPreviousBlob(id: string, blobId: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface MemoryWriter {
  rememberConfirmed(text: string, opts: { dedupe: boolean; namespace: string }): Promise<ConfirmedWrite>;
  confirmWrite(jobId: string, timeoutMs: number | undefined, namespace: string): Promise<ConfirmedWrite>;
}

/** A pending write older than this is considered abandoned and may be retried. */
export const IN_FLIGHT_GRACE_MS = 3 * 60_000;

export type Prepared =
  | { action: "skip"; reason: "unchanged" | "in-flight" | "not-applicable"; record: WalrusRecord | null }
  | { action: "removed" }
  | { action: "write"; record: WalrusRecord; text: string; hash: string; resumeJobId: string | null };

export interface SyncOutcome {
  status: WalrusStatus | "superseded";
  jobId?: string;
  blobId?: string;
  error?: string;
}

/**
 * Decide whether a write is needed and, if so, mark the record `pending`
 * (synchronously, so the UI shows it immediately).
 */
export async function prepareSync(store: SyncStore, source: SyncSource, { force = false, now = Date.now() } = {}): Promise<Prepared> {
  const existing = await store.find(source);

  if (source.text === null || !source.text.trim()) {
    if (existing) {
      await store.remove(existing.id);
      return { action: "removed" };
    }
    return { action: "skip", reason: "not-applicable", record: null };
  }

  const text = source.text.trim();
  const hash = contentHash(text);

  if (existing && existing.content_hash === hash) {
    if (existing.status === "stored") return { action: "skip", reason: "unchanged", record: existing };
    const age = now - new Date(existing.updated_at).getTime();
    if (existing.status === "pending" && age < IN_FLIGHT_GRACE_MS && !force) return { action: "skip", reason: "in-flight", record: existing };
  }

  if (!existing) {
    const record = await store.insertPending(source, elderNamespace(source.elderId), hash);
    return { action: "write", record, text, hash, resumeJobId: null };
  }

  const sameContent = existing.content_hash === hash;
  const resumeJobId = sameContent && existing.status !== "stored" ? existing.job_id : null;
  const record = await store.resetPending(existing.id, hash, existing.attempts + 1, resumeJobId !== null);
  return { action: "write", record, text, hash, resumeJobId };
}

/** Perform the Walrus write for a prepared record and persist the result. */
export async function performWrite(store: SyncStore, writer: MemoryWriter, prepared: Extract<Prepared, { action: "write" }>): Promise<SyncOutcome> {
  const { record, text, hash, resumeJobId } = prepared;
  const namespace = record.namespace;

  try {
    let write: ConfirmedWrite | undefined;
    if (resumeJobId) {
      try {
        write = await writer.confirmWrite(resumeJobId, undefined, namespace);
      } catch (err) {
        const e = toMemoryError(err, "resume write");
        if (e.code !== "JOB_NOT_FOUND" && e.code !== "WRITE_FAILED") throw e;
      }
    }
    write ??= await writer.rememberConfirmed(text, { dedupe: true, namespace });

    const applied = await store.markStored(record.id, hash, write);
    if (applied) return { status: "stored", jobId: write.jobId, blobId: write.blobId };
    // The item was edited while this write ran. The blob exists on Walrus, so keep
    // track of it as superseded rather than losing it.
    await store.appendPreviousBlob(record.id, write.blobId);
    return { status: "superseded", jobId: write.jobId, blobId: write.blobId };
  } catch (err) {
    const e = err instanceof MemoryServiceError ? err : toMemoryError(err, "Walrus write");
    if (e.code === "WRITE_PENDING" && e.details.jobId) {
      const note = "Walrus is still processing this write. It is not confirmed yet.";
      const applied = await store.markPendingJob(record.id, hash, e.details.jobId, note);
      return applied ? { status: "pending", jobId: e.details.jobId, error: note } : { status: "superseded" };
    }
    const message = e.toSafeString().slice(0, 1000);
    const applied = await store.markFailed(record.id, hash, message, e.details.jobId ?? null);
    return applied ? { status: "failed", jobId: e.details.jobId, error: message } : { status: "superseded" };
  }
}
