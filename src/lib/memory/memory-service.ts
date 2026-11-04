import { MemWal } from "@mysten-incubation/memwal";
import type {
  HealthResult,
  MemoriesResult,
  RecallResult,
  RememberAcceptedResult,
  RememberJobStatus,
  RememberResult,
} from "@mysten-incubation/memwal";
import { loadMemoryConfig, type MemoryConfig } from "./config";
import { MemoryServiceError, toMemoryError } from "./errors";

if (typeof window !== "undefined") {
  // Delegate keys must never reach a browser bundle.
  throw new Error("DayMate memory service is server-only and must not be imported in browser code.");
}

/**
 * The subset of the Walrus Memory SDK client this service uses. Kept narrow
 * so unit tests can substitute a clearly-labelled mock.
 */
export interface MemoryClient {
  health(): Promise<HealthResult>;
  remember(text: string, options?: { dedupe?: boolean; idempotencyKey?: string }): Promise<RememberAcceptedResult>;
  waitForRememberJob(jobId: string, opts?: { pollIntervalMs?: number; timeoutMs?: number }): Promise<RememberResult>;
  getRememberStatus(jobId: string): Promise<RememberJobStatus>;
  recall(params: { query: string; limit?: number; namespace?: string; maxDistance?: number }): Promise<RecallResult>;
  listMemories(options?: { cursor?: string; limit?: number; namespace?: string }): Promise<MemoriesResult>;
  destroy(): void;
}

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface MemoryServiceOptions {
  /** Inject a client (tests only). Defaults to a real MemWal client. */
  client?: MemoryClient;
  /** Inject fetch (tests only). Used for the public GET /config Mainnet check. */
  fetch?: FetchLike;
  /** How long to wait for a write job to reach `done`. */
  writeTimeoutMs?: number;
}

export interface ConnectionReport {
  serverUrl: string;
  namespace: string;
  accountId: string;
  relayerStatus: string;
  relayerVersion: string;
  apiVersion?: string;
  mode?: string;
  network: string;
  writeReady: boolean;
  writes?: string;
  /** Present only when credentials were checked with an authenticated call. */
  credentialsVerified: boolean;
  memoriesInNamespace?: number;
}

export interface ConfirmedWrite {
  status: "done";
  jobId: string;
  blobId: string;
  memoryId: string;
  owner: string;
  namespace: string;
}

export interface RecalledMemory {
  text: string;
  blobId: string;
  distance: number;
  createdAt?: string;
}

export interface RecallOutcome {
  query: string;
  namespace: string;
  total: number;
  results: RecalledMemory[];
  empty: boolean;
}

export interface WriteJobState {
  jobId: string;
  status: RememberJobStatus["status"];
  blobId?: string;
  error?: string;
}

const DEFAULT_WRITE_TIMEOUT_MS = 120_000;
const MAX_MEMORY_CHARS = 4_000;
const PREFLIGHT_TIMEOUT_MS = 15_000;

export class MemoryService {
  readonly config: Readonly<Omit<MemoryConfig, "privateKey">>;
  private readonly client: MemoryClient;
  private readonly fetchImpl: FetchLike;
  private readonly writeTimeoutMs: number;
  private readonly secrets: string[];

  constructor(config: MemoryConfig, options: MemoryServiceOptions = {}) {
    this.config = Object.freeze({
      accountId: config.accountId,
      serverUrl: config.serverUrl,
      namespace: config.namespace,
    });
    this.secrets = [config.privateKey];
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.writeTimeoutMs = options.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
    try {
      this.client =
        options.client ??
        MemWal.create({
          key: config.privateKey,
          accountId: config.accountId,
          serverUrl: config.serverUrl,
          namespace: config.namespace,
          // SDK default (5s) for /health, /version, /config proved too tight
          // against the Mainnet relayer in practice; still bounded.
          preflightTimeoutMs: PREFLIGHT_TIMEOUT_MS,
        });
    } catch (err) {
      throw toMemoryError(err, "initialize client", this.secrets);
    }
  }

