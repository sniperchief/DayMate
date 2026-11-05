/**
 * LOCALNET end-to-end test of the Phase 3B code path. NOT Mainnet, NOT Tatum.
 *
 * Runs the production modules (commitment, suiChain build/sign/digest/execute/
 * lookup/isDead, gRPC response parsing, BCS verification, anchorMemory
 * lifecycle) against a real local Sui node started with
 * `sui start --with-faucet --force-regenesis`. A throwaway in-memory key is used.
 * The verification transport is a gRPC client pointed at the LOCAL node: this
 * proves the code against real node responses but is not Tatum verification.
 *
 *   sui move build --path move/daymate_anchor --dump-bytecode-as-base64 > bytecode.json
 *   npx tsx scripts/sui-localnet-e2e.ts bytecode.json
 */
import { readFileSync } from "node:fs";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { anchorMemory } from "../src/lib/sui-anchor/anchor";
import { suiChain } from "../src/lib/sui-anchor/sui-chain";
import { tatumTransactionSource, type GetTransactionClient } from "../src/lib/sui-anchor/tatum";
import { verifyAnchorTransaction, type TransactionSource } from "../src/lib/sui-anchor/verify";
import { CAREGIVER, fakeAnchorStore, HASH, MEMORY, memory, walrusRecord } from "../tests/phase3b/fakes";
import { main } from "./_cli";

const RPC = process.env.LOCALNET_RPC ?? "http://127.0.0.1:9000";
const FAUCET = process.env.LOCALNET_FAUCET ?? "http://127.0.0.1:9123";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

main(async () => {
  const { modules, dependencies } = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as { modules: string[]; dependencies: string[] };
  const client = new SuiGrpcClient({ network: "localnet", baseUrl: RPC });
  const signer = new Ed25519Keypair(); // throwaway, localnet only
  const address = signer.toSuiAddress();
  await requestSuiFromFaucetV2({ host: FAUCET, recipient: address }); // local faucet serves the v2 endpoint
  await new Promise((r) => setTimeout(r, 1500));

  // publish (immutable afterwards is a Mainnet deployment choice; here we just keep the cap)
  const pub = new Transaction();
  const cap = pub.publish({ modules, dependencies });
  pub.transferObjects([cap], address);
  const published = await client.signAndExecuteTransaction({ transaction: pub, signer, include: { effects: true, objectTypes: true } });
  const pt = published.Transaction ?? published.FailedTransaction;
  const pkgChange = pt.effects?.changedObjects.find((c) => c.outputState === "PackageWrite");
  check("publish daymate_anchor on localnet", published.$kind === "Transaction" && Boolean(pkgChange), pkgChange?.objectId);
  if (!pkgChange) return 1;
  const packageId = pkgChange.objectId;
  await client.waitForTransaction({ digest: pt.digest });

  const chain = suiChain({ client, signer, packageId });
  const local: TransactionSource = { ...tatumTransactionSource(client as unknown as GetTransactionClient), name: "localnet-grpc" };

  // full lifecycle with the real chain + real node responses (in-memory DB)
  const store = fakeAnchorStore({ memory: memory(), record: walrusRecord() });
  const out = await anchorMemory({ store, chain, verifier: local, packageId, verifyDelaysMs: [1000, 2000, 4000] }, { caregiverId: CAREGIVER, memoryId: MEMORY, expectedContentHash: HASH });
  const a = store.anchors[0]!;
  check("anchorMemory → verified against real node responses", out.status === "verified", `${out.status} ${a?.tx_digest ?? ""}`);
  check("pre-computed digest equals the executed digest", Boolean(a?.tx_digest) && "digest" in out && out.digest === a.tx_digest);

  const digest = a.tx_digest!;
  const tx = await client.core.getTransaction({ digest, include: { events: true, effects: true } });
  const ev = (tx.Transaction ?? tx.FailedTransaction).events?.[0];
  check("event type is <package>::anchor::MemoryCommitted", ev?.eventType === `${packageId}::anchor::MemoryCommitted`, ev?.eventType);
  check("event BCS is exactly 35 bytes (len + 32-byte commitment + u16)", ev?.bcs.length === 35);
  check("event JSON has only commitment + schema_version", JSON.stringify(Object.keys(ev?.json ?? {}).sort()) === JSON.stringify(["commitment", "schema_version"]), JSON.stringify(ev?.json));
  check("event module and sender", ev?.module === "anchor" && ev?.sender === address);

  const exp = { digest, packageId, sender: address, commitmentHex: a.secret.commitment, schemaVersion: 1 };
  check("verify: wrong commitment rejected", (await verifyAnchorTransaction(local, { ...exp, commitmentHex: "00".repeat(32) })).ok === false);
  check("verify: wrong schema rejected", (await verifyAnchorTransaction(local, { ...exp, schemaVersion: 2 })).ok === false);
  const wrongPkg = await verifyAnchorTransaction(local, { ...exp, packageId: "0x" + "ab".repeat(32) });
  check("verify: wrong package rejected", !wrongPkg.ok && wrongPkg.reason === "wrong-package", JSON.stringify(wrongPkg));
  check("verify: wrong sender rejected", (await verifyAnchorTransaction(local, { ...exp, sender: "0x" + "12".repeat(32) })).ok === false);
  const missing = await verifyAnchorTransaction(local, { ...exp, digest: "11111111111111111111111111111111" });
  check("verify: unknown digest → not-found (retryable)", !missing.ok && missing.reason === "not-found" && missing.retryable, JSON.stringify(missing));

  check("lookup finds the executed transaction", (await chain.lookup(digest)).found === true);
  check("executed tx is reported dead (gas coin moved on)", await chain.isDead({ digest, bytes: a.tx_bytes!, signature: a.tx_signature! }));

  // a signed-but-unsent tx is NOT dead; re-sending identical bytes later executes once
  const fresh = await chain.buildAndSign(new Uint8Array(32).fill(3), 1);
  check("signed-but-unsent tx is not dead", (await chain.isDead(fresh)) === false);
  check("unsent tx not found on lookup", (await chain.lookup(fresh.digest)).found === false);
  const first = await chain.execute(fresh);
  check("executing the signed bytes succeeds", first.success);
  let second: string;
  try {
    const again = await chain.execute(fresh);
    second = `returned ${again.success ? "success (same digest, executed once)" : "failure"}`;
  } catch (e) {
    second = `rejected: ${(e as Error).message.slice(0, 120)}`;
  }
  console.log(`  (info) re-sending identical bytes: ${second}`);

  // the contract rejects a malformed commitment (aborts during build's dry run)
  let aborted = false;
  try {
    await chain.buildAndSign(new Uint8Array(31), 1);
  } catch {
    aborted = true;
  }
  check("31-byte commitment is rejected by the contract", aborted);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} LOCALNET checks passed (not Mainnet, not Tatum).`);
  return failed.length ? 1 : 0;
});
