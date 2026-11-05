# DayMate Phase 3A: Ask DayMate

Ask DayMate answers everyday questions such as "Who is my daughter?", "What am I doing tomorrow?" and "Who visited me recently?". It uses only the information this caregiver has saved: Postgres for structured facts and schedules, and Walrus Memory for personal memories. It uses no AI API. Routing and answers are deterministic, and anything it can't answer gets an honest reply.

Open it at **`/ask`** (the **Ask DayMate** link in the nav). The conversation is kept only in the current browser tab.

## How a question is answered

1. **Authenticate.** The server action checks the Supabase session and returns an error if it is missing.
2. **Resolve the elder.** The elder is loaded through the caregiver's RLS-scoped session. A client-sent `elderId` must be a UUID that matches this caregiver's own elder.
3. **Route** the question (`src/lib/ask/router.ts`). Questions are normalised (contractions, possessives), then matched against cue words and the elder's own family names and routine titles.

| Route | Examples | Source |
|---|---|---|
| profile | What is my name? · How old am I? · When is my birthday? | Postgres |
| family | Who is my daughter? · Who are my grandchildren? · Who is Raj? | Postgres |
| schedule | What am I doing tomorrow? · What's on Wednesday? · What is my next activity? | Postgres plus the schedule logic (time zone, daily/weekly/one-off, paused) |
| visit plan | When is Helen coming? · When will my grandson visit? | Postgres routines |
| activity time | What time is my walk? | Postgres routines |
| person (mixed) | Tell me about Helen | Postgres family and routines, plus Walrus memories |
| memory | Who visited me recently? · What music do I enjoy? · What happened at my birthday? | Walrus, filtered |
| fallback | anything else | strict Walrus search, otherwise "I'm not sure how to answer that yet…" |

4. **Retrieve from Walrus** (memory and person routes only):
   - Recall goes through the existing Phase 1 `MemoryService` (`walrusRecaller`, the same singleton used for writes) in the elder's namespace `daymate-elder-<uuid>`.
   - Results use `sort: "relevance"`. `sort: "recent"` is not used, because it orders by the time the memory was *written*, not when the event happened. Recency comes from each memory's `event_date` in Postgres.
   - The question is rewritten into the third person before recall ("Who visited **me** recently?" → "who visited **rose** recently"), because stored memories name the elder. On Mainnet this moved the correct memory from distance 0.80 to 0.49.
   - The first recall fetches 20 candidates. It retries once if the relayer returns nothing, and widens to 60 if filtering leaves nothing.
5. **Filter** (`src/lib/ask/evidence.ts`). A recall hit is accepted only if **all** of these hold:
   - its blob ID is the **current** `blob_id` of a `walrus_records` row with `status = 'stored'`, from this caregiver's RLS-scoped rows;
   - `sha256(hit text)` equals that row's `content_hash`;
   - the source row (memory, family member, active routine or profile) still exists.

   This rejects superseded blobs (`previous_blob_ids`), deleted items, pending or failed writes, forged or altered text, and any other caregiver's blobs.
6. **Rank.** A hit must be semantically very close (distance ≤ 0.45), or share a content keyword with the question and be within 0.75. Unrecognised questions use stricter limits (0.35 and 0.65). Hits are ranked by distance minus a small keyword bonus.
7. **Answer from Postgres.** The answer text is built from the **current Postgres row** behind the accepted blob, so names, dates, tense (past or "coming up") and relationships come from authoritative data. Raw Walrus text is never shown.
   - When two results are equally relevant, both are shown.
   - When two people share a relationship, both are listed.
   - When nothing qualifies: "I don't have that information saved yet. Your family caregiver can add it for you."

Answers never include database IDs, blob IDs or internal errors.

## Verify

```bash
npm test             # includes tests/phase3a (labelled mocks + in-memory fake Walrus)
npm run ask:smoke    # LIVE: real Supabase + Walrus Mainnet, fictional data, 13 checks
```

`ask:smoke` edits one memory and deletes another, confirms that Walrus still returns the old blobs, then confirms Ask DayMate never uses them.

## Known limitations

- **Wording coverage.** The router uses cue words. It handles common wording, but will fall back to "I'm not sure" on unusual phrasing.
- **Distance limits.** The relevance limits were tuned on measured Mainnet distances, which run high (correct matches at 0.5–0.73). Short or vague questions may come back as "not saved" rather than risk a wrong answer.
- **Name matching.** Visit plans are found by matching the person's first name or relationship word in a routine's title or description, for example "Helen visits".
- **History.** Conversation history is per tab, with no long-term memory, by design.