  /** Build a service from environment variables (validated). */
  static fromEnv(env: Record<string, string | undefined> = process.env, options: MemoryServiceOptions = {}): MemoryService {
    return new MemoryService(loadMemoryConfig(env), options);
  }

  /**
   * Verify the relayer is reachable, healthy, on Mainnet, and accepting writes.
   * With `verifyCredentials`, also makes an authenticated call so a bad
   * account ID or unregistered delegate key fails here rather than mid-seed.
   */
  async checkConnection({ verifyCredentials = true } = {}): Promise<ConnectionReport> {
    let health: HealthResult;
    try {
      health = await this.client.health();
    } catch (err) {
      const mapped = toMemoryError(err, "relayer health check", this.secrets);
      if (mapped.code === "UNKNOWN") {
        throw new MemoryServiceError("RELAYER_UNAVAILABLE", mapped.message, "The relayer health endpoint failed. Check MEMWAL_SERVER_URL and retry later.");
      }
      throw mapped;
    }
    if (health.status !== "ok") {
      throw new MemoryServiceError(
        "RELAYER_UNAVAILABLE",
        `Relayer health status is "${health.status}".`,
        "The relayer reports it is not healthy. Retry later.",
      );
    }

    const network = await this.fetchNetwork();
    if (network !== "mainnet") {
      throw new MemoryServiceError(
        "NOT_MAINNET",
        `Relayer at ${this.config.serverUrl} reports network "${network}", not "mainnet".`,
        "DayMate Phase 1 requires Walrus Mainnet. Set MEMWAL_SERVER_URL=https://relayer.memory.walrus.xyz.",
      );
    }

    const raw = health as HealthResult & { writes?: string };
    const report: ConnectionReport = {
      serverUrl: this.config.serverUrl,
      namespace: this.config.namespace,
      accountId: this.config.accountId,
      relayerStatus: health.status,
      relayerVersion: health.relayerVersion ?? health.version,
      apiVersion: health.apiVersion,
      mode: health.mode,
      network,
      writeReady: health.write_ready !== false && raw.writes !== "paused",
      writes: raw.writes,
      credentialsVerified: false,
    };

    if (verifyCredentials) {
      report.memoriesInNamespace = await this.countMemories();
      report.credentialsVerified = true;
    }
    return report;
  }

