import { TransactionError } from "@mysten/sui/client";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { ChannelCredentials } from "@grpc/grpc-js";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { SourceError, type FetchedTransaction, type TransactionSource } from "./verify";

/**
 * Tatum Sui Mainnet gateway as an independent verification provider.
 *
 * Tatum's live gateway manifest (https://sui-mainnet-grpc.gateway.tatum.io/_methods,
 * checked 2026-11-04) exposes the Sui gRPC API `sui.rpc.v2.LedgerService/GetTransaction`;
 * JSON-RPC `sui_getTransactionBlock` returns HTTP 404 on the Mainnet gateway.
 * The JSON-RPC host (sui-mainnet.gateway.tatum.io) now advertises GraphQL only,
 * in line with Sui's JSON-RPC decommission. Authentication: `x-api-key` header.
 *
 * This is a read-only client and never sees the signing key.
 */

export const TATUM_SUI_MAINNET_GRPC = "https://sui-mainnet-grpc.gateway.tatum.io";

/** Minimal shape of the SDK call we rely on (lets tests inject a fake). */
export interface GetTransactionClient {
  core: {
    getTransaction(input: { digest: string; include: { effects: true; events: true }; signal?: AbortSignal }): Promise<unknown>;
  };
}

/**
 * Tatum's gateway is a NATIVE gRPC (HTTP/2) endpoint: answering gRPC-web it
 * returns the data frame but carries `grpc-status` in HTTP/2 trailers, which
 * fetch-based gRPC-web cannot read ("missing status", observed 2026-11-04).
 * So DayMate talks to it over real HTTP/2 gRPC (@grpc/grpc-js) and gets the
 * genuine status — nothing is assumed or synthesised.
 */
export function tatumClient(apiKey: string, baseUrl = TATUM_SUI_MAINNET_GRPC): GetTransactionClient {
  const url = new URL(baseUrl);
  const transport = new GrpcTransport({
    host: `${url.hostname}:${url.port || "443"}`,
    channelCredentials: ChannelCredentials.createSsl(),
    meta: { "x-api-key": apiKey },
  });
  return new SuiGrpcClient({ network: "mainnet", transport }) as unknown as GetTransactionClient;
}

export function tatumTransactionSource(client: GetTransactionClient, { timeoutMs = 15_000 }: { timeoutMs?: number } = {}): TransactionSource {
  return {
    name: "tatum",
    async getTransaction(digest) {
      let raw: unknown;
      try {
        raw = await client.core.getTransaction({ digest, include: { effects: true, events: true }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        if (err instanceof TransactionError && err.reason === "notFound") return null;
        throw classify(err);
      }
      return parse(raw);
    },
  };
}

function classify(err: unknown): SourceError {
  const code = String((err as { code?: unknown })?.code ?? "");
  const name = (err as { name?: string })?.name ?? "";
  const msg = String((err as { message?: unknown })?.message ?? err);
  if (code === "NOT_FOUND") return new SourceError("rpc", "transaction lookup returned NOT_FOUND status");
  if (code === "RESOURCE_EXHAUSTED" || /\b429\b|too many requests/i.test(msg)) return new SourceError("rate-limited", "Tatum rate limit reached");
  if (code === "UNAUTHENTICATED" || code === "PERMISSION_DENIED" || /\b401\b|\b403\b/.test(msg)) return new SourceError("auth", "Tatum rejected the API key");
  if (code === "DEADLINE_EXCEEDED" || name === "TimeoutError" || name === "AbortError" || /timed? ?out|aborted/i.test(msg)) return new SourceError("timeout", "Tatum request timed out");
  return new SourceError("rpc", `Tatum RPC error${code ? ` (${code})` : ""}`);
}

/** Validate the SDK result rather than trusting its shape. */
function parse(raw: unknown): FetchedTransaction {
  const r = raw as { $kind?: string; Transaction?: unknown; FailedTransaction?: unknown } | null;
  const t = (r?.Transaction ?? r?.FailedTransaction) as
    | { digest?: unknown; status?: { success?: unknown; error?: unknown }; effects?: { status?: { success?: unknown } }; events?: unknown }
    | undefined;
  if (!t || typeof t.digest !== "string" || typeof t.status?.success !== "boolean") throw new SourceError("malformed", "unexpected transaction response");
  const effectsOk = t.effects?.status?.success;
  if (effectsOk !== undefined && effectsOk !== t.status.success) throw new SourceError("malformed", "status and effects disagree");
  const success = r?.$kind === "Transaction" && t.status.success === true;
  const events = t.events ?? [];
  if (!Array.isArray(events)) throw new SourceError("malformed", "events is not a list");
  return {
    digest: t.digest,
    success,
    error: success ? null : describeError(t.status.error),
    events: events.map((e: Record<string, unknown>) => ({
      packageId: String(e.packageId ?? ""),
      module: String(e.module ?? ""),
      sender: String(e.sender ?? ""),
      eventType: String(e.eventType ?? ""),
      bcs: e.bcs instanceof Uint8Array ? e.bcs : new Uint8Array(),
    })),
  };
}

function describeError(e: unknown): string {
  const m = (e as { message?: unknown })?.message;
  return typeof m === "string" ? m.slice(0, 200) : "execution failed";
}
