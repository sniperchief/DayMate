import { MemoryServiceError } from "./errors";

/** Official Walrus Memory production Mainnet relayer. */
export const MAINNET_RELAYER_URL = "https://relayer.memory.walrus.xyz";

export interface MemoryConfig {
  accountId: string;
  /** Delegate private key. Never log, serialize or return this value. */
  privateKey: string;
  serverUrl: string;
  namespace: string;
}

type Env = Record<string, string | undefined>;

const REQUIRED = ["MEMWAL_ACCOUNT_ID", "MEMWAL_PRIVATE_KEY", "MEMWAL_NAMESPACE"] as const;

const ACCOUNT_ID_RE = /^0x[0-9a-fA-F]{1,64}$/;
const HEX_KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/;
const SUI_PRIVKEY_RE = /^suiprivkey1[0-9a-z]+$/;
const NAMESPACE_RE = /^[a-z0-9][a-z0-9._-]*$/;
const PLACEHOLDER_RE = /^(YOUR_|0xYOUR_|<|changeme)/i;

function invalid(message: string, hint: string): MemoryServiceError {
  return new MemoryServiceError("CONFIG_INVALID", message, hint);
}

/**
 * Read and validate Walrus Memory configuration from environment variables.
 * Fails loudly; there is no fallback to testnet, local storage or a mock.
 */
export function loadMemoryConfig(env: Env = process.env): MemoryConfig {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new MemoryServiceError(
      "CONFIG_MISSING",
      `Missing required environment variable(s): ${missing.join(", ")}.`,
      "Copy .env.example to .env and fill in your Walrus Memory account ID and delegate key from https://memory.walrus.xyz. See docs/PHASE1_SETUP.md.",
    );
  }

  const accountId = env.MEMWAL_ACCOUNT_ID!.trim();
  const privateKey = env.MEMWAL_PRIVATE_KEY!.trim();
  const namespace = env.MEMWAL_NAMESPACE!.trim();
  const serverUrl = (env.MEMWAL_SERVER_URL?.trim() || MAINNET_RELAYER_URL).replace(/\/+$/, "");

  if (PLACEHOLDER_RE.test(accountId) || PLACEHOLDER_RE.test(privateKey)) {
    throw invalid(
      "MEMWAL_ACCOUNT_ID or MEMWAL_PRIVATE_KEY still contains the .env.example placeholder.",
      "Replace the placeholders in .env with your real values from https://memory.walrus.xyz.",
    );
  }
  if (!ACCOUNT_ID_RE.test(accountId)) {
    throw invalid(
      "MEMWAL_ACCOUNT_ID is not a valid Sui object ID (expected 0x followed by hex).",
      "Use the Walrus Memory account object ID shown at https://memory.walrus.xyz — not your wallet address or a key.",
    );
  }
  if (!HEX_KEY_RE.test(privateKey) && !SUI_PRIVKEY_RE.test(privateKey)) {
    // Deliberately does not echo the value.
    throw invalid(
      "MEMWAL_PRIVATE_KEY is not a valid Ed25519 delegate key.",
      "Expected 64 hex characters (optionally 0x-prefixed) or a suiprivkey1… string — the delegate key generated at https://memory.walrus.xyz.",
    );
  }
  if (privateKey.replace(/^0x/i, "").toLowerCase() === accountId.replace(/^0x/i, "").toLowerCase()) {
    throw invalid("MEMWAL_PRIVATE_KEY equals MEMWAL_ACCOUNT_ID.", "These are different values; check your .env.");
  }

  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw invalid(`MEMWAL_SERVER_URL is not a valid URL: ${serverUrl}`, `Use ${MAINNET_RELAYER_URL}.`);
  }
  if (url.protocol !== "https:") {
    throw invalid("MEMWAL_SERVER_URL must use https.", `Use ${MAINNET_RELAYER_URL}.`);
  }

  if (!NAMESPACE_RE.test(namespace) || Buffer.byteLength(namespace, "utf8") > 255) {
    throw invalid(
      "MEMWAL_NAMESPACE must be lowercase letters, digits, '.', '_' or '-' (max 255 bytes).",
      "For example: daymate-phase1",
    );
  }
  if (namespace === "default") {
    throw invalid(
      'MEMWAL_NAMESPACE must not be "default".',
      "Use a dedicated DayMate namespace (e.g. daymate-phase1) to isolate DayMate's memories.",
    );
  }

  return { accountId, privateKey, serverUrl, namespace };
}

/** Configuration safe to print: the key is never included. */
export function describeConfig(config: MemoryConfig): Record<string, string> {
  return {
    accountId: config.accountId,
    serverUrl: config.serverUrl,
    namespace: config.namespace,
    privateKey: "[REDACTED]",
  };
}
