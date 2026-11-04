import {
  MemWalCompatibilityError,
  MemWalRateLimitedError,
  MemWalRememberJobFailedError,
  MemWalRememberJobNotFoundError,
  MemWalRememberJobTimeoutError,
  isTimeoutError,
} from "@mysten-incubation/memwal";

export type MemoryErrorCode =
  | "CONFIG_MISSING"
  | "CONFIG_INVALID"
  | "NOT_MAINNET"
  | "RELAYER_UNAVAILABLE"
  | "AUTH_REJECTED"
  | "SDK_INCOMPATIBLE"
  | "RATE_LIMITED"
  | "WRITES_PAUSED"
  | "WRITE_FAILED"
  | "WRITE_PENDING"
  | "WRITE_UNCONFIRMED"
  | "JOB_NOT_FOUND"
  | "TIMEOUT"
  | "INVALID_INPUT"
  | "UNKNOWN";

export interface MemoryErrorDetails {
  jobId?: string;
  lastStatus?: string;
  httpStatus?: number;
  retryAfterSeconds?: number;
}

/**
 * The only error type the DayMate memory service throws. Every code comes
 * with an actionable hint. Messages never include credential material.
 */
export class MemoryServiceError extends Error {
  readonly code: MemoryErrorCode;
  readonly hint: string;
  readonly details: MemoryErrorDetails;

  constructor(code: MemoryErrorCode, message: string, hint: string, details: MemoryErrorDetails = {}) {
    super(message);
    this.name = "MemoryServiceError";
    this.code = code;
    this.hint = hint;
    this.details = details;
  }

  /** Safe, log-friendly single-line description. */
  toSafeString(): string {
    const extra = Object.entries(this.details)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    return `[${this.code}] ${this.message}${extra ? ` (${extra})` : ""} — ${this.hint}`;
  }
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function networkCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur && typeof cur === "object"; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Remove any occurrence of secret strings from a message. Used as a last line
 * of defence so an upstream error can never echo the delegate key into logs.
 */
export function redact(message: string, secrets: readonly string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (!secret || secret.length < 8) continue;
    out = out.split(secret).join("[REDACTED]");
    const bare = secret.replace(/^0x/i, "");
    if (bare !== secret && bare.length >= 8) out = out.split(bare).join("[REDACTED]");
  }
  return out;
}

/**
 * Translate anything thrown by the Walrus Memory SDK (or fetch) into a
 * MemoryServiceError. `operation` is a short label used in the message.
 */
