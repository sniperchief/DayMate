import type { WalrusKind, WalrusRecord } from "@/lib/domain/types";
import { IN_FLIGHT_GRACE_MS } from "@/lib/walrus-sync/sync";
import { retryWalrusAction } from "@/app/(app)/actions";
import { RetryButton } from "./bits";

export function Avatar({ name, url, large = false }: { name: string; url?: string | null; large?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className={`avatar${large ? " avatar-lg" : ""}`} />;
  }
  return (
    <span className={`avatar${large ? " avatar-lg" : ""}`} aria-hidden="true">
      {initials || "?"}
    </span>
  );
}

const NOTICES: Record<string, { kind: "success" | "error" | "info"; text: string }> = {
  updated: { kind: "success", text: "Changes saved." },
  removed: { kind: "success", text: "Removed." },
  error: { kind: "error", text: "Something went wrong. Please try again." },
  "need-profile": { kind: "info", text: "Start by creating the profile of the person you care for." },
  "confirm-failed": { kind: "error", text: "That confirmation link didn't work or has expired. Please sign in or register again." },
};

/** Fixed messages selected by a ?notice= code (never renders arbitrary query text). */
export function Notice({ code }: { code?: string | string[] }) {
  const n = typeof code === "string" ? NOTICES[code] : undefined;
  if (!n) return null;
  return (
    <div role={n.kind === "error" ? "alert" : "status"} className={`alert alert-${n.kind}`} style={{ marginBottom: "1.25rem" }}>
      {n.text}
    </div>
  );
}

/** Two-step delete without JavaScript. */
export function ConfirmDelete({ action, label, question }: { action: () => Promise<void>; label: string; question: string }) {
  return (
    <details className="confirm">
      <summary className="btn btn-secondary btn-small">{label}</summary>
      <form action={action} className="confirm-box">
        <span>{question}</span>
        <button type="submit" className="btn btn-danger btn-small">
          Yes, remove
        </button>
      </form>
    </details>
  );
}

/**
 * Walrus status for one record. "Stored" appears only when the server
 * recorded an SDK-confirmed write with a blob ID.
 */
export function WalrusStatus({
  record,
  kind,
  sourceId,
  expected = true,
  now,
}: {
  record?: WalrusRecord;
  kind: WalrusKind;
  sourceId: string;
  /** Whether this item should have a Walrus memory at all (e.g. paused routines do not). */
  expected?: boolean;
  now: number;
}) {
  const retry = retryWalrusAction.bind(null, kind, sourceId);
  if (!expected && !record) {
    return (
      <div className="walrus">
        <span className="badge badge-none">Not saved to Walrus while paused</span>
      </div>
    );
  }
  if (!record) {
    return (
      <div className="walrus">
        <span className="badge badge-none">Saved · not on Walrus yet</span>
        <RetryButton action={retry} label="Save to Walrus" />
      </div>
    );
  }
  if (record.status === "stored") {
    return (
      <div className="walrus">
        <span className="badge badge-stored">✓ Stored on Walrus</span>
        <span className="blob-id" title="Walrus blob ID">
          blob {record.blob_id}
        </span>
      </div>
    );
  }
  const stale = now - new Date(record.updated_at).getTime() > IN_FLIGHT_GRACE_MS;
  if (record.status === "pending" && !stale) {
    return (
      <div className="walrus">
        <span className="badge badge-pending" role="status">
          Saving to Walrus…
        </span>
        <span className="muted">Saved in DayMate. Waiting for Walrus to confirm.</span>
      </div>
    );
  }
  return (
    <div className="walrus">
      <span className="badge badge-failed">{record.status === "failed" ? "Walrus save failed" : "Walrus save not confirmed"}</span>
      <span className="muted">Saved in DayMate, but not confirmed on Walrus.</span>
      <RetryButton action={retry} />
    </div>
  );
}

export function walrusIndex(records: WalrusRecord[]): Map<string, WalrusRecord> {
  const map = new Map<string, WalrusRecord>();
  for (const r of records) {
    const key = r.kind === "profile" ? "profile" : (r.family_member_id ?? r.routine_id ?? r.memory_id)!;
    map.set(key, r);
  }
  return map;
}

export function hasRecentPending(records: WalrusRecord[], now: number): boolean {
  return records.some((r) => r.status === "pending" && now - new Date(r.updated_at).getTime() < IN_FLIGHT_GRACE_MS);
}
