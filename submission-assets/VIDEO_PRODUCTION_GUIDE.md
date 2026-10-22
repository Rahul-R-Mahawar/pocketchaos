# PocketChaos: 5-Minute Demo Video Production Guide

The guidebook allows **5:00 at most**: "show the problem, product, how it works, how AI helped, important technical decisions, and your development/QA approach" (page 12). This guide gives you narration you can read aloud or paste into a TTS tool, plus a second-by-second screen plan.

| Block | Time | Length | Narration | Shows |
|---|---|---|---|---|
| 1 | 0:00–0:45 | 45 s | ~105 words | The problem |
| 2 | 0:45–2:15 | 90 s | ~210 words | Live demo: web + mobile |
| 3 | 2:15–3:15 | 60 s | ~145 words | Architecture & security |
| 4 | 3:15–4:15 | 60 s | ~145 words | Context engineering & AI workflow |
| 5 | 4:15–5:00 | 45 s | ~100 words | QA & learning from AI failures |

Word counts assume ~140–150 words per minute, a natural pace for both a human read and Edge-TTS or ElevenLabs at default speed.

---

## 0. Before you hit record (10 minutes)

**Terminal 1: backend** (in-memory MongoDB, nothing to install):

```bash
cd backend && JWT_SECRET=$(openssl rand -hex 32) CORS_ORIGINS=http://localhost:5173 npm run dev:memory
```

**Terminal 2: dashboard:**

```bash
cd web && npm run dev
```

**Terminal 3: demo data.** Run it once now to create the account and endpoints; you will re-run it with traffic during block 2.

```bash
node submission-assets/demo-seeder.ts
```

**Mobile:**
- Run `cd mobile && npx expo start`, open the app in the iOS Simulator (press `i`) or on a phone on the same Wi-Fi.
- On the **Pair** tab choose the **Localhost** preset (simulator) or **Dev machine (LAN)** (phone).
- **Do not pair yet**: pairing happens on camera.

**Dashboard sign-in.** Open http://localhost:5173 and sign in as `demo@pocketchaos.dev`. The password is in `submission-assets/.env.demo.local`, or in `DEMO_PASSWORD` if you set one.
- Sign in **before** recording, so the password field never appears on screen.
- Never open that file on camera.

**Screen layout (1920×1080):**
- **Left 60%:** browser with the dashboard.
- **Right 40%:** iOS Simulator.
- Terminal 3 sized to sit over the left half when needed.
- Browser zoom 110–125%, terminal font ≥ 18 pt.

**Clean-up:**
- Turn on Do Not Disturb, hide the dock and bookmarks bar, and close unrelated tabs.
- Clear terminal scrollback (`clear`).

**Slides.** Open `submission-assets/presentation-deck.html` in a second browser window. Press **F** for full screen and use **→** to advance; blocks 1, 3, 4 and 5 use it.

**Rehearse once with a stopwatch.** If you run long, cut words from block 2, not from blocks 4–5: AI practice is worth 35% of the score.

---

## 1. The problem · 0:00–0:45

### Narration

```text
Every mobile app works on office Wi-Fi. Then it meets a train tunnel. A request takes three seconds, a server returns a 503 once in every five calls, or an API quietly sends a number as a string. Those are exactly the paths we never test, because reproducing them means installing proxy certificates on phones, hacking the backend, or writing mocks that never touch a network.

I'm Rahul, and this is PocketChaos: a mobile API chaos proxy and negative-testing companion. Point your app at one proxy URL, switch chaos rules on from a web dashboard, and your phone tests itself against latency, faults and corrupted JSON. Let me show you.
```

### Screen choreography

| Time | Window | Action |
|---|---|---|
| 0:00 | Deck, slide 1 (title) | Full screen. Hold still; let the title breathe. |
| 0:06 | Deck, slide 2 (problem) | Press → as you say "train tunnel". |
| 0:12 | Slide 2 | Point (cursor or highlight) at **+2.5 s**, **503**, then **"id": "7"** as each is named. |
| 0:25 | Slide 2 | Point at the "How teams try to test it today" row. |
| 0:31 | Deck, slide 3 (solution) | Press → on "I'm Rahul, and this is PocketChaos". |
| 0:38 | Slide 3 | Sweep the cursor along the six journey steps. |
| 0:44 | Switch to dashboard | Cut on "Let me show you." |

---

## 2. Live demo · 0:45–2:15

### Narration

