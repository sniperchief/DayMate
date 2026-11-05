# DayMate Phase 3B: Sui Mainnet anchoring + Tatum verification

When a memory's current version is confirmed on Walrus, DayMate can publish a **salted SHA-256 commitment** of that version on Sui Mainnet. **Tatum** then independently checks that commitment. Only a 32-byte hash and a schema version number go on chain. Memory text, names, dates, IDs and Walrus blob IDs are never published.

> This is a hash commitment. It is **not** zero-knowledge, and it is **not** encryption.

Anchoring is **off by default** (`SUI_ANCHOR_ENABLED=false`). Turn it on for real records only after the synthetic Mainnet anchor below has been verified through Tatum.

## How it works

```
memory saved ─► Walrus write confirmed (status "stored", current blob)
                 │  (Phase 2, unchanged)
                 ▼
     eligibility check ── current Postgres row, own caregiver, stored, current blob,
                 │         content hash matches (same rules as Ask DayMate)
                 ▼
     memory_anchors row (one per memory_id + walrus_blob_id)
     memory_anchor_secrets: canonical payload + fresh 32-byte salt + commitment  (server-only)
                 ▼
     build + sign  daymate_anchor::anchor::commit(commitment, schema_version)
     save digest + signed bytes FIRST (write-ahead), then submit ─► Sui full node (gRPC)
                 ▼
     status "submitted"  (NOT verified)
                 ▼
     Tatum gRPC LedgerService/GetTransaction(digest) ─► check every field ─► "verified"
```

| Layer | Code |
|---|---|
| Move package | `move/daymate_anchor/` (`anchor::commit` emits `MemoryCommitted { commitment: vector<u8>, schema_version: u16 }`) |
| Commitment | `src/lib/sui-anchor/commitment.ts` |
| Eligibility | `src/lib/sui-anchor/eligibility.ts` |
| Lifecycle, idempotency, retries | `src/lib/sui-anchor/anchor.ts` |
| Submission (signing wallet, full node) | `src/lib/sui-anchor/sui-chain.ts` |
| Verification rules (provider-agnostic) | `src/lib/sui-anchor/verify.ts` |
| Tatum transport | `src/lib/sui-anchor/tatum.ts` |
| Supabase store / wiring | `src/lib/sui-anchor/supabase-store.ts`, `src/lib/sui-anchor/server.ts` |
| Hook after a Walrus write | `src/lib/walrus-sync/server.ts` (`anchorAfterStored`) |
| UI | `SuiStatus` in `src/components/ui.tsx`, shown on `/memories` |
| Schema | `supabase/migrations/20261104120000_phase3b_sui_anchors.sql` |

## Commitment format (schema version 1)

```
commitment = SHA-256(
  u32be(len(domain)) || domain            domain = "daymate/memory-commitment"
  || u16be(schema_version)                1
  || u32be(len(payload)) || payload       canonical JSON, UTF-8
  || salt                                 32 random bytes (crypto.randomBytes), new per memory version
)
```

The length prefixes keep the concatenation unambiguous. The canonical payload is JSON with **exactly these keys, in this order, and no whitespace**. Every value is format-checked first:

```json
{"memory_id":"<lowercase uuid>","version":1,"walrus_blob_id":"<blob id>","walrus_content_hash":"<sha256 hex>"}
```

`walrus_content_hash` is `walrus_records.content_hash`, the SHA-256 of the exact memory text stored on Walrus. The commitment therefore binds the memory content, its Walrus blob and its version, without copying raw text into another table. To prove a commitment later, take the payload and salt from `memory_anchor_secrets`, recompute the hash, and check `walrus_content_hash` against the Walrus blob.

## Statuses

| Walrus (Phase 2, unchanged) | Sui (Phase 3B) |
|---|---|
| Saving · Stored · Failed | Not anchored · Pending · Verified · Failed |

The two are independent. A memory can be *Stored on Walrus* while its Sui anchor is *Pending* or *Failed*.

