// Verification logic and the Tatum adapter against MOCK responses — not evidence of Mainnet.
import { TransactionError } from "@mysten/sui/client";
import { describe, expect, it } from "vitest";
import { tatumTransactionSource, type GetTransactionClient } from "../../src/lib/sui-anchor/tatum";
import { SourceError, verifyAnchorTransaction, type FetchedTransaction, type TransactionSource } from "../../src/lib/sui-anchor/verify";
import { eventBcs, hex, PACKAGE, SIGNER } from "./fakes";

const COMMITMENT = new Uint8Array(32).fill(7);
const DIGEST = "4A62hgFcsNSgnsZrQirhHr9H2xW9gHrNu59etaZuHbTQ";
const expected = { digest: DIGEST, packageId: PACKAGE, sender: SIGNER, commitmentHex: hex(COMMITMENT), schemaVersion: 1 };

function good(over: Partial<FetchedTransaction> = {}): FetchedTransaction {
  return {
    digest: DIGEST,
    success: true,
    error: null,
    events: [{ packageId: PACKAGE, module: "anchor", sender: SIGNER, eventType: `${PACKAGE}::anchor::MemoryCommitted`, bcs: eventBcs(COMMITMENT, 1) }],
    ...over,
  };
}

function source(result: FetchedTransaction | null | Error): TransactionSource {
  return {
    name: "tatum",
    async getTransaction() {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const ev = (over: Partial<FetchedTransaction["events"][number]>) => good({ events: [{ ...good().events[0]!, ...over }] });

describe("[mock] verifyAnchorTransaction", () => {
  it("accepts the correct transaction and event", async () => {
    expect(await verifyAnchorTransaction(source(good()), expected)).toEqual({ ok: true, provider: "tatum" });
  });

  it("accepts a non-normalised package address in the event type", async () => {
    const short = PACKAGE.replace(/^0x0*/, "0x");
    expect(await verifyAnchorTransaction(source(ev({ eventType: `${short}::anchor::MemoryCommitted` })), expected)).toMatchObject({ ok: true });
  });

  it.each<[string, FetchedTransaction | null | Error, string, boolean]>([
    ["missing transaction", null, "not-found", true],
    ["wrong digest", good({ digest: "9xWrongDigest9xWrongDigest9xWrongDigest9xWro" }), "digest-mismatch", false],
    ["failed execution", good({ success: false, error: "MoveAbort", events: [] }), "execution-failed", false],
    ["missing event", good({ events: [] }), "event-missing", false],
    ["unrelated event only", ev({ eventType: "0x2::coin::CoinCreated" }), "event-missing", false],
    ["wrong package (lookalike type)", ev({ packageId: "0x" + "cd".repeat(32), eventType: `0x${"cd".repeat(32)}::anchor::MemoryCommitted` }), "wrong-package", false],
    ["wrong module", ev({ module: "other" }), "wrong-package", false],
    ["wrong emitting package id", ev({ packageId: "0x" + "cd".repeat(32) }), "wrong-package", false],
    ["wrong sender", ev({ sender: "0x" + "99".repeat(32) }), "wrong-sender", false],
    ["wrong commitment", ev({ bcs: eventBcs(new Uint8Array(32).fill(8), 1) }), "commitment-mismatch", false],
    ["wrong schema version", ev({ bcs: eventBcs(COMMITMENT, 2) }), "schema-mismatch", false],
    ["truncated BCS", ev({ bcs: new Uint8Array([32, 1, 2]) }), "malformed-event", false],
    ["trailing BCS bytes", ev({ bcs: new Uint8Array([...eventBcs(COMMITMENT, 1), 0]) }), "malformed-event", false],
    ["two DayMate events", good({ events: [good().events[0]!, good().events[0]!] }), "malformed-event", false],
    ["malformed response", { digest: 5 } as unknown as FetchedTransaction, "malformed", true],
    ["RPC timeout", new SourceError("timeout", "t"), "timeout", true],
    ["rate limited", new SourceError("rate-limited", "429"), "rate-limited", true],
    ["unexpected error", new Error("boom"), "rpc", true],
  ])("rejects: %s", async (_name, result, reason, retryable) => {
    expect(await verifyAnchorTransaction(source(result), expected)).toEqual({ ok: false, reason, retryable, provider: "tatum" });
  });
});

describe("[mock] Tatum transaction source (SDK response parsing)", () => {
  const client = (impl: () => Promise<unknown>): GetTransactionClient => ({ core: { getTransaction: impl } });
  const sdkTx = (over: Record<string, unknown> = {}) => ({
    $kind: "Transaction",
    Transaction: {
      digest: DIGEST,
      status: { success: true, error: null },
      effects: { status: { success: true, error: null } },
      events: [{ packageId: PACKAGE, module: "anchor", sender: SIGNER, eventType: `${PACKAGE}::anchor::MemoryCommitted`, bcs: eventBcs(COMMITMENT, 1), json: {} }],
      ...over,
    },
  });

  it("maps a gRPC GetTransaction result and verifies it end to end", async () => {
    const src = tatumTransactionSource(client(async () => sdkTx()));
    expect(src.name).toBe("tatum");
    expect(await verifyAnchorTransaction(src, expected)).toEqual({ ok: true, provider: "tatum" });
  });

  it("maps FailedTransaction to unsuccessful execution", async () => {
    const t = sdkTx({ status: { success: false, error: { message: "MoveAbort" } }, effects: { status: { success: false } } });
    const src = tatumTransactionSource(client(async () => ({ $kind: "FailedTransaction", FailedTransaction: t.Transaction })));
    expect(await verifyAnchorTransaction(src, expected)).toMatchObject({ ok: false, reason: "execution-failed" });
  });

  it("returns null (not found) for the SDK's notFound error", async () => {
    const src = tatumTransactionSource(client(async () => { throw new TransactionError("notFound", DIGEST); }));
    expect(await src.getTransaction(DIGEST)).toBeNull();
  });

  it.each([
    [{ code: "RESOURCE_EXHAUSTED", message: "x" }, "rate-limited"],
    [{ code: "", message: "HTTP 429 Too Many Requests" }, "rate-limited"],
    [{ code: "UNAUTHENTICATED", message: "Unauthorized" }, "auth"],
    [{ code: "DEADLINE_EXCEEDED", message: "x" }, "timeout"],
    [Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "timeout"],
    [{ code: "UNAVAILABLE", message: "upstream" }, "rpc"],
  ])("classifies transport error %j as %s", async (err, kind) => {
    const src = tatumTransactionSource(client(async () => { throw err; }));
    await expect(src.getTransaction(DIGEST)).rejects.toMatchObject({ kind });
  });

  it.each([
    ["null result", null],
    ["no digest", { $kind: "Transaction", Transaction: { status: { success: true } } }],
    ["status/effects disagree", sdkTx({ effects: { status: { success: false } } })],
    ["events not a list", sdkTx({ events: "nope" })],
  ])("rejects a malformed response: %s", async (_n, raw) => {
    const src = tatumTransactionSource(client(async () => raw));
    await expect(src.getTransaction(DIGEST)).rejects.toMatchObject({ kind: "malformed" });
  });

  it("passes a timeout signal to the SDK call", async () => {
    let signal: AbortSignal | undefined;
    const src = tatumTransactionSource({ core: { getTransaction: async (i) => ((signal = i.signal), sdkTx()) } }, { timeoutMs: 1234 });
    await src.getTransaction(DIGEST);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
