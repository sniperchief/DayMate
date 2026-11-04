/**
 * Mainnet health check. Requires network access and real credentials
 * (the credential check makes an authenticated call).
 *
 *   npm run memory:health
 *   npm run memory:health -- --no-auth   # relayer + Mainnet check only, still validates env
 */
import { describeConfig } from "../src/lib/memory";
import { createService, main } from "./_cli";

main(async () => {
  const verifyCredentials = !process.argv.includes("--no-auth");
  const service = createService();
  try {
    console.log("DayMate · Walrus Memory health check");
    console.log("config:", describeConfig({ ...service.config, privateKey: "" }));
    const report = await service.checkConnection({ verifyCredentials });
    console.log(`✓ relayer ${report.serverUrl} status=${report.relayerStatus} mode=${report.mode} relayerVersion=${report.relayerVersion} api=${report.apiVersion}`);
    console.log(`✓ network=${report.network}`);
    console.log(`${report.writeReady ? "✓" : "✗"} writes=${report.writes ?? "unknown"} write_ready=${report.writeReady}`);
    if (report.credentialsVerified) {
      console.log(`✓ credentials accepted (authenticated call succeeded); memories in namespace "${report.namespace}": ${report.memoriesInNamespace}`);
    } else {
      console.log("· credentials not checked (--no-auth)");
    }
    return report.writeReady ? 0 : 2;
  } finally {
    service.close();
  }
});
