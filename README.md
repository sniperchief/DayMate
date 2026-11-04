# DayMate

DayMate is a memory companion for elderly people and their family caregivers. It helps people recall familiar faces, daily routines, activities and important personal events. Family caregivers will eventually manage this information.

DayMate's memory layer is **[Walrus Memory](https://docs.wal.app/walrus-memory/sdk/quick-start) on Mainnet**, built for the Tatum × Walrus *Total Recall* hackathon.

## Status: Phase 1 — foundation + Walrus Memory Mainnet

Phase 1 is backend-only. It contains:

- a server-only memory service (`src/lib/memory`) built on the official SDK [`@mysten-incubation/memwal`](https://www.npmjs.com/package/@mysten-incubation/memwal);
- the production Mainnet relayer `https://relayer.memory.walrus.xyz`, verified at runtime via `GET /config` → `network: "mainnet"`;
- a dedicated namespace (`MEMWAL_NAMESPACE`, e.g. `daymate-phase1`);
- CLI commands for the health check, a deduplicated seed of ≥ 10 memories, fresh-process recall, and independent verification;
- unit tests that use clearly labelled mocks.

The dashboard, authentication, profiles, reminders, chat, Tatum RPC, contracts and AI features come in later phases.

## Quick start

```bash
npm install
cp .env.example .env          # then fill in real Mainnet credentials — see docs/PHASE1_SETUP.md
npm test                      # unit tests (mocked, offline)
npm run memory:health         # Mainnet relayer + credential check
npm run memory:seed           # write the seed memories (confirmed writes only)
npm run memory:recall         # natural-language recall in a fresh process
npm run memory:verify         # independent relayer-only verification
```

See **[docs/PHASE1_SETUP.md](docs/PHASE1_SETUP.md)** for how to create credentials, which commands need network access or credentials, and what each error code means.

## Layout

```
src/lib/memory/      server-only Walrus Memory service
  config.ts          env validation (fails loudly; no fallbacks)
  errors.ts          SDK/HTTP error → MemoryServiceError mapping + key redaction
  memory-service.ts  health/Mainnet check, confirmed write, recall, inventory
src/seed/            deterministic seed manifest, ledger, seed runner
scripts/             CLI entry points (health, seed, recall, verify)
tests/               vitest unit tests (mocked client; not Mainnet evidence)
docs/                setup guide
```

The `src/lib` layout is meant to drop into a future Next.js app (`app/` route handlers can import `src/lib/memory`). The memory service throws if it is ever loaded in a browser.

## Security

- Credentials come only from environment variables. `.env` is git-ignored, and `.env.example` contains placeholders only.
- Use a **delegate key**, never the account owner's wallet key.
- The key is never logged, returned or serialized. Error messages are scrubbed of the key as a final safeguard.
- No mock or offline mode can be mistaken for Mainnet: the CLI always uses the real relayer and fails if it is not on Mainnet.
