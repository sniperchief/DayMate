# DayMate

*A little help remembering what matters.*

DayMate is a memory companion for elderly people and their family caregivers. It helps people recall familiar faces, daily routines, activities and important personal events. Family caregivers keep this information up to date.

DayMate's memory layer is **[Walrus Memory](https://docs.wal.app/walrus-memory/sdk/quick-start) on Mainnet**, built for the Tatum × Walrus *Total Recall* hackathon.

## Status

- **Phase 1 (done): Walrus Memory Mainnet foundation.** A server-only memory service, the CLI health/seed/recall/verify commands, and 12 confirmed Mainnet memories in `daymate-phase1`. See [docs/PHASE1_SETUP.md](docs/PHASE1_SETUP.md).
- **Phase 2: caregiver web app.** It includes:
  - Supabase Auth (email and password);
  - the elder's profile, family and relationships, routines and planned activities, and memories and events;
  - a dashboard with upcoming activities;
  - Postgres with RLS as the source of truth;
  - natural-language memories written to Walrus, with confirmed/pending/failed status and retry.

  See [docs/PHASE2_SETUP.md](docs/PHASE2_SETUP.md).

- **Phase 3A: Ask DayMate.** Ask everyday questions in text. A deterministic router chooses Postgres (family, profile, schedules) or Walrus Memory (personal memories). Only the current, confirmed blobs from this caregiver's own `walrus_records` are accepted. See [docs/PHASE3A_ASK.md](docs/PHASE3A_ASK.md).

Not built yet: Tatum RPC, contracts, AI features, voice, notifications, and medical features.

## Quick start

```bash
npm install
cp .env.example .env     # fill in Walrus + Supabase values (see the setup guides)
# apply supabase/migrations/*.sql in the Supabase SQL editor (docs/PHASE2_SETUP.md)
npm run dev              # http://localhost:3000

npm test                 # unit tests (labelled mocks; offline)
npm run typecheck
npm run app:rls-check    # LIVE: RLS isolation against your Supabase project
npm run app:smoke        # LIVE: app → Supabase → Walrus Mainnet → recall
npm run ask:smoke        # LIVE: Ask DayMate against real Supabase + Walrus Mainnet
npm run memory:health    # Phase 1 Mainnet checks (unchanged)
```

## Layout

```
src/app/                 Next.js App Router
  (auth)/                login, register, auth server actions
  (app)/                 protected pages: dashboard, ask, profile, family, routines, memories
  auth/confirm/          email-confirmation route
src/proxy.ts             session refresh + route guard (Next 16 "proxy")
src/components/          forms and UI pieces
src/lib/memory/          Phase 1 Walrus Memory service (reused, not duplicated)
src/lib/walrus-sync/     DB ↔ Walrus sync: text builders, sync logic, Supabase store
src/lib/ask/             Ask DayMate: question router, Walrus evidence filter/ranking
src/lib/domain/          types, server-side validation (zod), schedule calculation
src/lib/supabase/        user-scoped, admin and env helpers
src/server/              operations, ask (answer construction), repo ports + Supabase adapters
supabase/migrations/     schema, RLS, storage policies
scripts/                 Phase 1 CLI + Phase 2 live verification scripts
tests/                   vitest (Phase 1 + tests/phase2)
```

## Security

- Credentials come only from environment variables. `.env` is git-ignored, and `.env.example` contains placeholders only.
- **Walrus delegate key and Supabase service-role key are server-only.** Neither has a `NEXT_PUBLIC_` prefix, and neither is imported by client components.
- Every table uses RLS (`caregiver_id = auth.uid()`). Composite foreign keys stop rows from being attached to another caregiver's elder.
- Walrus sync status can only be written by the server, so a client cannot mark its own record as "stored".
- Photos are in a private bucket under `<caregiver uid>/…` and are served through short-lived signed URLs.
- No mock or offline mode can be mistaken for Mainnet.
