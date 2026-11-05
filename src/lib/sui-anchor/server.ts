import "server-only";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { adminClient } from "../supabase/admin";
import type { Anchorer } from "../../server/ports";
import { anchorMemory, type AnchorDeps } from "./anchor";
import { anchoringEnabled, loadAnchorConfig } from "./config";
import { loadSigner, submissionClient, suiChain } from "./sui-chain";
import { supabaseAnchorStore } from "./supabase-store";
import { tatumClient, tatumTransactionSource } from "./tatum";

/** Production wiring: one set of clients per server process. */
let deps: AnchorDeps | undefined;

function anchorDeps(): AnchorDeps {
  if (deps) return deps;
  const config = loadAnchorConfig(process.env);
  const signer = loadSigner(config.privateKey);
  assertNotWalrusDelegate(signer);
  deps = {
    store: supabaseAnchorStore(adminClient()),
    chain: suiChain({ client: submissionClient(config.submitRpcUrl), signer, packageId: config.packageId }),
    verifier: tatumTransactionSource(tatumClient(config.tatumApiKey, config.tatumGrpcUrl)),
    packageId: config.packageId,
  };
  return deps;
}

/** The project wallet must not be the Walrus delegate key (in any encoding). */
function assertNotWalrusDelegate(signer: Ed25519Keypair): void {
  const raw = process.env.MEMWAL_PRIVATE_KEY?.trim();
  if (!raw) return;
  let delegate: Ed25519Keypair | undefined;
  try {
    delegate = raw.startsWith("suiprivkey1")
      ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(raw).secretKey)
      : Ed25519Keypair.fromSecretKey(Uint8Array.from(Buffer.from(raw.replace(/^0x/i, ""), "hex")));
  } catch {
    return;
  }
  if (delegate.toSuiAddress() === signer.toSuiAddress()) throw new Error("SUI_ANCHOR_PRIVATE_KEY must not be the Walrus delegate key.");
}

function log(memoryId: string, status: string, digest?: string | null): void {
  // IDs and digests only — never memory text, salts or keys.
  console.info(`[daymate] sui anchor memory:${memoryId} → ${status}${digest ? ` tx=${digest}` : ""}`);
}

export const suiAnchorer: Anchorer = {
  get enabled() {
    return anchoringEnabled(process.env);
  },
  async anchor(req, opts) {
    if (!anchoringEnabled(process.env)) return { status: "disabled" };
    const outcome = await anchorMemory(anchorDeps(), req, opts);
    log(req.memoryId, outcome.status, "digest" in outcome ? outcome.digest : undefined);
    return outcome;
  },
};
