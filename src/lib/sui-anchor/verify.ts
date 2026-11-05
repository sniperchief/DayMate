import { normalizeSuiAddress } from "@mysten/sui/utils";
import { EVENT_MODULE, EVENT_STRUCT, MemoryCommittedBcs, toHex } from "./commitment";

/**
 * Independent verification of an anchor transaction. The transport (Tatum in
 * production) is behind `TransactionSource`, so it can be swapped without
 * touching this logic. A successful HTTP/RPC response is never treated as
 * verification by itself: every field below is checked.
 */

export interface FetchedEvent {
  packageId: string;
  /** Module of the Move call that emitted the event. */
  module: string;
  sender: string;
  /** Fully-qualified type `<package>::<module>::<Struct>`. */
  eventType: string;
  bcs: Uint8Array;
}

export interface FetchedTransaction {
  digest: string;
  success: boolean;
  error: string | null;
  events: FetchedEvent[];
}

export type SourceErrorKind = "rate-limited" | "timeout" | "rpc" | "auth" | "malformed";

export class SourceError extends Error {
  constructor(
    readonly kind: SourceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

export interface TransactionSource {
  /** Provider label recorded with the verification (e.g. "tatum"). */
  readonly name: string;
  /** null when the provider says the transaction does not exist (yet). Throws SourceError otherwise. */
  getTransaction(digest: string): Promise<FetchedTransaction | null>;
}

export interface ExpectedAnchor {
  digest: string;
  packageId: string;
  sender: string;
  commitmentHex: string;
  schemaVersion: number;
}

export type VerifyFailure =
  | "not-found"
  | "digest-mismatch"
  | "execution-failed"
  | "event-missing"
  | "wrong-package"
  | "wrong-sender"
  | "commitment-mismatch"
  | "schema-mismatch"
  | "malformed-event"
  | SourceErrorKind;

export type VerifyResult = { ok: true; provider: string } | { ok: false; reason: VerifyFailure; retryable: boolean; provider: string };

/** Lookup gaps and transport problems are retryable; mismatches are definitive. */
const RETRYABLE = new Set<VerifyFailure>(["not-found", "rate-limited", "timeout", "rpc", "auth", "malformed"]);

export async function verifyAnchorTransaction(source: TransactionSource, expected: ExpectedAnchor): Promise<VerifyResult> {
  const fail = (reason: VerifyFailure): VerifyResult => ({ ok: false, reason, retryable: RETRYABLE.has(reason), provider: source.name });

  let tx: FetchedTransaction | null;
  try {
    tx = await source.getTransaction(expected.digest);
  } catch (err) {
    return fail(err instanceof SourceError ? err.kind : "rpc");
  }
  if (!tx) return fail("not-found");
  if (typeof tx.digest !== "string" || typeof tx.success !== "boolean" || !Array.isArray(tx.events)) return fail("malformed");
  if (tx.digest !== expected.digest) return fail("digest-mismatch");
  if (!tx.success) return fail("execution-failed");

  const pkg = normalizeSuiAddress(expected.packageId);
  const wantedType = `${pkg}::${EVENT_MODULE}::${EVENT_STRUCT}`;
  const ours = tx.events.filter((e) => typeof e?.eventType === "string" && normalizeType(e.eventType) === wantedType);
  if (!ours.length) {
    // Same struct name from another package is an impostor, not our event.
    const lookalike = tx.events.some((e) => typeof e?.eventType === "string" && e.eventType.endsWith(`::${EVENT_MODULE}::${EVENT_STRUCT}`));
    return fail(lookalike ? "wrong-package" : "event-missing");
  }
  if (ours.length !== 1) return fail("malformed-event");
  const ev = ours[0]!;
  if (normalizeSuiAddress(ev.packageId) !== pkg || ev.module !== EVENT_MODULE) return fail("wrong-package");
  if (normalizeSuiAddress(ev.sender) !== normalizeSuiAddress(expected.sender)) return fail("wrong-sender");

  let decoded: { commitment: number[]; schema_version: number };
  try {
    if (!(ev.bcs instanceof Uint8Array)) throw new Error("no bcs");
    decoded = MemoryCommittedBcs.parse(ev.bcs);
    // reject trailing bytes: re-serialisation must match exactly
    if (toHex(MemoryCommittedBcs.serialize(decoded).toBytes()) !== toHex(ev.bcs)) throw new Error("trailing bytes");
  } catch {
    return fail("malformed-event");
  }
  if (toHex(Uint8Array.from(decoded.commitment)) !== expected.commitmentHex.toLowerCase()) return fail("commitment-mismatch");
  if (decoded.schema_version !== expected.schemaVersion) return fail("schema-mismatch");
  return { ok: true, provider: source.name };
}

/** Normalise the address part of `<addr>::<module>::<name>`. */
function normalizeType(t: string): string {
  const [addr, ...rest] = t.split("::");
  return rest.length === 2 && addr ? `${normalizeSuiAddress(addr)}::${rest.join("::")}` : t;
}
