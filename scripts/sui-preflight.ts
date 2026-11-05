/**
 * READ-ONLY Phase 3B preflight. Sends no transactions and spends no gas.
 *
 *  1. Tatum: fetches a REAL recent Sui Mainnet transaction through the Tatum
 *     gateway and compares it byte-for-byte with the same transaction from the
 *     submission full node. Also records whether Tatum's JSON-RPC
 *     `sui_getTransactionBlock` still answers.
 *  2. Wallet (if SUI_ANCHOR_PRIVATE_KEY is set): derived address, SUI balance,
 *     reference gas price.
 *  3. Package (if SUI_ANCHOR_PACKAGE_ID is set): the package exists, and a
 *     simulated (dry-run) `anchor::commit` call succeeds; reports its gas cost.
 *
 * Never prints keys. Report: .daymate/reports/sui-preflight-*.json (git-ignored).
 *
 *   npm run sui:preflight
 */
import { randomBytes } from "node:crypto";
import { Transaction } from "@mysten/sui/transactions";
import { MIST_PER_SUI } from "@mysten/sui/utils";
import { anchoringEnabled, loadTatumConfig } from "../src/lib/sui-anchor/config";
import { COMMIT_FUNCTION, EVENT_MODULE, SCHEMA_VERSION, toHex } from "../src/lib/sui-anchor/commitment";
import { loadSigner, submissionClient, SUI_MAINNET_FULLNODE } from "../src/lib/sui-anchor/sui-chain";
import { tatumClient, tatumTransactionSource } from "../src/lib/sui-anchor/tatum";
import { loadEnv, main, writeReport } from "./_cli";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const sui = (mist: bigint | string) => `${(Number(mist) / Number(MIST_PER_SUI)).toFixed(6)} SUI`;

