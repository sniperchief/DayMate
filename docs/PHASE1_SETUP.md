# DayMate Phase 1 — Setup & Mainnet verification guide

Phase 1 proves that DayMate can **write memories to Walrus Memory on Mainnet and recall them in natural language**. There is no UI yet; everything runs from the command line.

## What needs what

| Command | Network | Real credentials | Writes to Mainnet |
|---|---|---|---|
| `npm test` | no | no (uses labelled mocks) | no |
| `npm run typecheck` | no | no | no |
| `npm run memory:health -- --no-auth` | yes | env must be set and valid, but is not sent | no |
| `npm run memory:health` | yes | **yes** | no |
| `npm run memory:seed` | yes | **yes** | **yes** (deduplicated) |
| `npm run memory:recall` | yes | **yes** | no |
| `npm run memory:verify` | yes | **yes** | no new blobs (deduplicated re-check) |

There is **no mock or offline mode** in the CLI. If Mainnet is unreachable, or the credentials are wrong, the commands fail with an explicit error code. They never switch to testnet or local storage.

## 1. Prerequisites

- Node.js ≥ 20.12 (developed on Node 24)
- `npm install`

## 2. Create Walrus Memory Mainnet credentials

You need two values from the **Mainnet** dashboard at **https://memory.walrus.xyz** (the testnet dashboard is a different site, `dev.memwal.ai`, and its keys will not work on Mainnet):

1. Open https://memory.walrus.xyz and sign in or connect your Sui wallet.
2. Create a Walrus Memory account if you do not have one yet.
3. Copy the **account ID**. This is the account's Sui object ID (`0x…`). It is *not* your wallet address.
4. Create or generate a **delegate key** for the account, and make sure it is registered on the account. The relayer checks this on every request.
5. Copy the delegate key's **private key** and store it safely. It is usually shown only once. This is a *delegate* key: never use your wallet's own private key.

The dashboard labels may differ slightly from these steps. You are looking for two things: the account object ID, and a registered delegate private key (Ed25519, 64 hex characters or `suiprivkey1…`).

## 3. Configure `.env` (locally only)

```bash
cp .env.example .env
```

Edit `.env`:

```
MEMWAL_ACCOUNT_ID=0x…           # account object ID
MEMWAL_PRIVATE_KEY=…            # delegate private key
MEMWAL_SERVER_URL=https://relayer.memory.walrus.xyz
MEMWAL_NAMESPACE=daymate-phase1
```

`.env` is git-ignored. Never commit it, paste it into chats, or give these variables a `NEXT_PUBLIC_` prefix.

## 4. Mainnet health check

```bash
npm run memory:health
```

The check:

- calls `GET /health` and requires `status: ok`;
- calls `GET /config` and requires `network: mainnet`;
- reports whether the relayer accepts writes;
- makes an **authenticated** inventory call (`listMemories`), so a wrong account ID or an unregistered delegate key fails here with `AUTH_REJECTED`.

## 5. Write the seed memories (≥ 10)

```bash
npm run memory:seed
```

- Writes 12 fictional memories about "Margaret Ellison", defined in [`src/seed/manifest.ts`](../src/seed/manifest.ts).
- A memory counts only after `waitForRememberJob` returns a `done` job with a Walrus `blob_id`. Pending, failed and timed-out jobs are reported but **not counted**.
- After the writes, the script cross-checks every confirmed blob ID against the relayer's inventory for the namespace.
- **Re-running is safe.** Writes use the relayer's `dedupe: true`, so identical text in the namespace resolves to the existing memory instead of creating a duplicate blob. `.daymate/seed-ledger.json` is a local audit log only. It is used to resume pending jobs and is never treated as proof.
- The report is saved to `.daymate/reports/seed-*.json`.

## 6. Recall tests (fresh process)

```bash
npm run memory:recall
npm run memory:recall -- "Who brings Margaret lemon drizzle cake?"
```

Each run is a new Node process with a newly created SDK client, so the results cannot come from in-memory state. Answers come only from Walrus Memory. The manifest is used only to grade whether the expected phrases appear in the top 3 results. The report is saved to `.daymate/reports/recall-*.json`.

## 7. Independent verification

```bash
npm run memory:verify
```

This ignores the local ledger. It re-resolves every manifest entry through the relayer (deduplicated, so no new blobs) and checks that each blob ID is present in the namespace inventory.

## Error codes

| Code | Meaning / action |
|---|---|
| `CONFIG_MISSING` / `CONFIG_INVALID` | Fix `.env` (see §3). |
| `AUTH_REJECTED` | Wrong account ID, unregistered or wrong-network delegate key, or clock skew of more than 5 minutes. |
| `NOT_MAINNET` | `MEMWAL_SERVER_URL` does not point to a Mainnet relayer. |
| `RELAYER_UNAVAILABLE` | Network down, DNS failure, or relayer 5xx. Retry. |
| `TIMEOUT` | Request deadline exceeded. Retry. |
| `WRITES_PAUSED` | The relayer has paused writes. Nothing was stored. |
| `WRITE_PENDING` | The job did not finish in time. **Not counted.** Re-run the seed to resume it. |
| `WRITE_FAILED` / `WRITE_UNCONFIRMED` | Not stored. Retry. |
| `RATE_LIMITED` | Wait and retry. |
| `SDK_INCOMPATIBLE` | Upgrade `@mysten-incubation/memwal`. |