| `memory_anchors.status` | Meaning | UI |
|---|---|---|
| `pending` | Row created, transaction not yet sent, **or** sent with an unknown outcome (digest saved) | Sui anchor pending |
| `submitted` | The submission node reported successful execution. **Not verified.** | Sui anchor pending ("waiting for independent verification") |
| `verified` | Tatum returned the transaction and **all** checks passed | ✓ Verified on Sui + short digest + Suiscan link |
| `failed` | Aborted on chain, transaction proven dead, or a verification mismatch | Sui anchor failed + Retry |

The UI shows the anchor for the memory's **current** Walrus blob. Anchors of earlier versions stay as history. Their on-chain events are immutable and are never described as deleted.

## Tatum verification

Tatum's live gateway manifest, checked on 2026-11-04, determines which interface DayMate uses:

- `https://sui-mainnet-grpc.gateway.tatum.io/_methods` lists `sui.rpc.v2.LedgerService/GetTransaction`. **DayMate uses this.** It goes through `SuiGrpcClient` (`@mysten/sui` 2.38.0) over **native HTTP/2 gRPC** (`@protobuf-ts/grpc-transport` 2.11.1 + `@grpc/grpc-js` 1.14.6) with the `x-api-key` header. Tatum's gateway returns the gRPC status in HTTP/2 trailers, which the SDK's default fetch-based gRPC-web transport cannot read (it reports `INTERNAL: missing status`). The native transport reads the real status, so nothing is assumed.
- Verified live on 2026-11-04 with `npm run sui:preflight`: Tatum returned a real Mainnet transaction whose digest, status, and event types and BCS bytes matched the Sui full node exactly. JSON-RPC `sui_getTransactionBlock` on `sui-mainnet.gateway.tatum.io` returned **HTTP 404**.
- `https://sui-mainnet.gateway.tatum.io/_methods` now lists **GraphQL only**. `docs.tatum.io/reference/rpc-sui` still lists JSON-RPC `sui_getTransactionBlock`, but the live manifest does not, which matches Sui's JSON-RPC decommission. `npm run sui:preflight` records whether that JSON-RPC method still answers.

A transaction counts as **verified** only when all of these hold:

1. Tatum returns the transaction (not-found → stays *submitted*, retryable).
2. The returned digest equals the recorded digest.
3. Execution succeeded (both `status` and `effects.status`).
4. Exactly one event of type `<package>::anchor::MemoryCommitted`. A look-alike type from another package is rejected.
5. The event's `packageId` is the configured package and its `module` is `anchor`.
6. The event's `sender` is the DayMate project wallet. Anyone can call `commit`, so this check matters.
7. The event **BCS bytes** decode to exactly `{ commitment, schema_version }` with no trailing bytes. The commitment equals the one in `memory_anchor_secrets`.
8. `schema_version` matches.

DayMate decodes BCS rather than event JSON, because the SDK warns that JSON shapes differ between APIs. In gRPC, `vector<u8>` shows up as base64. Rate limits (`RESOURCE_EXHAUSTED`/429), timeouts, RPC errors, auth errors and malformed responses are **retryable**: the anchor stays *submitted* and is never marked verified. Mismatches are definitive: the anchor becomes *failed*.

## Idempotency and retries

- One anchor row per `(memory_id, walrus_blob_id)` and one per `(memory_id, version)`. Commitments are unique.
- The salt and commitment are fixed when the row is created and reused on every retry.
- **Write-ahead.** The digest and signed bytes are saved in one row update *before* submission. The digest is computed from the bytes (`Transaction.from(bytes).getDigest()`).
- When a digest exists, the service first **investigates** it on chain, then acts:
  - **Found and successful:** verify only. Never re-sign.
  - **Found and aborted:** *failed*. A new transaction is built only on an explicit Retry, which is safe because an aborted transaction emits no event.
  - **Not found but still valid:** re-send the **identical signed bytes**. It is the same digest, and Sui executes a digest at most once.
  - **Not found and provably dead:** build a new transaction. "Provably dead" means its gas coin has moved to a newer version or no longer exists, or its expiration epoch has passed.
  - **Lookup itself fails:** do nothing. Report "could not check".
