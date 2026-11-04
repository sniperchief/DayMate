/**
 * Natural-language recall against Walrus Memory Mainnet, from a fresh
 * process and a freshly initialised client. Requires network + credentials.
 * Answers come only from the relayer; the manifest is used solely to grade.
 *
 *   npm run memory:recall                         # run the standard checks
 *   npm run memory:recall -- "Who is Clara?"      # ask your own question
 */
import { RECALL_CHECKS } from "../src/seed/manifest";
import { gradeRecall } from "../src/seed/run-seed";
import { createService, main, writeReport } from "./_cli";

const LIMIT = 3;

main(async () => {
  const custom = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const service = createService();
  try {
    const conn = await service.checkConnection({ verifyCredentials: false });
    console.log(`Recall from ${conn.serverUrl} (network=${conn.network}) namespace="${conn.namespace}" — fresh process pid=${process.pid}\n`);

    const checks = custom.length > 0 ? custom.map((q) => ({ question: q, expectSeedId: undefined, mustContain: [] as string[] })) : RECALL_CHECKS;
    const records = [];
    let passed = 0;

    for (const check of checks) {
      const outcome = await service.recall(check.question, { limit: LIMIT });
      const graded = check.mustContain.length > 0;
      const pass = graded ? gradeRecall(outcome.results.map((r) => r.text), check.mustContain) : !outcome.empty;
      if (pass) passed++;

      console.log(`${pass ? "✓" : "✗"} Q: ${check.question}`);
      if (outcome.empty) console.log("    (no memories returned)");
      outcome.results.forEach((r, i) => {
        console.log(`    ${i + 1}. [distance ${r.distance.toFixed(3)}] ${r.text}`);
        console.log(`       blob=${r.blobId}`);
      });
      records.push({ ...check, pass, total: outcome.total, results: outcome.results });
    }

    console.log(`\n${passed}/${checks.length} recall checks passed.`);
    const path = writeReport("recall", { ranAt: new Date().toISOString(), pid: process.pid, serverUrl: conn.serverUrl, network: conn.network, namespace: conn.namespace, passed, total: checks.length, records });
    console.log(`report: ${path}`);
    return passed === checks.length ? 0 : 1;
  } finally {
    service.close();
  }
});