```text
The backend is running, and I've just started our demo seeder. It signs in a demo account, prints the six-character project key big enough to read on video, and creates three endpoints: a user profile with JSON corruption, a checkout that fails forty percent of the time with a 503, and a home feed with two and a half seconds of latency.

On the dashboard, each endpoint has live chaos controls: latency, failure rate, fault status code and corrupt JSON. Changes save instantly. On the right is live telemetry: every request through the proxy appears within two seconds. Green is success, amber means the payload was corrupted, red is an injected fault.

Now the phone. I type the project key on the Pair tab, and the app pulls the endpoints and their chaos rules. No password or token ever reaches the device. On the Runner tab I fire a batch with exponential backoff retries. The summary shows success rate, latency, faults, and corrupted payloads caught by our schema integrity detector. One tap opens the payload inspector: the fields that were removed or changed, the request headers with its idempotency key, and the raw body.

Last, offline mode. I simulate going offline and run a checkout batch: every request is queued and saved. Back online, one tap replays the queue in order, each request with its original idempotency key.
```

### Screen choreography

| Time | Window | Action |
|---|---|---|
| 0:45 | Terminal 3 | Run `node submission-assets/demo-seeder.ts --traffic --forever`. The big project-key banner appears; hold it on screen. |
| 0:58 | Terminal 3 | The traffic lines start: green OK, amber CORRUPTED, red CHAOS 5xx. Leave it running. |
| 1:02 | Dashboard (left) | Bring the browser forward. The navbar shows **Project key** with **Copy Pairing Key**. |
| 1:06 | Dashboard, **Endpoints (3)** | Scroll to **Checkout**: show **Chaos enabled**, **Latency**, **Failure rate**, **Fault status code**, **Corrupt JSON payload**. Nudge **Latency** once and let it show **Saved**. |
| 1:16 | Dashboard, **Live telemetry** (right) | Hover a green `200`, an amber `200` with "fields corrupted", and a red `503` "fault 503" as each colour is named. |
| 1:25 | iOS Simulator, **Pair** tab | Type the key from the banner (lowercase works; it is uppercased), then tap **Pair device**. The endpoint list with chaos rules appears. |
| 1:34 | Simulator, **Runner** tab | Tap the **Run All** chip, keep **Requests per endpoint: 5** and **Exponential backoff retries** on, then tap **Run chaos batch**. With the feed's 2.5 s delay the batch takes about 20 s, so narrate over it. |
| 1:38 | Simulator, Runner summary | The metrics fill in live: **Success**, **Avg latency**, **4xx/5xx faults**, **Corrupted caught**, then the line "Detector caught N of N injected corruptions". |
| 1:55 | Simulator, **Payload Inspector** | Tap a **SCHEMA_CORRUPTION_DETECTED** row. Scroll slowly through **Schema integrity** (e.g. `verified: missing_field`), the request headers with **Idempotency-Key**, and **Raw response body**. Close it. |
| 2:02 | Simulator, **Offline** tab | Turn on **Simulate Offline Mode**. On **Runner**, tap the **Checkout** chip and run: nothing is sent, so it finishes instantly. Back on **Offline** it shows "5 pending". |
| 2:09 | Simulator, **Offline** tab | Turn **Simulate Offline Mode** off and tap **Replay & Sync Queue**. The banner reads "Delivered 5, rejected 0 of 5". |
| 2:14 | Terminal 3 | Press **Ctrl+C** to stop traffic (the summary line prints) and cut to the deck. |

> The checkout endpoint fails about 40% of the time, so some replays may hit a 503. That is fine: the queue stops, keeps the request first in line, and you can say "and it stops at the first failure without losing order". To keep the take clean, set **Failure rate** to 0 on **Checkout** just before tapping replay.

---

## 3. Architecture & security · 2:15–3:15

### Narration

```text
Under the hood, it's a TypeScript monorepo with three apps around one written contract: an Express 5 API and chaos proxy on MongoDB, a React dashboard, and an Expo React Native companion. The proxy pipeline is simple: delay, then a probabilistic fault, then a mock or forwarded response, then JSON corruption, then a telemetry log.

Security was a requirement from the first commit. There are no hardcoded secrets: the environment is validated with Zod at startup, and the server refuses to boot without a strong JWT secret. Every management route needs a JWT and is scoped to its owner. Delays are capped at ten seconds, even if the database is tampered with. And because forward mode calls user-supplied URLs, every target passes our SSRF guard: loopback, private ranges and cloud metadata addresses are blocked, and DNS is pinned at connect time, with sixty-five unit tests behind it.
```

