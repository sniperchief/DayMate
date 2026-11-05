/**
 * FIRST MAINNET ANCHOR — SYNTHETIC DATA ONLY. Spends real SUI gas.
 *
 * Builds a commitment for a synthetic, non-personal memory version (random
 * UUID, synthetic blob ID, hash of a fixed synthetic sentence), signs it with
 * the project wallet, submits it to Sui Mainnet, then verifies it
 * independently through Tatum. Touches no Supabase data.
 *
 * Refuses to run without --confirm-mainnet.
 *
 *   npm run sui:anchor-synthetic -- --confirm-mainnet
 *
 * Evidence report: .daymate/reports/sui-anchor-synthetic-*.json (git-ignored).
 */
import { createHash, randomUUID } from "node:crypto";
import { canonicalPayload, computeCommitment, newSalt, SCHEMA_VERSION, toHex } from "../src/lib/sui-anchor/commitment";
import { loadAnchorConfig } from "../src/lib/sui-anchor/config";
import { loadSigner, submissionClient, suiChain } from "../src/lib/sui-anchor/sui-chain";
import { tatumClient, tatumTransactionSource } from "../src/lib/sui-anchor/tatum";
import { verifyAnchorTransaction } from "../src/lib/sui-anchor/verify";
import { loadEnv, main, writeReport } from "./_cli";

const SYNTHETIC_TEXT = "DayMate Phase 3B synthetic anchoring test. This is not a real memory and contains no personal data.";

main(async () => {
  if (!process.argv.includes("--confirm-mainnet")) {
    console.error("Refusing to submit a Mainnet transaction without --confirm-mainnet (this spends real SUI).");
    return 2;
  }
  loadEnv();
  const config = loadAnchorConfig(process.env);
  const chain = suiChain({ client: submissionClient(config.submitRpcUrl), signer: loadSigner(config.privateKey), packageId: config.packageId });
  const tatum = tatumTransactionSource(tatumClient(config.tatumApiKey, config.tatumGrpcUrl));

  const version = { memoryId: randomUUID(), version: 1, walrusBlobId: "SYNTHETIC_PHASE3B_TEST", walrusContentHash: createHash("sha256").update(SYNTHETIC_TEXT).digest("hex") };
  const payload = canonicalPayload(version);
  const salt = newSalt();
  const commitment = computeCommitment(payload, salt, SCHEMA_VERSION);
  console.log(`package   ${config.packageId}`);
  console.log(`signer    ${chain.signerAddress}`);
  console.log(`commitment ${toHex(commitment)} (schema ${SCHEMA_VERSION})`);

  const signed = await chain.buildAndSign(commitment, SCHEMA_VERSION);
  console.log(`digest    ${signed.digest} (computed before submission)`);
  const report: Record<string, unknown> = {
    ranAt: new Date().toISOString(),
    synthetic: true,
    packageId: config.packageId,
    signer: chain.signerAddress,
    submissionRpc: config.submitRpcUrl,
    // synthetic data: safe to keep so the commitment can be recomputed
    canonicalPayload: payload,
    saltHex: toHex(salt),
    commitmentHex: toHex(commitment),
    schemaVersion: SCHEMA_VERSION,
    digest: signed.digest,
    explorer: `https://suiscan.xyz/mainnet/tx/${signed.digest}`,
  };

  try {
    const res = await chain.execute(signed);
    report.submission = res;
    console.log(`submitted ${res.success ? "executed successfully" : `FAILED on chain: ${res.error}`}`);
    if (!res.success) return finish(report, 1);
  } catch (e) {
    report.submission = { unknown: true, error: (e as Error).message };
    console.log("submitted outcome UNKNOWN (timeout/network). Do not resubmit; re-run verification later with the digest above.");
  }

  const attempts: unknown[] = [];
  for (const wait of [0, 2_000, 4_000, 8_000, 15_000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const r = await verifyAnchorTransaction(tatum, { digest: signed.digest, packageId: config.packageId, sender: chain.signerAddress, commitmentHex: toHex(commitment), schemaVersion: SCHEMA_VERSION });
    attempts.push({ at: new Date().toISOString(), ...r });
    if (r.ok || !r.retryable) break;
  }
  report.tatumVerification = attempts;
  const final = attempts.at(-1) as { ok: boolean; reason?: string };
  console.log(final.ok ? "✓ VERIFIED independently through Tatum (digest, success, package/module/event, sender, commitment, schema)" : `✗ not verified via Tatum: ${final.reason}`);
  return finish(report, final.ok ? 0 : 1);
});

function finish(report: Record<string, unknown>, code: number): number {
  console.log(`evidence: ${writeReport("sui-anchor-synthetic", report)}`);
  return code;
}