  /**
   * Store a memory and wait until the relayer confirms the job is `done`
   * with a Walrus blob ID. Anything short of that throws — a submitted or
   * pending job is never reported as stored.
   *
   * `dedupe: true` asks the relayer to resolve identical text in this
   * namespace to the existing memory instead of writing a duplicate blob.
   */
  async rememberConfirmed(text: string, { dedupe = false, timeoutMs }: { dedupe?: boolean; timeoutMs?: number } = {}): Promise<ConfirmedWrite> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new MemoryServiceError("INVALID_INPUT", "Memory text is empty.", "Provide non-empty text to remember.");
    }
    if (trimmed.length > MAX_MEMORY_CHARS) {
      throw new MemoryServiceError("INVALID_INPUT", `Memory text exceeds ${MAX_MEMORY_CHARS} characters.`, "Split it into smaller memories.");
    }

    let accepted: RememberAcceptedResult;
    try {
      accepted = await this.client.remember(trimmed, dedupe ? { dedupe: true } : undefined);
    } catch (err) {
      throw toMemoryError(err, "submit memory write", this.secrets);
    }
    if (!accepted?.job_id) {
      throw new MemoryServiceError("WRITE_UNCONFIRMED", "Relayer accepted the write but returned no job ID.", "Nothing can be confirmed; retry the write.");
    }

    return this.confirmWrite(accepted.job_id, timeoutMs);
  }

  /** Wait for an existing write job (e.g. one left pending by an earlier run). */
  async confirmWrite(jobId: string, timeoutMs = this.writeTimeoutMs): Promise<ConfirmedWrite> {
    let result: RememberResult;
    try {
      result = await this.client.waitForRememberJob(jobId, { timeoutMs });
    } catch (err) {
      throw toMemoryError(err, "confirm memory write", this.secrets);
    }
    if (!result?.blob_id) {
      throw new MemoryServiceError(
        "WRITE_UNCONFIRMED",
        "Write job finished without a Walrus blob ID.",
        "The write cannot be confirmed as stored on Walrus. Retry it.",
        { jobId },
      );
    }
    if (result.namespace && result.namespace !== this.config.namespace) {
      throw new MemoryServiceError(
        "WRITE_UNCONFIRMED",
        `Write landed in namespace "${result.namespace}", expected "${this.config.namespace}".`,
        "Check MEMWAL_NAMESPACE.",
        { jobId },
      );
    }
    return {
      status: "done",
      jobId: result.job_id ?? jobId,
      blobId: result.blob_id,
      memoryId: result.id,
      owner: result.owner,
      namespace: result.namespace ?? this.config.namespace,
    };
  }

  /** One-shot status read for a write job, without waiting. */
  async getWriteStatus(jobId: string): Promise<WriteJobState> {
    try {
      const s = await this.client.getRememberStatus(jobId);
      return { jobId: s.job_id ?? jobId, status: s.status, blobId: s.blob_id, error: s.error };
    } catch (err) {
      throw toMemoryError(err, "read write status", this.secrets);
    }
  }

  /** Natural-language recall from this service's namespace. */
  async recall(query: string, { limit = 5 }: { limit?: number } = {}): Promise<RecallOutcome> {
    const q = query.trim();
    if (!q) throw new MemoryServiceError("INVALID_INPUT", "Recall query is empty.", "Ask a question in natural language.");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new MemoryServiceError("INVALID_INPUT", "Recall limit must be an integer between 1 and 100.", "Use a smaller limit.");
    }

    let res: RecallResult;
    try {
      res = await this.client.recall({ query: q, limit, namespace: this.config.namespace });
    } catch (err) {
      throw toMemoryError(err, "recall", this.secrets);
    }
    const results = (res?.results ?? []).map((r) => ({
      text: r.text,
      blobId: r.blob_id,
      distance: r.distance,
      createdAt: r.created_at,
    }));
    return { query: q, namespace: this.config.namespace, total: res?.total ?? results.length, results, empty: results.length === 0 };
  }

  /** Inventory of this namespace from the relayer (metadata only). */
  async listNamespaceMemories(): Promise<MemoriesResult["memories"]> {
    const out: MemoriesResult["memories"] = [];
    let cursor: string | undefined;
    try {
      for (let page = 0; page < 100; page++) {
        const res = await this.client.listMemories({ cursor, namespace: this.config.namespace });
        out.push(...res.memories);
        if (!res.has_more) break;
        cursor = res.next_cursor ?? undefined;
      }
    } catch (err) {
      throw toMemoryError(err, "list memories", this.secrets);
    }
    return out;
  }

  private async countMemories(): Promise<number> {
    return (await this.listNamespaceMemories()).length;
  }

  private async fetchNetwork(): Promise<string> {
    let body: unknown;
    try {
      const res = await this.fetchImpl(`${this.config.serverUrl}/config`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        throw Object.assign(new Error(`GET /config returned HTTP ${res.status}`), { status: res.status });
      }
      body = await res.json();
    } catch (err) {
      const mapped = toMemoryError(err, "relayer config check", this.secrets);
      if (mapped.code === "UNKNOWN" || (err instanceof Error && err.name === "TimeoutError")) {
        throw new MemoryServiceError("RELAYER_UNAVAILABLE", mapped.message, "Could not read the relayer's network config. Retry later.");
      }
      throw mapped;
    }
    const network = (body as { network?: unknown } | null)?.network;
    if (typeof network !== "string") {
      throw new MemoryServiceError("RELAYER_UNAVAILABLE", "Relayer /config response did not include a network.", "Cannot confirm Mainnet; refusing to continue.");
    }
    return network;
  }

  /** Wipe the delegate key from the SDK client's memory. */
  close(): void {
    this.client.destroy();
  }
}
