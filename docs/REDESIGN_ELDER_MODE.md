# DayMate redesign: elder mode

This redesign gives the elder their own simple, voice-first DayMate on a paired tablet or phone. It's designed for moderate memory loss. The caregiver's app stays as it was, with one new page: **Elder's device**.

| Milestone | Status |
|---|---|
| M1. Pairing and read-only elder access | Done |
| M2. Elder shell and Home (Today) | Done |
| M3. Voice Ask | Done |
| M4. My family: person pages | Next |
| M5. Memories: photos, tabs, memory of the day | Planned |
| M6. Polish and real-device testing | Planned |

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

## Tests

```
npm test               # includes tests/redesign (pairing, read-only access, Today, voice clean-up; mocks)
npm run device:check   # LIVE Supabase: pairing, isolation, RLS
```