### Screen choreography

| Time | Window | Action |
|---|---|---|
| 2:15 | Deck, slide 4 (architecture) | Full screen. Trace the arrows: web → `/api/*`, mobile → `/proxy/:projectKey/*`. |
| 2:32 | Slide 4, right column | Point at the four trade-off cards (Zod env, short-polling, deterministic queue, key-only pairing). |
| 2:40 | Deck, slide 5 (security) | Press → on "Security was a requirement". Point to cards 01 → 04 as each is spoken. |
| 2:58 | Optional editor cut (5 s) | Show `backend/src/config/env.ts` (the Zod schema) or `backend/src/utils/ssrf.ts` (`isSafeExternalUrl`). Never show a `.env` file. |
| 3:10 | Slide 5 | Point at the guardrail strip along the bottom. |

---

## 4. Context engineering & AI workflow · 3:15–4:15

### Narration

```text
PocketChaos was built with Claude Code as a development partner, but never from a blank prompt. Before any code, I wrote a product blueprint and an engineering contract, dot-AI slash CONTEXT dot MD: security rules, the API response envelope, and the exact semantics of the chaos engine.

Each phase opened with an architect role that confirmed the data models and the SSRF strategy. Then a QA-breaker agent attacked the code with boundary and negative tests, and a security-auditor agent reviewed every phase for secrets, injection and denial-of-service risks. Everything the AI got wrong went into a learning log, as symptom, cause, fix and guard.

That log changed how I work. Once, the contract file was empty on disk, and the model silently filled the gap with its own defaults. Now an empty context file is a blocker, and our packaging script enforces it.
```

### Screen choreography

| Time | Window | Action |
|---|---|---|
| 3:15 | Deck, slide 6 (AI lifecycle) | Full screen. Move along stages 01 Define → 06 Document as you speak. |
| 3:30 | Editor | Open `.ai/CONTEXT.md` and scroll through §3 (security rules) and §5 (chaos engine). |
| 3:42 | Editor | Open `.ai/agents/qa-breaker-agent.md`, then `sec-auditor-agent.md`: highlight the four QA pillars and the Severity · File · Issue · Fix table instruction. |
| 3:54 | Editor | Open `.ai/AI_LEARNING_LOG.md`, jump to **Entry #3** ("Built against an empty contract"). |
| 4:08 | Deck, slide 6 | Return to the slide for the closing line of the block. |

---

## 5. QA & learning from AI failures · 4:15–5:00

### Narration

```text
The result is seven hundred and seven automated tests across the three apps: boundaries like zero and ten-thousand-millisecond delays, attacks like DNS rebinding and token tampering, and chaos cases like fully corrupted batches and double taps on the sync button. In the QA passes, every bug was proven with a failing test before it was fixed.

Two examples: the AI's first SSRF guard blocked the entire internet, and its offline queue could erase saved requests after a storage error. Both were caught, fixed and locked in with tests.

PocketChaos: chaos on demand, so your users never meet it first. Thanks for watching.
```

### Screen choreography

| Time | Window | Action |
|---|---|---|
| 4:15 | Deck, slide 7 (QA) | Full screen. Point at **349 · 125 · 233**, then the boundary and negative cards. |
| 4:30 | Optional terminal cut (4 s) | Pre-recorded `npm test` in `backend`, ending on `Tests: 349 passed`. Never record a live suite run; it eats the clock. |
| 4:36 | Deck, slide 8 (learning) | Press → on "Two examples". Point at "The SSRF guard blocked the whole internet", then "The offline queue could erase itself". |
| 4:52 | Deck, slide 1 or a title card | Closing line. Hold for 2 s, then fade out before **5:00**. |

---

## 6. AI voiceover (optional)

Save each narration block (the text inside each `text` fence above) as `vo-1.txt` … `vo-5.txt`, then generate one audio file per block. Each clip then lines up with its section and is easy to retime.

**Edge-TTS** (free, Microsoft neural voices):

```bash
pip install edge-tts
edge-tts --list-voices | grep en-US      # e.g. en-US-AndrewNeural, en-US-AriaNeural, en-US-GuyNeural
for n in 1 2 3 4 5; do
  edge-tts --voice en-US-AndrewNeural --rate=-4% --file vo-$n.txt --write-media vo-$n.mp3
done
```

