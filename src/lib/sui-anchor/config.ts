import { isValidSuiObjectId, normalizeSuiObjectId } from "@mysten/sui/utils";
import { TATUM_SUI_MAINNET_GRPC } from "./tatum";
import { SUI_MAINNET_FULLNODE } from "./sui-chain";

/**
 * Sui anchoring configuration (all SERVER-ONLY; never NEXT_PUBLIC_).
 * Anchoring is OFF unless SUI_ANCHOR_ENABLED=true, and stays off for normal
 * records until the first synthetic Mainnet anchor has been verified.
 */

type Env = Record<string, string | undefined>;

export interface AnchorConfig {
  packageId: string;
  /** Never log, serialise or return this. */
  privateKey: string;
  submitRpcUrl: string;
  tatumApiKey: string;
  tatumGrpcUrl: string;
}

export class AnchorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorConfigError";
  }
}

function read(env: Env, name: string): string | undefined {
  const v = env[name]?.trim();
  return v && !/YOUR_/.test(v) ? v : undefined;
}

export function anchoringEnabled(env: Env = process.env): boolean {
  return read(env, "SUI_ANCHOR_ENABLED") === "true";
}

function httpsUrl(env: Env, name: string, fallback: string): string {
  const raw = read(env, name) ?? fallback;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AnchorConfigError(`${name} is not a valid URL.`);
  }
  if (u.protocol !== "https:") throw new AnchorConfigError(`${name} must use https.`);
  return raw.replace(/\/+$/, "");
}

/** Tatum settings only (for read-only verification and the preflight probe). */
export function loadTatumConfig(env: Env = process.env): Pick<AnchorConfig, "tatumApiKey" | "tatumGrpcUrl"> {
  const tatumApiKey = read(env, "TATUM_API_KEY");
  if (!tatumApiKey) throw new AnchorConfigError("Missing TATUM_API_KEY. See docs/PHASE3B_SUI.md.");
  return { tatumApiKey, tatumGrpcUrl: httpsUrl(env, "TATUM_SUI_GRPC_URL", TATUM_SUI_MAINNET_GRPC) };
}

export function loadAnchorConfig(env: Env = process.env): AnchorConfig {
  const missing = ["SUI_ANCHOR_PACKAGE_ID", "SUI_ANCHOR_PRIVATE_KEY", "TATUM_API_KEY"].filter((n) => !read(env, n));
  if (missing.length) throw new AnchorConfigError(`Missing Sui anchoring configuration: ${missing.join(", ")}. See docs/PHASE3B_SUI.md.`);

  const packageId = read(env, "SUI_ANCHOR_PACKAGE_ID")!;
  if (!isValidSuiObjectId(packageId)) throw new AnchorConfigError("SUI_ANCHOR_PACKAGE_ID is not a valid Sui object ID.");

  const privateKey = read(env, "SUI_ANCHOR_PRIVATE_KEY")!;
  // Deliberately does not echo the value.
  if (!/^suiprivkey1[0-9a-z]+$/.test(privateKey)) throw new AnchorConfigError("SUI_ANCHOR_PRIVATE_KEY must be a suiprivkey1… Ed25519 key.");
  const memwal = env.MEMWAL_PRIVATE_KEY?.trim();
  if (memwal && memwal === privateKey) throw new AnchorConfigError("SUI_ANCHOR_PRIVATE_KEY must be a dedicated project wallet, not the Walrus delegate key.");

  return {
    packageId: normalizeSuiObjectId(packageId),
    privateKey,
    submitRpcUrl: httpsUrl(env, "SUI_RPC_URL", SUI_MAINNET_FULLNODE),
    ...loadTatumConfig(env),
  };
}
