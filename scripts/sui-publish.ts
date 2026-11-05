/**
 * Publish move/daymate_anchor to Sui Mainnet with the project wallet
 * (SUI_ANCHOR_PRIVATE_KEY from .env; the key is never imported into a CLI
 * keystore, printed or logged).
 *
 * Without --confirm-mainnet this only DRY-RUNS (simulates) the publish and
 * prints the expected gas. With --make-immutable it also burns the UpgradeCap
 * (0x2::package::make_immutable) in the same transaction, so the package can
 * never be changed.
 *
 *   sui move build --path move/daymate_anchor --dump-bytecode-as-base64 > .daymate/bytecode.json
 *   npm run sui:publish -- .daymate/bytecode.json                       # dry run
 *   npm run sui:publish -- .daymate/bytecode.json --confirm-mainnet --make-immutable
 */
import { readFileSync } from "node:fs";
import { Transaction } from "@mysten/sui/transactions";
import { MIST_PER_SUI } from "@mysten/sui/utils";
import { loadSigner, submissionClient, SUI_MAINNET_FULLNODE } from "../src/lib/sui-anchor/sui-chain";
import { loadEnv, main, writeReport } from "./_cli";

const sui = (mist: bigint) => `${(Number(mist) / Number(MIST_PER_SUI)).toFixed(6)} SUI`;

main(async () => {
  const path = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!path) throw new Error("usage: npm run sui:publish -- <bytecode.json> [--confirm-mainnet] [--make-immutable]");
  const confirm = process.argv.includes("--confirm-mainnet");
  const immutable = process.argv.includes("--make-immutable");
  loadEnv();
  const key = process.env.SUI_ANCHOR_PRIVATE_KEY?.trim();
  if (!key || /YOUR_/.test(key)) throw new Error("SUI_ANCHOR_PRIVATE_KEY is not set.");
  if (process.env.SUI_ANCHOR_PACKAGE_ID?.trim() && !/YOUR_/.test(process.env.SUI_ANCHOR_PACKAGE_ID)) {
    console.log("Note: SUI_ANCHOR_PACKAGE_ID is already set. Publishing again creates a SECOND package.");
  }

  const { modules, dependencies } = JSON.parse(readFileSync(path, "utf8")) as { modules: string[]; dependencies: string[] };
  const signer = loadSigner(key);
  const address = signer.toSuiAddress();
  const client = submissionClient(process.env.SUI_RPC_URL?.trim() || SUI_MAINNET_FULLNODE);

  const tx = new Transaction();
  tx.setSender(address);
  const cap = tx.publish({ modules, dependencies });
  if (immutable) tx.moveCall({ target: "0x2::package::make_immutable", arguments: [cap] });
  else tx.transferObjects([cap], address);

  console.log(`publisher ${address}`);
  console.log(`modules   ${modules.length}, upgrade cap: ${immutable ? "burned (immutable package)" : "kept by publisher"}`);
  const sim = await client.core.simulateTransaction({ transaction: tx, include: { effects: true } });
  const st = sim.Transaction ?? sim.FailedTransaction;
  const g = st.effects!.gasUsed;
  const gross = BigInt(g.computationCost) + BigInt(g.storageCost);
  const net = gross - BigInt(g.storageRebate);
  console.log(`dry run   ${st.status.success ? "succeeds" : `FAILS: ${st.status.error?.message}`}; gas ≈ ${sui(net)} net (${sui(gross)} before rebate)`);
  if (!st.status.success) return 1;
  if (!confirm) {
    console.log("\nDry run only. Nothing was submitted. Re-run with --confirm-mainnet to publish.");
    return 0;
  }

  const res = await client.signAndExecuteTransaction({ transaction: tx, signer, include: { effects: true, objectTypes: true } });
  const t = res.Transaction ?? res.FailedTransaction;
  const pkg = t.effects?.changedObjects.find((c) => c.outputState === "PackageWrite")?.objectId;
  const capId = immutable ? null : t.effects?.changedObjects.find((c) => c.idOperation === "Created" && t.objectTypes?.[c.objectId] === "0x2::package::UpgradeCap")?.objectId;
  const ok = res.$kind === "Transaction" && t.status.success && Boolean(pkg);
  console.log(`\n${ok ? "✓ published" : "✗ publish FAILED"}  digest ${t.digest}`);
  if (pkg) console.log(`package   ${pkg}\n\nSet in .env:  SUI_ANCHOR_PACKAGE_ID=${pkg}`);
  if (capId) console.log(`upgrade cap ${capId}`);
  console.log(`explorer  https://suiscan.xyz/mainnet/tx/${t.digest}`);
  console.log(`report: ${writeReport("sui-publish", { ranAt: new Date().toISOString(), publisher: address, digest: t.digest, success: ok, packageId: pkg ?? null, upgradeCap: capId ?? null, immutable, gasUsed: t.effects?.gasUsed })}`);
  return ok ? 0 : 1;
});