- A 2-minute lease (`locked_until`) stops two workers from advancing the same row at once. After 5 transaction builds, the anchor becomes *failed* with "Too many attempts".

## Privacy and secrets

- **Published on chain:** a 32-byte commitment and a `u16` schema version. The transaction sender is the project wallet. Gas data is public by nature.
- **Never published:** memory text, names, relationships, dates of birth, Supabase IDs, Walrus blob IDs, photos, routines.
- **`memory_anchor_secrets`** holds the salt, payload and commitment. RLS is on with **no policies**, and nothing is granted to `anon` or `authenticated`. Only the service role can reach it.
- **`memory_anchors`:** caregivers get **column-level** `SELECT` on status fields, and only for their own rows. The signed-transaction columns (`tx_bytes`, `tx_signature`) and the lease column are not readable, and nothing is writable. `create_memory_anchor()` can be executed by the service role only.
- **Deleting a memory** cascades to its anchors and **salt**. The on-chain event remains, but without the salt it can no longer be linked to the memory. DayMate never claims the event was removed.
- **Signing key:** one dedicated project wallet (`SUI_ANCHOR_PRIVATE_KEY`), server-only, never logged or returned. The server refuses to start anchoring if this key equals the Walrus delegate key. Logs contain only memory IDs, statuses and digests.

## Setup (local, by you; never paste secrets into chat)

1. **Apply the migration.** Run `supabase/migrations/20261104120000_phase3b_sui_anchors.sql` in the Supabase SQL editor, then `npm run sui:rls-check`.
2. **Tatum key.** Create a free key at https://dashboard.tatum.io and put it in `.env` as `TATUM_API_KEY`.
3. **Project wallet.** Create a new key locally (`sui keytool generate ed25519`), or use a fresh wallet export. Put the `suiprivkey1…` value in `.env` as `SUI_ANCHOR_PRIVATE_KEY`. Fund the printed address with a small amount of SUI: 0.2 SUI is ample, see the gas notes below.
4. Run `npm run sui:preflight`. It is read-only. It checks Tatum against a real Mainnet transaction and shows the wallet's address and balance.
5. **Publish the package** (needs separate approval; see the deployment plan in the Phase 3B report). Then set `SUI_ANCHOR_PACKAGE_ID` and re-run `npm run sui:preflight`, which dry-runs `anchor::commit` and reports its gas.
6. **First Mainnet anchor, synthetic data:** `npm run sui:anchor-synthetic -- --confirm-mainnet`. The evidence report goes to `.daymate/reports/` (git-ignored).
7. Only after step 6 is verified through Tatum, set `SUI_ANCHOR_ENABLED=true`.

## Mainnet evidence (2026-11-04)