export function toMemoryError(err: unknown, operation: string, secrets: readonly string[] = []): MemoryServiceError {
  if (err instanceof MemoryServiceError) return err;

  const rawMessage = err instanceof Error ? err.message : String(err);
  const message = redact(rawMessage, secrets);

  if (err instanceof MemWalRememberJobTimeoutError) {
    return new MemoryServiceError(
      "WRITE_PENDING",
      `${operation}: memory write job did not reach a terminal state within ${err.timeoutMs}ms (last status: ${err.lastStatus ?? "unknown"}).`,
      "The write is NOT confirmed. Re-run the same command later; the job may still complete. Do not count it as stored.",
      { jobId: err.jobId, lastStatus: err.lastStatus },
    );
  }
  if (err instanceof MemWalRememberJobFailedError) {
    return new MemoryServiceError(
      "WRITE_FAILED",
      `${operation}: memory write job failed on the relayer: ${message}`,
      "The memory was not stored. Check relayer status and retry.",
      { jobId: err.jobId, httpStatus: 500 },
    );
  }
  if (err instanceof MemWalRememberJobNotFoundError) {
    return new MemoryServiceError(
      "JOB_NOT_FOUND",
      `${operation}: relayer has no record of this write job.`,
      "The job ID is unknown to this account/relayer. Submit the write again.",
      { jobId: err.jobId, httpStatus: 404 },
    );
  }
  if (err instanceof MemWalRateLimitedError) {
    return new MemoryServiceError(
      "RATE_LIMITED",
      `${operation}: rate limited by the relayer.`,
      "Wait and retry. Writes in this batch are NOT confirmed.",
      { httpStatus: 429, retryAfterSeconds: err.retryAfterSeconds },
    );
  }
  if (err instanceof MemWalCompatibilityError) {
    return new MemoryServiceError(
      "SDK_INCOMPATIBLE",
      `${operation}: SDK/relayer version mismatch: ${message}`,
      "Upgrade @mysten-incubation/memwal (npm install @mysten-incubation/memwal@latest).",
      { httpStatus: 426 },
    );
  }
  if (isTimeoutError(err)) {
    return new MemoryServiceError(
      "TIMEOUT",
      `${operation}: request timed out: ${message}`,
      "The relayer or network is slow or unreachable. Retry; check your connection and https://relayer.memory.walrus.xyz/health.",
    );
  }

  const status = (err as { status?: unknown } | null)?.status;
  const httpStatus = typeof status === "number" ? status : undefined;
  const retryAfter = (err as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;

  if (httpStatus === 401 || httpStatus === 403) {
    return new MemoryServiceError(
      "AUTH_REJECTED",
      `${operation}: relayer rejected the credentials (HTTP ${httpStatus}): ${message}`,
      "Check MEMWAL_ACCOUNT_ID is your Walrus Memory account object ID (not a wallet address), that MEMWAL_PRIVATE_KEY is a delegate key registered on that account at https://memory.walrus.xyz (Mainnet), and that your system clock is correct.",
      { httpStatus },
    );
  }
  if (httpStatus === 429) {
    return new MemoryServiceError("RATE_LIMITED", `${operation}: rate limited by the relayer.`, "Wait and retry.", {
      httpStatus,
      retryAfterSeconds: typeof retryAfter === "number" ? retryAfter : undefined,
    });
  }
  if (httpStatus === 503 && /writes are paused/i.test(rawMessage)) {
    return new MemoryServiceError(
      "WRITES_PAUSED",
      `${operation}: the relayer has paused writes.`,
      "Writes are temporarily disabled on the relayer. Retry later; nothing was stored.",
      { httpStatus },
    );
  }
  if (httpStatus === 504) {
    return new MemoryServiceError("TIMEOUT", `${operation}: relayer timed out: ${message}`, "Retry the request.", {
      httpStatus,
    });
  }
  if (httpStatus !== undefined && httpStatus >= 500) {
    return new MemoryServiceError(
      "RELAYER_UNAVAILABLE",
      `${operation}: relayer error (HTTP ${httpStatus}): ${message}`,
      "The Walrus Memory relayer is unavailable or erroring. Retry later.",
      { httpStatus },
    );
  }
  if (httpStatus !== undefined && httpStatus >= 400) {
    return new MemoryServiceError("INVALID_INPUT", `${operation}: request rejected (HTTP ${httpStatus}): ${message}`, "Check the request parameters.", {
      httpStatus,
    });
  }

  const netCode = networkCode(err);
  if (netCode || (err instanceof TypeError && /fetch failed/i.test(rawMessage))) {
    return new MemoryServiceError(
      "RELAYER_UNAVAILABLE",
      `${operation}: could not reach the relayer${netCode ? ` (${netCode})` : ""}: ${message}`,
      "Check your internet connection and MEMWAL_SERVER_URL, then retry.",
    );
  }
  if (/seed must be exactly 32 bytes|invalid.*key|suiprivkey/i.test(rawMessage)) {
    return new MemoryServiceError(
      "CONFIG_INVALID",
      `${operation}: delegate key could not be parsed.`,
      "MEMWAL_PRIVATE_KEY must be a 32-byte Ed25519 delegate key (64 hex chars, optionally 0x-prefixed) or a suiprivkey1… string.",
    );
  }

  return new MemoryServiceError("UNKNOWN", `${operation}: ${message}`, "Unexpected error; see message.");
}
