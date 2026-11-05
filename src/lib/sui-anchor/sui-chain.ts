import { ObjectError, TransactionError } from "@mysten/sui/client";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { COMMIT_FUNCTION, EVENT_MODULE } from "./commitment";

/**
 * Submission side: builds, signs and sends anchor transactions with the
 * single dedicated DayMate project wallet. The key is loaded from the
 * environment by the caller, used only inside this module, and never logged
 * or returned.
 *
 * Submission and verification deliberately use different providers: this
 * module talks to the configured Sui full node; verification goes to Tatum.
 */

export interface SignedTx {
  digest: string;
  /** base64 BCS TransactionData (contains only the commitment, schema version, sender and gas data). */
  bytes: string;
  signature: string;
}

export type ExecuteResult = { executed: true; success: boolean; error: string | null };

export type LookupResult = { found: false } | { found: true; success: boolean };

export interface AnchorChain {
  readonly signerAddress: string;
  buildAndSign(commitment: Uint8Array, schemaVersion: number): Promise<SignedTx>;
  /** Resolves when the node reports execution. THROWS when the outcome is unknown (timeout, network). */
  execute(tx: SignedTx): Promise<ExecuteResult>;
  /** Throws on transport errors (unknown), never guesses. */
  lookup(digest: string): Promise<LookupResult>;
  /** True only when the signed transaction provably can never execute (its gas was consumed elsewhere or it expired). */
  isDead(tx: SignedTx): Promise<boolean>;
}

export const SUI_MAINNET_FULLNODE = "https://fullnode.mainnet.sui.io:443";

export function loadSigner(privateKey: string): Ed25519Keypair {
  const { scheme, secretKey } = decodeSuiPrivateKey(privateKey);
  if (scheme !== "ED25519") throw new Error("SUI_ANCHOR_PRIVATE_KEY must be an Ed25519 suiprivkey1… key");
  return Ed25519Keypair.fromSecretKey(secretKey);
}

export function suiChain(opts: { client: SuiGrpcClient; signer: Ed25519Keypair; packageId: string; timeoutMs?: number }): AnchorChain {
  const { client, signer, packageId } = opts;
  const timeout = () => AbortSignal.timeout(opts.timeoutMs ?? 30_000);
  const address = signer.toSuiAddress();

  return {
    signerAddress: address,

    async buildAndSign(commitment, schemaVersion) {
      const tx = new Transaction();
      tx.setSender(address);
      tx.moveCall({
        target: `${packageId}::${EVENT_MODULE}::${COMMIT_FUNCTION}`,
        arguments: [tx.pure.vector("u8", commitment), tx.pure.u16(schemaVersion)],
      });
      const bytes = await tx.build({ client });
      const { signature } = await signer.signTransaction(bytes);
      const digest = await Transaction.from(bytes).getDigest();
      return { digest, bytes: toBase64(bytes), signature };
    },

    async execute(signed) {
      const result = await client.core.executeTransaction({
        transaction: fromBase64(signed.bytes),
        signatures: [signed.signature],
        include: { effects: true },
        signal: timeout(),
      });
      const t = result.Transaction ?? result.FailedTransaction;
      if (t.digest !== signed.digest) throw new Error("node returned a different digest");
      return { executed: true, success: result.$kind === "Transaction" && t.status.success, error: t.status.success ? null : (t.status.error?.message ?? "execution failed").slice(0, 200) };
    },

    async lookup(digest) {
      try {
        const result = await client.core.getTransaction({ digest, include: { effects: true }, signal: timeout() });
        const t = result.Transaction ?? result.FailedTransaction;
        return { found: true, success: result.$kind === "Transaction" && t.status.success };
      } catch (err) {
        if (err instanceof TransactionError && err.reason === "notFound") return { found: false };
        throw err;
      }
    },

    async isDead(signed) {
      const data = Transaction.from(fromBase64(signed.bytes)).getData();
      const payment = data.gasData.payment ?? [];
      for (const coin of payment) {
        try {
          const { object } = await client.core.getObject({ objectId: coin.objectId, signal: timeout() });
          if (BigInt(object.version) > BigInt(coin.version)) return true; // gas coin moved on: this tx can never run
        } catch (err) {
          if (err instanceof ObjectError) return true; // gas coin no longer exists
          throw err;
        }
      }
      const exp = data.expiration;
      const maxEpoch = exp?.$kind === "Epoch" ? exp.Epoch : exp?.$kind === "ValidDuring" ? exp.ValidDuring.maxEpoch : null;
      if (maxEpoch !== null && maxEpoch !== undefined) {
        const { systemState } = await client.core.getCurrentSystemState({ signal: timeout() });
        if (BigInt(systemState.epoch) > BigInt(maxEpoch)) return true;
      }
      return false;
    },
  };
}

export function submissionClient(baseUrl = SUI_MAINNET_FULLNODE): SuiGrpcClient {
  return new SuiGrpcClient({ network: "mainnet", baseUrl });
}
