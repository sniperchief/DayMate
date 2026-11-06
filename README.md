# DayMate

*A little help remembering what matters.*

DayMate is a memory companion for older people living with memory loss, and for the family member who looks after them. The caregiver records the people, routines and memories that matter. The elder uses a simple, voice-first phone or tablet to ask *"Who is Helen?"* or *"What am I doing today?"* and hears the answer spoken aloud.

Every memory is written to **Walrus Memory on Mainnet**. A tamper-evident fingerprint of it is anchored on **Sui Mainnet** and **independently verified through Tatum**.

**Live demo:** https://trydaymate.vercel.app  
**Built for:** Tatum × Walrus *Total Recall* hackathon

---

## Hackathon requirements

| Requirement | How DayMate meets it |
|---|---|
| Walrus Memory integrated and writing on Mainnet | Profile, family members, routines and memories are written to Walrus Memory on Mainnet, SEAL-encrypted, one namespace per elder. Each write is tracked until Walrus confirms it and returns a blob ID. See [Walrus Memory](#1-walrus-memory-storage-and-recall). |
| Tatum RPC used for onchain data | Every Sui anchor is verified through **Tatum's Sui Mainnet gRPC gateway** (`LedgerService/GetTransaction`). A memory is marked *Verified* only after Tatum's copy of the transaction passes every check. See [Tatum](#3-tatum-independent-verification). |
| At least 10 memories stored on Mainnet | Phase 1 seeded 12 confirmed memories. The live app adds caregiver memories to Mainnet continuously. See [Mainnet proof](#mainnet-proof). |
| Working demo and public repo | Live at https://trydaymate.vercel.app; this repository is public. |

---

## The problem

People with moderate memory loss repeatedly ask the same questions: who a visitor is, what day it is, what is planned. Family caregivers answer these all day. They also worry that notes about their loved one can be lost, altered or exposed.

## What DayMate does

**For the caregiver** (phone-first web app):
- Record the elder's profile, family members (with photos and relationships), daily routines and planned visits, and memories (with photos and dates).
- See each item's storage status: *Stored on Walrus* and *Verified on Sui*.
- Pair the elder's device with a one-time code or QR code, and manage it remotely.

**For the elder** (paired tablet or phone, large and simple screens):
- **Today:** a greeting, the date and time, and today's routines, read aloud.
- **Ask:** tap the microphone and ask a question. The answer is spoken automatically, with photos of the people involved.
- **My family:** photos of each person and the memories they share.
- **Memories:** browse past moments, with a "memory of the day".
- Read-only, no passwords, and it returns to Home after 3 minutes idle. It can be installed to the home screen.

---

## Architecture

```
 Caregiver phone                         Elder tablet / phone (paired, read-only)
        │                                         │
        ▼                                         ▼
 ┌──────────────────────────── Next.js 16 on Vercel ───────────────────────────┐
 │  Server actions · Ask DayMate router · device pairing · background sync     │
 └──────┬──────────────────────────┬──────────────────────────┬────────────────┘
        │ 1. save                  │ 2. write (after save)    │ 3. anchor (after Walrus confirms)
        ▼                          ▼                          ▼
  Supabase Postgres          Walrus Memory              Sui Mainnet
  source of truth, RLS       Mainnet, SEAL-encrypted    salted SHA-256 commitment only
                                   │                          │
                                   │ recall (Ask)             │ 4. verify
                                   ▼                          ▼
                             Ask DayMate answers        Tatum Sui gRPC gateway
                                                        independent check → "Verified"
```

### 1. Walrus Memory: storage and recall
- Postgres is saved first. The Walrus write then runs in the background, so the caregiver never waits.
- Each item is turned into a plain-language sentence and written through the Walrus Memory SDK (`@mysten-incubation/memwal`), encrypted with SEAL, into the elder's own namespace (`daymate-elder-<uuid>`).
- An item is marked **Stored** only after Walrus confirms the job and returns a blob ID. Failures show **Retry**. Unchanged saves write nothing, and edits point to the new blob.
- **Recall:** the Ask feature searches Walrus for personal memories. A result is used only if its blob ID is this elder's *current* stored blob **and** the SHA-256 of the recalled text matches the hash saved at write time. This rejects stale, altered or foreign data.
- Dates of birth, private notes and photos are never written to Walrus.

### 2. Sui Mainnet: tamper-evident anchoring
- After a memory is confirmed on Walrus, the server publishes a **salted SHA-256 commitment** of it on Sui Mainnet, using a small immutable Move package (`daymate_anchor`).
- **Only 32 bytes and a version number go on chain.** No text, names, dates, IDs or blob IDs. The commitment binds the memory ID, its Walrus blob and the hash of its exact text. The salt stays on the server.
- This proves a memory existed in that exact form at that time and has not changed since. Deleting a memory deletes its salt, so the on-chain record can no longer be linked to anyone.

### 3. Tatum: independent verification
- Transactions are submitted to a Sui full node. They are then fetched back from a **different provider, Tatum's Sui Mainnet gRPC gateway**, and checked field by field:
  - the digest matches;
  - execution succeeded;
  - there is exactly one `MemoryCommitted` event, from DayMate's package;
  - the sender is DayMate's wallet;
  - the event's BCS bytes decode to exactly the expected commitment.
- Only then does the memory show **Verified on Sui**, with a link to the transaction. Rate limits or indexing delays leave it *pending* and retryable; mismatches mark it *failed*.

### Ask DayMate
- Deterministic, with no LLM. Questions are routed by intent:
  - profile, family and schedule questions are answered from Postgres;
  - personal memories ("What music do I enjoy?", "Who visited me recently?") are recalled from Walrus and filtered as described above.
- Answers are always built from current, authoritative data.
- **It learns over time:** every memory the caregiver adds becomes something the elder can ask about.

---

## Mainnet proof

| Item | Value |
|---|---|
| Sui Move package (immutable) | [`0xbb11a10bd82cd2b3bda6e024420fa79acacb0cc10247eeaa011043aad401cca0`](https://suiscan.xyz/mainnet/object/0xbb11a10bd82cd2b3bda6e024420fa79acacb0cc10247eeaa011043aad401cca0) |
| Package publish transaction | [`Gbqe5Vx2iDe4TnzP8TsKPV9mvNUVGjFjx9tcTtWH2ef7`](https://suiscan.xyz/mainnet/tx/Gbqe5Vx2iDe4TnzP8TsKPV9mvNUVGjFjx9tcTtWH2ef7) |
| DayMate anchoring wallet (sender of every anchor) | [`0x16fd44f81dbc8fc2d341bfa5e4249d9b15f9d45a1f8ed4c04b3bc891e0a82dd0`](https://suiscan.xyz/mainnet/account/0x16fd44f81dbc8fc2d341bfa5e4249d9b15f9d45a1f8ed4c04b3bc891e0a82dd0) |
| First real memory anchor, verified through Tatum | [`G8UV3QNJjv7LpuAZ3srgrbvD1MaXHGoHfrkyADTKjKf3`](https://suiscan.xyz/mainnet/tx/G8UV3QNJjv7LpuAZ3srgrbvD1MaXHGoHfrkyADTKjKf3) |
| First anchor (synthetic test data), verified through Tatum | [`ck9ZMSUioxboCqF64ZT88FZNJCrY6V6Du2mphPph5Mo`](https://suiscan.xyz/mainnet/tx/ck9ZMSUioxboCqF64ZT88FZNJCrY6V6Du2mphPph5Mo) |
| Walrus Memory | 12 confirmed seed memories (namespace `daymate-phase1`), plus memories written by the live app to each elder's namespace |

The wallet link lists every anchor DayMate has made on Sui Mainnet.

---

## Try it

1. Open https://trydaymate.vercel.app on a phone and **create a caregiver account**.
2. Fill in **Profile**, then add a few **Family** members, **Routines** and **Memories** (with photos).
3. On the **Memories** page, watch each memory go from *Saving to Walrus…* to **Stored on Walrus**, then **Verified on Sui** with a transaction link.
4. Go to **More → Elder's device → Create pairing code**.
5. On a second device (or a private browser window), open https://trydaymate.vercel.app/pair and enter the code.
6. On the elder screen, tap **Ask**, then the microphone, and say *"Who is Helen?"* or *"What am I doing today?"*. The answer is spoken aloud.

With no second device, open https://trydaymate.vercel.app/home while signed in as the caregiver to see a read-only preview of the elder's screens. Voice input needs Chrome or Safari, and microphone permission.

---

## Security and privacy

- **Nothing personal on chain.** Sui holds only salted hashes; Walrus content is SEAL-encrypted.
- **Server-only secrets.** The Walrus delegate key, the Sui signing key, the Tatum API key and the Supabase service-role key exist only as server environment variables. They are never sent to the browser, logged or committed.
- **Row-level security** on every table. A caregiver can only ever reach their own elder's data. Only the server can mark items as stored or verified.
- **Elder devices** are paired with single-use, 10-minute codes. They hold a hashed, revocable token and have read-only access to one elder.
- Photos live in a private bucket and are served through short-lived signed URLs.

---

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Supabase (Postgres, Auth, Storage, RLS) · Walrus Memory SDK with SEAL · Sui Move and `@mysten/sui` · Tatum Sui gRPC gateway · Web Speech API · Vercel

---

## Run locally

```bash
npm install
cp .env.example .env      # fill in Supabase, Walrus Memory, Sui and Tatum values
# apply supabase/migrations/*.sql in the Supabase SQL editor
npm run dev               # http://localhost:3000
```

| Command | What it checks |
|---|---|
| `npm test` | Unit tests (offline, mocked) |
| `npm run typecheck` | TypeScript |
| `npm run app:smoke` | Live: app → Supabase → Walrus Mainnet → recall |
| `npm run ask:smoke` | Live: Ask DayMate against real data |
| `npm run sui:preflight` | Live, read-only: Tatum, wallet, package |
| `npm run move:test` | Move unit tests (needs the Sui CLI) |

## Repository layout

```
src/app/              pages: caregiver (app), elder (elder), auth
src/lib/memory/       Walrus Memory service
src/lib/walrus-sync/  Postgres → Walrus sync and status tracking
src/lib/ask/          Ask DayMate routing and Walrus evidence filtering
src/lib/sui-anchor/   commitments, Sui submission, Tatum verification
src/lib/devices/      elder device pairing
move/daymate_anchor/  Sui Move package
supabase/migrations/  database schema and security policies
docs/                 detailed design notes for each part
```

## Detailed documentation

- [Walrus Memory foundation](docs/PHASE1_SETUP.md)
- [Caregiver app and Walrus sync](docs/PHASE2_SETUP.md)
- [Ask DayMate](docs/PHASE3A_ASK.md)
- [Sui anchoring and Tatum verification](docs/PHASE3B_SUI.md)
- [Elder mode](docs/REDESIGN_ELDER_MODE.md)