main(async () => {
  loadEnv();
  const env = process.env;
  const rpcUrl = env.SUI_RPC_URL?.trim() || SUI_MAINNET_FULLNODE;
  const node = submissionClient(rpcUrl);
  const report: Record<string, unknown> = { ranAt: new Date().toISOString(), submissionRpc: rpcUrl, anchoringEnabled: anchoringEnabled(env) };

  // ── 1. Tatum ──
  console.log("Tatum (independent verification provider)");
  let tatum: ReturnType<typeof loadTatumConfig> | undefined;
  try {
    tatum = loadTatumConfig(env);
  } catch (e) {
    check("TATUM_API_KEY configured", false, (e as Error).message);
  }
  if (tatum) {
    report.tatumGrpc = tatum.tatumGrpcUrl;
    // a real, recent Mainnet transaction that emitted events
    const { response } = await node.ledgerService.getCheckpoint({ checkpointId: { oneofKind: undefined }, readMask: { paths: ["sequence_number", "transactions.digest", "transactions.events"] } });
    const sample = response.checkpoint?.transactions.find((t) => (t.events?.events?.length ?? 0) > 0)?.digest;
    if (!sample) throw new Error("could not find a sample Mainnet transaction");
    const reference = await node.core.getTransaction({ digest: sample, include: { effects: true, events: true } });
    const ref = reference.Transaction ?? reference.FailedTransaction;

    const src = tatumTransactionSource(tatumClient(tatum.tatumApiKey, tatum.tatumGrpcUrl));
    try {
      const t = await src.getTransaction(sample);
      check("Tatum gRPC LedgerService/GetTransaction returns a real Mainnet transaction", Boolean(t), `digest ${sample}`);
      if (t) {
        check("Tatum digest matches", t.digest === sample);
        check("Tatum execution status matches the full node", t.success === (reference.$kind === "Transaction" && ref.status.success));
        const same = t.events.length === (ref.events?.length ?? 0) && t.events.every((e, i) => e.eventType === ref.events![i]!.eventType && toHex(e.bcs) === toHex(ref.events![i]!.bcs));
        check("Tatum events (type + BCS bytes) match the full node", same, `${t.events.length} events`);
        report.tatumSample = { digest: sample, events: t.events.length, eventTypes: t.events.map((e) => e.eventType) };
      }
    } catch (e) {
      check("Tatum gRPC LedgerService/GetTransaction returns a real Mainnet transaction", false, `${(e as { kind?: string }).kind ?? "error"}: ${(e as Error).message}`);
    }

    // informational: is the JSON-RPC method from the Tatum docs still served?
    try {
      const res = await fetch("https://sui-mainnet.gateway.tatum.io", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": tatum.tatumApiKey },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sui_getTransactionBlock", params: [sample, { showEffects: true, showEvents: true }] }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => null)) as { result?: { digest?: string }; error?: { message?: string } } | null;
      const ok = res.ok && body?.result?.digest === sample;
      report.tatumJsonRpc = { httpStatus: res.status, works: ok, error: body?.error?.message ?? null };
      console.log(`  (info) Tatum JSON-RPC sui_getTransactionBlock: ${ok ? "works" : `not available (HTTP ${res.status}${body?.error?.message ? `, ${body.error.message}` : ""})`}`);
    } catch (e) {
      report.tatumJsonRpc = { works: false, error: (e as Error).message };
      console.log("  (info) Tatum JSON-RPC sui_getTransactionBlock: not reachable");
    }
  }

  // ── 2. Wallet ──
  console.log("\nProject signing wallet");
  const rawKey = env.SUI_ANCHOR_PRIVATE_KEY?.trim();
  let address: string | undefined;
  if (!rawKey || /YOUR_/.test(rawKey)) {
    check("SUI_ANCHOR_PRIVATE_KEY configured", false, "not set (see docs/PHASE3B_SUI.md)");
  } else {
    try {
      address = loadSigner(rawKey).toSuiAddress();
    } catch {
      check("SUI_ANCHOR_PRIVATE_KEY is a valid suiprivkey1… Ed25519 key", false);
    }
    if (address) {
      const { balance } = await node.core.getBalance({ owner: address });
      const { referenceGasPrice } = await node.core.getReferenceGasPrice();
      check("Wallet address derived", true, address);
      check("Wallet holds SUI for gas", BigInt(balance.balance) > 0n, `${sui(balance.balance)} (coins ${sui(balance.coinBalance)}, address balance ${sui(balance.addressBalance)})`);
      report.wallet = { address, balanceMist: balance.balance, referenceGasPrice: String(referenceGasPrice) };
    }
  }

  // ── 3. Package + dry run ──
  console.log("\nDayMate anchor package");
  const pkg = env.SUI_ANCHOR_PACKAGE_ID?.trim();
  if (!pkg || /YOUR_/.test(pkg)) {
    check("SUI_ANCHOR_PACKAGE_ID configured", false, "not set — the package has not been published yet");
  } else {
    try {
      const { object } = await node.core.getObject({ objectId: pkg });
      check("Package exists on Mainnet", object.type === "package", `${pkg} (${object.type})`);
    } catch (e) {
      check("Package exists on Mainnet", false, (e as Error).message);
    }
    if (address) {
      const tx = new Transaction();
      tx.setSender(address);
      tx.moveCall({ target: `${pkg}::${EVENT_MODULE}::${COMMIT_FUNCTION}`, arguments: [tx.pure.vector("u8", randomBytes(32)), tx.pure.u16(SCHEMA_VERSION)] });
      try {
        const sim = await node.core.simulateTransaction({ transaction: tx, include: { effects: true, events: true } });
        const t = sim.Transaction ?? sim.FailedTransaction;
        const g = t.effects?.gasUsed;
        const net = g ? BigInt(g.computationCost) + BigInt(g.storageCost) - BigInt(g.storageRebate) : null;
        check("Dry run of anchor::commit succeeds (nothing submitted)", sim.$kind === "Transaction" && t.status.success, net !== null ? `net gas ≈ ${sui(net)}` : undefined);
        report.dryRun = { success: t.status.success, gasUsed: g, events: t.events?.map((e) => e.eventType) };
      } catch (e) {
        check("Dry run of anchor::commit succeeds (nothing submitted)", false, (e as Error).message.slice(0, 200));
      }
    }
  }

  report.checks = results;
  console.log(`\nreport: ${writeReport("sui-preflight", report)}`);
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} preflight checks passed. No transaction was submitted.`);
  return failed.length === 0 ? 0 : 1;
});