**ElevenLabs:**
- Paste one block at a time into Text to Speech.
- Use a calm narrator voice: stability ≈ 0.5, similarity ≈ 0.75, style 0.
- Download as MP3. Use the same voice for all five blocks.

**macOS built-in fallback:**

```bash
for n in 1 2 3 4 5; do say -v Samantha -r 165 -f vo-$n.txt -o vo-$n.aiff; done
```

**Check the timing:**

```bash
for f in vo-*.mp3; do echo "$f $(afinfo "$f" | awk '/estimated duration/ {print $3}') s"; done
```

Targets are block 1 ≤ 45 s, block 2 ≤ 90 s, blocks 3–4 ≤ 60 s each, and block 5 ≤ 45 s. If a clip runs long, lower `--rate` by a few percent or trim a sentence, not the AI-practice blocks.

**Pronunciation:**
- Write "dot-AI slash CONTEXT dot MD" exactly as above.
- If the voice stumbles on technical terms, spell them out: "S-S-R-F", "J-W-T", "Zod" (rhymes with "nod").

---

## 7. Assembly with Remotion (optional)

Use Remotion when you want title cards, captions and exact timing in code. Record the screen segments first (QuickTime, OBS or Playwright, see §8), then compose:

```bash
npx create-video@latest pocketchaos-video     # outside this repository
```

```tsx
// src/Video.tsx (30 fps, 1920×1080, 5:00 = 9000 frames)
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile } from 'remotion';

const blocks = [
  { from: 0, frames: 45 * 30, video: 'b1-problem.mp4', vo: 'vo-1.mp3' },
  { from: 45 * 30, frames: 90 * 30, video: 'b2-demo.mp4', vo: 'vo-2.mp3' },
  { from: 135 * 30, frames: 60 * 30, video: 'b3-architecture.mp4', vo: 'vo-3.mp3' },
  { from: 195 * 30, frames: 60 * 30, video: 'b4-context.mp4', vo: 'vo-4.mp3' },
  { from: 255 * 30, frames: 45 * 30, video: 'b5-qa.mp4', vo: 'vo-5.mp3' },
];

export const Video = () => (
  <AbsoluteFill style={{ backgroundColor: '#07090d' }}>
    {blocks.map((b) => (
      <Sequence key={b.video} from={b.from} durationInFrames={b.frames}>
        <OffthreadVideo src={staticFile(b.video)} muted />
        <Audio src={staticFile(b.vo)} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
```

Register it with `durationInFrames={9000}` and render with `npx remotion render Video out/pocketchaos-demo.mp4`. Keep the total at or under 9,000 frames.

---

## 8. Capturing the dashboard with Playwright (optional)

Playwright can record a smooth, repeatable browser segment for block 2, with no stray mouse jitter. Run it from a scratch folder outside the repository (`npm i -D playwright && npx playwright install chromium`), with the backend, dashboard and `demo-seeder.ts --traffic --forever` running.

```ts
// record-dashboard.ts: run with `npx tsx record-dashboard.ts`
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: 'clips', size: { width: 1920, height: 1080 } } });
const page = await context.newPage();
await page.goto('http://localhost:5173');
await page.getByLabel(/email/i).fill(process.env.DEMO_EMAIL ?? 'demo@pocketchaos.dev');
await page.getByLabel(/password/i).fill(process.env.DEMO_PASSWORD ?? '');   // from the environment, never hardcoded
await page.getByRole('button', { name: /sign in|log in/i }).click();
await page.getByText('Live telemetry').waitFor();
await page.waitForTimeout(8_000);                               // let telemetry rows stream in
await page.getByText('Checkout').scrollIntoViewIfNeeded();
await page.waitForTimeout(6_000);
await context.close();                                          // the video is written on close
await browser.close();
```

The login step types the password inside the recording. Either trim the first seconds of the clip, or sign in once with `storageState` and record a second context that reuses it.

---

## 9. Final checks before export

- [ ] Total length ≤ **5:00**. Aim for 4:50 so a slow intro never pushes you over.
- [ ] The problem, product, how it works, how AI helped, technical decisions and the QA approach are all covered (guidebook page 12).
- [ ] No passwords, tokens, `.env` files or `.env.demo.local` visible in any frame. Scrub the terminal and editor tabs.
- [ ] The project key on screen comes from a local, throw-away database (`dev:memory` discards it on exit).
- [ ] Export 1920×1080, 30 fps, H.264 MP4, AAC audio; loudness around −16 LUFS (speech).
- [ ] Watch it once with the sound off: the screen alone should still tell the story.