| | |
|---|---|
| Package (immutable, no `UpgradeCap`) | `0xbb11a10bd82cd2b3bda6e024420fa79acacb0cc10247eeaa011043aad401cca0` |
| Publish tx | [`Gbqe5Vx2iDe4TnzP8TsKPV9mvNUVGjFjx9tcTtWH2ef7`](https://suiscan.xyz/mainnet/tx/Gbqe5Vx2iDe4TnzP8TsKPV9mvNUVGjFjx9tcTtWH2ef7). Cost 0.0045 SUI. |
| Project wallet (sender) | `0x16fd44f81dbc8fc2d341bfa5e4249d9b15f9d45a1f8ed4c04b3bc891e0a82dd0` |
| First anchor, **synthetic data** | [`ck9ZMSUioxboCqF64ZT88FZNJCrY6V6Du2mphPph5Mo`](https://suiscan.xyz/mainnet/tx/ck9ZMSUioxboCqF64ZT88FZNJCrY6V6Du2mphPph5Mo) |
| Commitment | `b0c35960d23122a1a40f5da4c4beb598da149ce2c2eff322b3b508f55ea932d1`, schema 1 |
| Tatum verification | **Verified** on the first attempt. All checks passed: digest, success, package/module/event, sender, commitment, schema. |

An independent audit after the run confirmed all of the following:

- The commitment recomputes from the saved synthetic payload and salt.
- The Sui full node shows exactly one `MemoryCommitted` event, with 35 BCS bytes: a 32-byte commitment plus `schema_version` 1.
- The transaction has exactly two pure inputs (33 bytes and 2 bytes) and one call, to `anchor::commit`.
- None of the private values (payload, memory ID, blob ID, content hash, salt) appear in the on-chain transaction bytes.
- A second Tatum verification also returned `ok`.

The evidence report is in `.daymate/reports/` (git-ignored).

## Gas (measured on localnet, 2026-11-04)

| Transaction | Computation | Storage cost | Storage rebate | Net |
|---|---|---|---|---|
| Publish `daymate_anchor` | 1,000,000 MIST at localnet RGP 1000 | 7,030,000 | 4,939,506 | ≈ 0.0031 SUI |
| One `anchor::commit` | 1,000,000 MIST at localnet RGP 1000 | 988,000 | 987,901 | ≈ 0.0010 SUI |

Mainnet's reference gas price was **100 MIST** when measured (localnet's was 1000). Computation on Mainnet should therefore be about 10× lower, so expect roughly **0.0022 SUI to publish** and **0.0001 to 0.001 SUI per anchor**. The gas *budget* must cover cost before rebate (about 0.008 SUI for publish), so 0.2 SUI covers publishing plus well over a hundred anchors. `npm run sui:preflight` dry-runs `commit` on Mainnet and reports the real figure.

## Commands

```bash
npm run move:test             # Move unit tests (needs the Sui CLI)
npm run move:build
npm run sui:localnet-e2e -- bytecode.json   # LOCALNET: real node, real code path (not Mainnet, not Tatum)
npm test                      # includes tests/phase3b (labelled MOCKS — not Mainnet evidence)
npm run sui:rls-check         # LIVE Supabase: anchor tables' RLS
npm run sui:preflight         # LIVE read-only: Tatum, wallet, package, dry run
npm run sui:anchor-synthetic -- --confirm-mainnet   # LIVE Mainnet write (synthetic)
```

## References used

- Sui Move and events: https://docs.sui.io/develop/write-move, https://docs.sui.io/develop/accessing-data/using-events, https://move-book.com/programmability/events (edition `2024`; implicit system dependencies since CLI 1.45; `event::emit` needs `copy + drop`; test-only `event::events_by_type` and `event::num_events`)
- gRPC migration: https://docs.sui.io/develop/accessing-data/grpc/grpc-migration-cookbook
- Transaction signing: https://docs.sui.io/develop/transactions/transaction-auth/auth-overview, https://sdk.mystenlabs.com/sui/transactions/signing-and-execution
- Tatum: https://docs.tatum.io/reference/rpc-sui, https://docs.tatum.io/docs/sui-migration-guide-from-json-rpc-to-grpc, plus the live gateway `/_methods` manifests
- Versions: Sui CLI `mainnet-v1.82.3`, `@mysten/sui` 2.38.0, `@protobuf-ts/grpc-transport` 2.11.1, `@grpc/grpc-js` 1.14.6

## Known limitations

- **Tatum indexing lag.** Verification polls for about 10 seconds. If Tatum has not indexed the transaction yet, the anchor stays *submitted*, and "Check again" verifies it later. There is no background re-verification job.
- **The anchor runs in `after()`.** It runs after the Walrus write, in the same request lifecycle. If the server process dies mid-way, the row stays *pending* or *submitted*, and the UI's Retry or "Check again" resumes it safely.
- **Existing stored memories** are not back-filled automatically. Use "Anchor on Sui" on each memory.
- **Public full node for submission.** It is rate-limited. Set `SUI_RPC_URL` to a dedicated provider for heavier use. Verification stays on Tatum either way.
- **Upgrade cap.** `sui client publish` creates an `UpgradeCap` owned by the publisher. The deployment plan recommends making the package immutable afterwards.
