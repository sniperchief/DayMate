# DayMate redesign: elder mode

This redesign gives the elder their own simple, voice-first DayMate on a paired tablet or phone. It's designed for moderate memory loss. The caregiver's app stays as it was, with one new page (**Elder's device**), a device card on the dashboard, and optional photos on memories.

| Milestone | Status |
|---|---|
| M1. Pairing and read-only elder access | Done |
| M2. Elder shell and Home (Today) | Done |
| M3. Voice Ask | Done |
| M4. My family: person pages | Done |
| M5. Memories: photos, tabs, memory of the day | Done |
| M6. Preview, keep screen on, dashboard status | Done (real-device testing is yours) |

## Database migrations

Apply these in the Supabase SQL editor, in order. The first two are from earlier phases.

| File | Adds | Needed for |
|---|---|---|
| `20261105000000_elder_devices.sql` | `elder_devices`, `elder_pairing_codes`, `redeem_pairing_code()` | Pairing (M1). Already applied. |
| `20261105100000_memory_photos.sql` | `memories.photo_path` | Photos on memories (M5) |
| `20261105200000_device_keep_screen_on.sql` | `elder_devices.keep_screen_on` | Keep the screen on (M6) |

Memories without photos, and pairing itself, keep working before the last two are applied.

## Design rules

- One thing per screen. No settings, editing or sign-out anywhere the elder can reach.
- Every screen shows the day, the date and the time at the top, and the same four big places at the bottom: **Home · Ask · Family · Memories**.
- Pictures first. Text is large: about 23px for body text and 36px or more for headings. Tap targets are at least 64px, and every icon has a text label.
- Speaking is the main way to ask; tapping a suggestion always works too; typing is tucked away.
- **Answers are read aloud automatically.** English only, using the device's default English voice at 0.9× speed.
- After **3 minutes** without a touch, the screen returns to Home. Home refreshes every 5 minutes.
- No technical words: no Walrus, Sui or blockchain.

## M1: Pairing

| Who | Steps |
|---|---|
| Caregiver | Opens **Elder's device**, then **Pair a device**. Gets an 8-character code (for example `KQ7M-4XPD`) and a QR code. Chooses whether to allow speaking questions. |
| Elder's device | Scans the QR code or opens `/pair` and types the code, then taps **Connect this device**, then **Add to Home Screen**. |

**Security:**
- **Codes:** a 31-character alphabet with no look-alike characters, so 31⁸ ≈ 8.5×10¹¹ combinations. Each code expires after 10 minutes, works once, and only one code per elder is active at a time.
- **Device token:** 32 random bytes, held in an `httpOnly` cookie. The proxy refreshes the cookie on use, up to the browser's 400-day cap.
- **Storage:** only SHA-256 hashes of codes and tokens are stored, in `elder_devices` and `elder_pairing_codes`. Caregivers can read device status columns but never `token_hash` or pairing codes.
- **Read-only access:** a device gets a read-only context scoped to one elder (`src/server/elder-repo.ts`). Every write throws, and photo links are created only for that caregiver's files. Ask DayMate is reused unchanged.
- **Unpair** takes effect on the next request.

Migration: `supabase/migrations/20261105000000_elder_devices.sql`. Live check: `npm run device:check` (27 checks).

## M2: Home (Today)

`/home` shows:
- A greeting for the time of day ("Good morning, Rose").
- The **Today** card: the next activity, with photos of the people it mentions, then the rest of today. If nothing is left today, it says so and shows tomorrow's first item.
- Four tiles: **Ask me**, **My family**, **Memories**, **Read to me**.

Everything is built from Postgres in the elder's own time zone (`src/lib/elder/today.ts`). **Read to me** speaks the same summary that's on screen.

**Installable app:**
- `/manifest.webmanifest` opens at `/home`, full-screen, with generated PNG icons.
- `/offline.html` and a service worker show "DayMate needs the internet" when there's no connection.
- The service worker caches only that offline page.

## M3: Voice Ask

`/home/ask` works like this:

1. **Tap the big microphone.** The button pulses while it says "Listening… speak now", and shows the words as they're heard. Listening stops by itself when the elder stops talking.
2. **"You asked: …"** shows, in large text, what DayMate heard.
3. **One answer card**, with photos of the people the answer mentions. It's **read aloud automatically**.
4. **Next steps:** **Say it again**, **That's not what I said** (listen again), or **Ask something else**.
5. **Tap a question** suggestions are always shown. **Type instead** reveals a text box.

**Speech recognition:**
- Uses the browser's `SpeechRecognition` (Chrome on Android, Safari on iPhone and iPad).
- The browser sends the audio to Google or Apple. DayMate receives text only.
- It's shown only if the caregiver allowed speaking for this device, and only on https.
- Friendly messages cover silence, a blocked microphone, no microphone and network errors.

**Spoken clean-up** (`src/lib/elder/spoken.ts`) is deterministic, uses no AI, and applies only to spoken input:
- It removes fillers ("um", "you know") and a leading "hey DayMate".
- It collapses stutters and restarts: "who's… who is my daughter" becomes "Who is my daughter?".
- It corrects misheard family first names, such as "Ellen" to "Helen", but only when exactly one saved name is close and the word isn't ordinary vocabulary.

**Answers** come from the unchanged `ask()` (`src/server/elder-ask.ts`). The people shown are matched from the answer text by full name, or by first name when that first name is unique. No IDs or storage paths reach the browser.

## M4: My family

- Each face on **My family** opens that person's page:
  - a large photo and "This is Helen Example, your daughter.";
  - the caregiver's description;
  - the **next time with Helen**, found from active routines that mention her first name, e.g. "Today at 3:00 PM" or "On Monday at 3:00 PM";
  - up to three recent memories with her, either linked to her or naming her.
- The page **speaks the introduction when it opens**. Some browsers block speech that isn't started by a tap; then **Tell me about Helen** does the same.
- An unknown or removed person shows "I can't find that" with a **Go to Home** button. There are no dead ends.

Logic: `src/lib/elder/person.ts`.

## M5: Memories

**Caregiver side:**
- A memory can have an optional **photo**, stored in the private photos bucket with the same rules as family photos.
- Replacing a photo, removing it, or deleting the memory cleans up the old file.
- Photos are not written to Walrus and are not part of the Sui commitment. Changing only the photo doesn't rewrite the Walrus memory.

**Elder side:**
- Three big tabs: **Recent**, **With family** (linked to a person, or the family/visit category) and **Things I enjoy** (preference/activity).
- A **Memory of the day** card stays the same all day. It prefers memories with a photo, and only shows memories that have already happened.
- Each memory has a **Read this to me** button.

Logic: `src/lib/elder/memories.ts`.

## M6: Polish

**Preview what the elder sees.** A signed-in caregiver who opens `/home` without a paired device sees their own elder's screens. It's read-only, through the caregiver's own RLS session, with a banner: "Preview: this is what Rose sees. Back to DayMate". There are links from **Elder's device** and the dashboard.

**Keep the screen on.** This is a per-device setting on **Elder's device**. While DayMate is open, it uses the Screen Wake Lock API where supported, for a tablet kept on a table or stand. It uses more battery, so it's off by default.

**Dashboard device card.** It shows the paired device and when it was last used, flags **Check in** after 3 or more days without use, and links to the preview.

**Robustness.** Devices are read with `select *` and mapped, so optional columns never break pairing. Token hashes never leave the store module. The proxy refreshes the caregiver session on every route, so preview keeps working.

## Testing on a phone or tablet

The microphone only works over **https** (or on `localhost`).

1. Find your PC's IPv4 address with `ipconfig`, for example `192.168.1.20`.
2. Start the dev server for your Wi-Fi network, over https:
   ```
   $env:DAYMATE_DEV_ORIGINS="192.168.1.20"; npm.cmd run dev:lan
   ```
   The first run creates a local certificate. Your phone will warn that the certificate isn't trusted; choose **Advanced → Proceed** (Android) or **Show details → visit this website** (iPhone/iPad).
3. On your PC, open `https://192.168.1.20:3000/device` and tap **Pair a device**.
4. On the phone, scan the QR code, then tap **Connect this device**. Allow the microphone when asked.
5. If the page won't load on the phone, allow Node.js through Windows Firewall for private networks.

## Test checklist (real devices)

**Caregiver (computer):**
1. Apply the two new migrations, then run `npm run device:check`. All checks should pass.
2. **Elder's device → Preview Rose's screens.** The banner shows and every screen loads.
3. **Memories → add a memory with a photo.** The thumbnail shows. Then edit it: replace the photo, then remove it.
4. Check the dashboard shows the device card.

**Elder (tablet or phone, paired via `npm run dev:lan`):**
1. **Home:** the greeting, date and time are right, and the Today card matches the routines. **Read to me** speaks it.
2. **Ask:** tap the microphone and say "um, who is my daughter".
   - "You asked: Who is my daughter?" appears.
   - The answer shows the photo and is read aloud.
   - Try **That's not what I said**, **Say it again** and **Ask something else**, and a tapped suggestion.
3. **Ask:** say a family name slightly wrong, for example "who is Ellen" for Helen. It should be corrected.
4. **Family:** tap a face. The introduction is spoken, and the next visit and memories show.
5. **Memories:** switch between the three tabs, check the memory of the day, and try **Read this to me**.
6. **Leave it for 3 minutes on another screen.** It should return to Home.
7. **Add to Home Screen.** The DayMate icon should open full-screen at Home. With Wi-Fi off, the offline page appears.
8. **On the computer:** turn **Keep the screen on** on, then check the tablet stays awake while DayMate is open.
9. **On the computer:** unpair. The tablet goes to "Connect this device" on its next tap.

## Automated tests

```
npm test               # includes tests/redesign (pairing, read-only access, Today, voice clean-up, person pages, memories, memory photos; mocks)
npm run device:check   # LIVE Supabase: pairing, isolation, RLS, device settings
```
