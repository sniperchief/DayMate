# DayMate Phase 2: setup and verification

Phase 2 is the caregiver web app: Next.js 16, Supabase Auth and Postgres (with RLS), and Walrus Memory on Mainnet through the Phase 1 memory service.

## 1. Create a Supabase project

1. Go to https://supabase.com/dashboard and create a new project. Save the database password somewhere safe; the app doesn't need it.
2. **Project Settings → API Keys** (or **API**). Copy:
   - the **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - the **publishable** key (or the legacy **anon** key) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - the **secret** key (or the legacy **service_role** key) → `SUPABASE_SERVICE_ROLE_KEY`. This one is server-only, so never share it or prefix it with `NEXT_PUBLIC_`.
3. Add these three values to your local `.env`, alongside the existing `MEMWAL_*` values (see `.env.example`).

## 2. Apply the database schema

Open **SQL Editor → New query**, paste the full contents of [`supabase/migrations/20261104000000_phase2_core.sql`](../supabase/migrations/20261104000000_phase2_core.sql), and click **Run**.

This creates the tables, constraints, RLS policies, a trigger that creates a caregiver row on sign-up, and a private `photos` storage bucket with per-caregiver access policies. Run it once only. Running it again will fail on objects that already exist.

## 3. Configure Auth

**Authentication → URL Configuration**:
- **Site URL**: `http://localhost:3000` (or your deployed URL)
- **Redirect URLs**: add `http://localhost:3000/auth/confirm` (and the same path on your deployed URL)

**Authentication → Sign In / Providers → Email**: keep it enabled. **Confirm email** can stay on; new caregivers then confirm through the emailed link, which lands on `/auth/confirm`. Supabase's built-in email sender is rate-limited, so use custom SMTP for anything beyond testing.

## 4. Run the app

```bash
npm install
npm run dev          # http://localhost:3000
```

## 5. Verify

| Command | Needs | What it proves |
|---|---|---|
| `npm test` | nothing | Unit tests with labelled mocks. They check application logic only. |
| `npm run typecheck` | nothing | TypeScript is clean. |
| `npm run build` | nothing | Production build compiles. |
| `npm run app:rls-check` | Supabase keys | **Real RLS** checks: two throwaway caregivers, cross-account reads and writes, storage, forged Walrus status, anonymous access. Deletes its test users afterwards. |
| `npm run app:smoke` | Supabase keys and Walrus credentials | **Real end-to-end** run: app operations → Supabase → **4 Walrus Mainnet writes** → confirmed blob IDs → no duplicate write on an unchanged save → recall from a fresh client. Deletes its DB data afterwards. The fictional Walrus blobs remain. |
| Phase 1 `npm run memory:*` | Walrus credentials | Unchanged; they still use `daymate-phase1`. |

## How Walrus is used

- **Reuse:** the app calls the Phase 1 `MemoryService` (`src/lib/memory`), one instance per server process. The only change to it is an optional per-call `namespace`.
- **Namespaces:** each elder gets their own namespace, `daymate-elder-<uuid>`. It is opaque and contains no names. `daymate-phase1` and its 12 demo memories are never touched.
- **What gets written:** natural-language sentences for:
  - the profile description;
  - each family member and their relationship;
  - each **active** routine;
  - each memory.

  Date of birth, private notes and photos are **never** written to Walrus. Text is SEAL-encrypted by the relayer before upload.
- **Order of operations:**
  1. Postgres is saved first; it is the source of truth.
  2. The server marks the record `pending` in `walrus_records`.
  3. The write runs after the response is sent, via `after()`.
  4. The record becomes `stored` only after the SDK confirms the job is `done` and returns a blob ID.
  5. If the write fails or isn't confirmed, the item shows **"Walrus save failed"** with a **Retry** button.
- **Who can write sync status:** only the server can change `walrus_records`, using the service role. Caregivers can read their own rows but cannot mark anything as stored.
- **Avoiding duplicates:**
  - Each record stores a hash of its last written text, so an unchanged save writes nothing.
  - Identical text is collapsed by the relayer (`dedupe: true`).
  - An edit points the record at the new blob and moves the old one into `previous_blob_ids`.
  - Superseded and deleted items keep their blobs on Walrus, because Walrus can't delete a single memory. A later recall feature should only trust blob IDs that are current in `walrus_records`.

## Known limitations

- One elder profile per caregiver (enforced by the database).
- A pending write that is lost when the server restarts shows as "not confirmed" after 3 minutes, and can then be retried.
- Reminders are only shown in the app: there are no notifications, by design.
- Deleting an item removes it from DayMate. Its encrypted Walrus blob stays in the elder's namespace but is no longer referenced.
