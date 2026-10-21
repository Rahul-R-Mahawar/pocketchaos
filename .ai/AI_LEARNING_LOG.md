# AI Learning Log

Failures, bugs and wrong assumptions caught while building PocketChaos with AI agents, and what we changed because of them.
Each item: **symptom → root cause → fix → regression guard**.

---

## Entry #1: Phase 1 backend build (2026-10-18)

> Backfilled: written together with Entry #2 because this log was empty after the Phase 1 build.

Context: Architect pass + first build of `/backend` (Express 5, Mongoose 9, Zod 4). Verified with an ad-hoc 102-check smoke script against an in-memory MongoDB.

### 1.1 SSRF guard blocked every public IPv4 address
- **Symptom:** `checkExternalUrl('https://8.8.8.8/')` and every real hostname were rejected as "private".
- **Root cause:** one `net.BlockList` held both IPv4 and IPv6 rules. Node also matches IPv4 lookups against IPv4-mapped IPv6 rules, so the `::ffff:0:0/96` entry covered all of IPv4.
- **Fix:** separate `BlockList` instances per address family (`src/utils/ssrf.ts`).
- **Guard:** `tests/unit/ssrf.test.ts` → `isPublicIp` allows `8.8.8.8`, `1.1.1.1`, `172.32.0.1`…
- **Lesson:** test an allow-list as hard as the block-list; a guard that blocks everything also "passes" every attack test.

### 1.2 `corruptJson` hung forever with a stubbed random function
- **Symptom:** (found in review before any test existed) `corruptJson(obj, () => 0)` never returned for objects with ≥ 5 fields.
- **Root cause:** `while (chosen.size < target) chosen.add(randomIndex())` cannot terminate when `random()` keeps returning the same value, which is exactly what deterministic tests inject.
- **Fix:** partial Fisher–Yates sampling plus clamped indices (`src/services/chaos.service.ts`).
- **Guard:** `tests/unit/chaos.service.test.ts` → "terminates and stays in range with a fixed random".

### 1.3 Deeply nested mock JSON crashed the insert with a generic 500
- **Predicted in review** from MongoDB's documented 100-level nesting limit; the depth cap went in before reproducing it.
- **Verified afterwards** (Phase 2, inserting directly with the Zod cap bypassed, MongoDB 7.0): 150 levels actually **store fine**, so the cited "100-level limit" was wrong. The real failures:
  - 180 levels: `MongoServerError` code 15, "exceeds 180 levels of nesting", which falls through to our generic `500 INTERNAL_ERROR`.
  - 5,000 levels: `RangeError: Maximum call stack size exceeded` during BSON serialisation, also a 500.
  - Both are reachable with a body far below the 100 kb limit.
- **Fix:** Zod refinement capping `mockResponseJson` at 20 levels, checked iteratively so a 40,000-level payload cannot overflow the stack during validation.
- **Guard:** `tests/integration/endpoints.test.ts` → 21-level, 150-level and 40,000-level payloads all return 400; 20 levels is accepted.
- **Lesson:** verify a "known limit" before writing it down. The bug was real, but the stated reason was not.

---

## Entry #2: QA-breaker + security-auditor pass and first Jest suite (2026-10-18)

Context: acted as `qa-breaker-agent` and `sec-auditor-agent` on `/backend`, then built `backend/tests/` (Jest 30 + ts-jest + Supertest + mongodb-memory-server).
Workflow rule: **every suspected bug got a failing test first**; only findings that failed against the unfixed code are listed as bugs below.
Final result: `npm test` → 7 suites, **332 tests passing**, no open handles.

### A. Test-infrastructure failures (would have hidden or broken the whole suite)

#### 2.1 Jest exited 0 having run zero tests
- **Symptom:** `npx jest` printed only a Watchman crash and exited with code 0, a silent false "pass".
- **Root cause:** the Homebrew `watchman` binary on this machine is broken (`libfmt.11.dylib` missing). Jest uses Watchman for file discovery when it is installed.
- **Fix:** `watchman: false` in `jest.config.js`.
- **Lesson:** a green run is only evidence if the test count is right. Always check `Tests: N passed`.

#### 2.2 Every DB test failed: "Missing required sub-document 'driver' in the client metadata document"
- **Symptom:** inside Jest only, `mongoose.connect` was rejected by the server; the same code connected fine under `tsx`.
- **Root cause:** MongoDB driver 7.7 loads `os` with a dynamic `import('os')`. Jest's VM sandbox rejects dynamic import without `--experimental-vm-modules`; the driver **swallows** that error, sends `{}` as client metadata, and the server rejects the handshake.
- **Fix:** pass the driver's public `runtimeAdapters: { os }` option in `connectDatabase` (`src/config/db.ts`), so no dynamic import is needed in any environment.
- **Lesson:** when a library squashes errors, inspect the data it produced (here: metadata was `{}`) rather than the error it reports.

#### 2.3 ts-jest warned on `module: nodenext`
- **Fix:** `isolatedModules: true` in `tsconfig.test.json` (ts-jest transpiles per file) and `npm test` runs `tsc -p tsconfig.test.json` first, so type errors in `src/` or `tests/` still fail the run.

### B. Application bugs confirmed by failing tests, then fixed

| # | Severity | Finding | Fix |
|---|----------|---------|-----|
| 2.4 | **Med (security)** | Proxy served upstream `text/html` / `application/javascript` from the API origin, so anyone could host a phishing page or script on our domain (helmet's `script-src 'self'` even allows one proxy URL to load another as a script). | `sandboxProxyResponses` sets `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox` on every `/proxy` response, errors included. |
| 2.5 | **Med (DoS)** | Unbounded `RequestLog` growth: any registered user could write ~600 logs/min/IP into their own project, kept for 7 days, enough to fill a free Atlas cluster. | Keep the newest 1,000 logs per project (`trimProjectLogs`). The trim needed `mongoose.trusted({ $lte })`: the global `sanitizeFilter` otherwise silently turns `$lte` into `$eq` and deletes nothing. |
| 2.6 | **Med (stability)** | Upstream JSON nested ~20k levels + `corruptJson` → `structuredClone`/`JSON.stringify` (recursive in V8) overflowed the stack → 500. | Iterative depth check; bodies deeper than 256 levels pass through byte-for-byte, tagged `corrupt_json:skipped_too_deep`. |
| 2.7 | Low | Malformed percent-encoding (`/proxy/KEY/%E0%A4%A`, `/api/endpoints/%ZZ/chaos`) → Express `URIError` → 500 + `[unhandled error]` log noise. | Error handler maps any http-errors-style 4xx to the envelope (`400 BAD_REQUEST`, fixed message). |
| 2.8 | Low | Proxied paths over 500 chars failed `RequestLog` validation; the error was swallowed, so the request vanished from telemetry. | Truncate the logged path to 500 chars. |
| 2.9 | Low | `corruptJson` "corrupted" a `null` field to `null` and still reported it as changed. | `null` strategy excluded for values that are already `null`. |
| 2.10 | Low | An unresolvable upstream host was reported as `403 SSRF_BLOCKED`, sending developers chasing a security block. | `checkExternalUrl` distinguishes `DNS_LOOKUP_FAILED`; proxy returns `502 UPSTREAM_DNS_ERROR` (also for DNS errors at connect time). |
| 2.11 | Low (security) | Authenticated `/api/endpoints` routes had no rate limit (unbounded DB writes per client). | 300 req/min limiter. |

Hardening done alongside (no failing behaviour, design improvements):
- `VettedUrl` branded type: `forwardRequest` only accepts a URL produced by `checkExternalUrl`, making "forgot the SSRF check" a compile error.
- Test seams: `chaos.service.sleep` (lets tests assert `delayMs = 10000` without waiting or faking timers the MongoDB driver also uses) and `forwardRequest({ timeoutMs })`.

### C. Checked and already correct (kept as regression tests)
Hostile `mockResponseJson` keys (`$where`, `a.b`, `__proto__`, `constructor.prototype`) give no 500 and no prototype pollution; PATCH rejects unknown keys next to valid ones; `alg=none`, HS512, expired and wrong-secret JWTs → 401; NoSQL operator objects in login → 400; DNS rebinding (public on check, `127.0.0.1` on connect) → 403; redirects to `169.254.169.254` are never followed; gzip bombs → `UPSTREAM_TOO_LARGE`; upstream `Set-Cookie` never reaches the client.

### D. Accepted risks (documented, not fixed)
- **Open redirect:** upstream `Location` headers pass through (needed to test redirect handling on mobile).
- **Endpoint cap race:** the 100-endpoint cap is count-then-insert, so concurrent creates can slightly exceed it.
- **HEAD → 404:** HEAD requests are not mapped to GET endpoints.
- **For the web phase:** the dashboard must **never** send its PocketChaos JWT to `/proxy/*`. The proxy forwards `Authorization` upstream by design.
- **Dev-only audit warning:** `npm audit` flags a moderate `sprintf-js` advisory inside Jest's coverage toolchain (dev-only). The suggested "fix" downgrades ts-jest to 27. `npm audit --omit=dev` reports 0 vulnerabilities.

---

## Entry #3: Built against an empty contract, then aligned to `.ai/CONTEXT.md` (2026-10-18)

- **Symptom:** Phase 1 and Entry #2 were built while `.ai/CONTEXT.md` was **0 bytes on disk**: the contract existed only in an unsaved editor buffer. The AI flagged the empty file, then inferred conventions from the prompt and the master plan. Once the file was saved, the backend diverged from it in five places.
- **Root cause:** agents read the file system, not the editor. An empty context file fails silently: nothing errors, the model just fills the gap with its own defaults.
- **Fixes (all covered by `npm test`, now 8 suites / 349 tests):**

| Contract | Was | Now |
|----------|-----|-----|
| §4 envelope | `{ success, data, error: null }` / `{ success, data: null, error }`, `details` optional | `{ success: true, data }` / `{ success: false, error: { code, message, details: [] } }`; `details` always an array (`expectSuccessEnvelope` / `expectErrorEnvelope` assert the exact shape) |
| §3.2 validation | Zod `parse` inside each controller | `validate({ body, params, query })` middleware on every route before the controller; mutation routes reject unknown query keys; issues report their `location` |
| §5 injected fault | Fixed 500 in the API envelope; `overrideStatusCode` rewrote *successful* responses | Fault returns `overrideStatusCode ?? 500` with exactly `{ chaosFault: true, message: "Injected by PocketChaos" }`; successful responses keep their real status; `overrideStatusCode` restricted to 400–599 |
| §3.1 no hardcoded URLs | `CORS_ORIGINS` defaulted to `http://localhost:5173`; proxy parsed queries against a dummy `http://pocketchaos.invalid` base | `CORS_ORIGINS` required and validated; query parsed with `URLSearchParams` |
| §3.4 naming | `req.auth.userId` | `req.user.id` |
| §2 runtime | `engines: node >=22` | `>=20.19.0` (the MongoDB driver's own floor), `@types/node@20` |

- **New bug found by the new env tests:** Zod's `z.url()` accepted `localhost:5173` as a CORS origin, because it reads `localhost:` as a URL scheme. Fixed with `z.url({ protocol: /^https?$/ })`. Guard: `tests/unit/env.test.ts`.
- **Lesson:** run a pre-flight check before any agent run (`wc -c .ai/*.md .ai/agents/*.md`), and treat an empty context or agent file as a blocker, not a warning. `.ai/agents/architect-agent.md` was still empty at this point.

---

## Entry #4: Phase 2 `/web` dashboard build + security audit (2026-10-18)

> Numbered #4 because Entry #3 already holds the CONTEXT.md alignment.

Context: React 19 + Vite 8 + TypeScript 5.9 + Tailwind 4 dashboard, Vitest 5 + Testing Library. Verified with 125 component/unit tests, `tsc -b && vite build`, and a live walkthrough in the in-app browser against the real backend (`npm run dev:memory`).
Each item is labelled **observed** (failed in a test or live run) or **review** (caught by reading the code before anything failed).

### A. State and async bugs

| # | How found | Bug | Fix | Guard |
|---|-----------|-----|-----|-------|
| 4.1 | **observed** (failing test, live-path probe) | A 2xx `{ success: true, data }` with the wrong shape (e.g. `data: null`) went straight into `.map()` / `.length`, throwing `TypeError: Cannot read properties of null` during render, which blanked the whole app with no recovery. | API client rejects non-array endpoint/log lists as `UNEXPECTED_RESPONSE` (shown by the existing retry/"Reconnecting…" UI); `ErrorBoundary` around the app, each endpoint card and the telemetry panel as a backstop. | `client.test.ts` (malformed lists), `ErrorBoundary.test.tsx` |
| 4.2 | **observed** (failing test) | If the proxy tester ever rejected, "Test in Browser" stayed on "Waiting for proxy…" forever and produced an unhandled promise rejection. | `try/catch/finally` turns it into an error result and re-enables the button. | `EndpointCard.test.tsx` |
| 4.3 | **observed** (deliberately broken code) | The test "a slow PATCH response must not overwrite a newer slider edit" still **passed** when the merge logic was removed: its second request resolved instantly, hiding the moment the slider snapped back. The app code was correct; the **test** was too weak. | Second PATCH is also deferred, so the in-between state is asserted. | Verified: passes on real code, fails on the broken version |
| 4.4 | **review** | "Test in Browser" for POST/PUT/PATCH spread `headers` twice, so `Content-Type` replaced `Accept`. | Headers built in one object. | `proxyTester.test.ts` |
| 4.5 | **review** | Hooks updated refs during render (React rule; breaks under concurrent rendering). | Ref updates moved into effects. | n/a |

### B. Layout / tooling problems

- **4.6 observed (live, 1024 px):** the navbar wrapped onto two lines and covered the top of the sticky telemetry panel. Fix: secondary navbar items only on wider screens, `lg:flex-nowrap`.
- **4.7 observed (tests):** `findBy*`/`waitFor` hang under Vitest fake timers (Testing Library only detects Jest's fakes), giving a 5 s timeout that looked like an app bug. Rule: with fake timers, `await act(() => vi.advanceTimersByTimeAsync(ms))` then synchronous `getBy*`.
- **4.8 observed (environment):** the desktop preview launcher could not start servers under `~/Desktop` (macOS privacy: `getcwd: Operation not permitted`). Servers were run from the shell instead; `.claude/launch.json` is unverified here.
- **4.9 TypeScript:** `tsc -b` on `/web` found no errors in the app code. lucide-react v1 renamed icons (`Trash2` → `Trash`, `CircleHelp` → `CircleQuestionMark`); this was found by grepping the typings before compiling. The one real TS error this phase was in the backend helper script (TS2835: dynamic `import()` under `module: nodenext` needs an extension); it now uses `require`.
- **4.10 CORS:** no CORS bug occurred. Prevented by: `server.strictPort` on 5173 (Vite can't silently move to an origin the backend rejects), the backend exposing `X-PocketChaos-Applied`, bearer tokens instead of cookies (no credentialed CORS). The live run showed the `OPTIONS … 204` preflight before each PATCH.

### C. Security audit of `/web` (sec-auditor pass)

Checked clean:
- **Secrets:** no secrets in source or bundle. A canary build with fake `JWT_SECRET` / `MONGODB_URI` / `CORS_ORIGINS` in the environment leaked **0** of them (only `VITE_*` is ever inlined; no custom `envPrefix`). No source maps shipped. `npm audit --omit=dev`: 0 vulnerabilities.
- **XSS sinks:** none. No `dangerouslySetInnerHTML`, `innerHTML`, `eval`; proxy/upstream bodies render as text in `<pre>` (test asserts an `<img onerror>` payload stays text).
- **JWT handling:** never sent to `/api/auth/*` or to `/proxy/*` (separate client); 401 session codes sign out, `INVALID_CREDENTIALS` stays inline.
- **Request load:** polling is a non-overlapping `setTimeout` chain, paused while the tab is hidden, with 429 backoff; slider PATCHes are debounced.

Accepted / recommended for deployment:
- **JWT in `localStorage`** (readable by any XSS). Recommended hardening: a build-only CSP `<meta>` (`default-src 'self'; connect-src 'self' <API origin>; object-src 'none'; base-uri 'none'`) via a `transformIndexHtml` plugin. `frame-ancestors` must come from the host's response headers. Not shipped yet because verifying it needs a `vite preview` origin added to the backend's CORS list.
- **Lost edits:** a debounced slider edit still pending when the user logs out or closes the tab within 350 ms is dropped.

---

## Entry #5: Phase 3 `/mobile` build + QA-breaker / security-auditor pass (2026-10-21)

Context: Expo SDK 58, React Native 0.88 and TypeScript 6 (strict, `noUncheckedIndexedAccess`), tested with jest-expo and React Native Testing Library v14.
- **Live checks (before the QA pass).** The build was verified on the iOS 26 simulator in Expo Go against `npm run dev:memory`: pairing, a chaos batch, the inspector, a queue that survived a kill and relaunch, and a replay of 10 queued requests that reached the server exactly 10 times. On the Android emulator, `10.0.2.2:4000` was reachable. The QA fixes in section B were verified by tests only, not re-run on a device.
- **QA pass.** It added `src/qa/` with 64 tests, bringing the total to 233 tests in 15 suites, all passing with 0 console warnings. `npx tsc --noEmit` is clean.
- **Labels.** Each item is labelled **observed** (it failed in a test or a live run before the fix) or **review** (caught by reading the code).

### A. Bugs from the build phase

| # | How found | Bug | Fix | Guard |
|---|-----------|-----|-----|-------|
| 5.1 | **review** (read the polyfill source) | React Native's `URL` polyfill is regex-based and never throws on invalid input; it also mishandles IPv6 hosts. Jest uses Node's strict WHATWG `URL`, so the validator tests passed while the real app would have accepted garbage server URLs. | `normalizeBaseUrl` now uses one explicit scheme/host/port grammar that behaves the same in both. It rejects credentials, `?` and `#`, non-http(s) schemes, and ports above 65535. | `serverPresets.test.ts` |
| 5.2 | **observed** (failing backend test) | The proxy dropped `Idempotency-Key`, so the dedupe key that queue replays depend on never reached upstream. | `idempotency-key` was added to the proxy's forwarded headers, committed separately in `97737ec`. | `upstream.service.test.ts` |
| 5.3 | **observed** (live) | Replayed requests showed "OK" even when the body was corrupted, but replays never run the integrity check. | Replays now say "Delivered (integrity not checked)". | `components.test.tsx` |
| 5.4 | **review** | The first version of `OfflineQueue.load()` wrote an empty queue when the *read* failed. | A read failure rejects without writing. 5.6 below closes the rest of this bug. | `offlineQueue.test.ts` |
| 5.5 | **review** | `RunnerContext` wrote a ref during render. | The ref write moved into an effect. 5.9 later replaced that ref with `isOffline()`. | n/a |

Tooling and TypeScript (**observed**):
- `expo install` put Jest packages under `dependencies`, so they were moved to `devDependencies`.
- TypeScript 6 needs `"types": ["jest"]`.
- Jest failed with "Cannot find module 'expo-asset'", fixed by installing `expo-asset` and `expo-font`.
- Jest also failed with "Module '1' is missing from the asset registry", fixed by mocking `@expo/vector-icons`.
- TS2339: a union of literal `kind`s did not narrow. Fixed with `kind !== 'response'`.
- TS7024: an `it.each` table written with `as const`. Fixed by typing it as `it.each<[...]>`.
- TS2353: RNTL's `toHaveTextContent` has no `normalizeWhitespace` option, so the test uses a regex instead.
- `App.tsx` imported a module that does not exist.
- Port 4000 instead of 5000, because macOS AirPlay holds port 5000.
- Simulator quirk: a `UISwitch` needs a tap with `duration: 0.25` to toggle, and screenshots lag behind inputs.

### B. QA-breaker pass: bugs proven by a failing test first, then fixed

Of the 64 QA tests, the 19 that target these bugs were run red before any fix. The other 45 are regression tests that already passed (see E).
- **Red for the right reason.** One red test first failed for an unrelated reason: a one-shot read fault was used up by the wrong caller (see D). It was corrected and re-run red before the fix.
- **5.10 re-proven.** Its first red run stopped at the new notice text. The stale-badge half was then proven separately by reverting only the badge fix: the test fails on the "sending" assertion.
- **Leak found after the fixes.** The AsyncStorage mock leak in D only appeared during the first all-green run.

| # | How found | Bug | Fix | Guard (`src/qa/`) |
|---|-----------|-----|-----|-------|
| 5.6 | **observed** | **Data loss.** After a failed queue read, the in-memory state was empty. The next `enqueue` built on it and **overwrote every saved request**. The old notice even promised that "new requests will still be queued". A sync after a failed read also reported the queue as "0 of 0". | Nothing is written until the saved queue has been read successfully. Until then, every mutation re-reads first, and `sync` reloads first. A read that keeps failing makes the change reject, which leaves the saved data intact. | `offlineQueue.qa` (3 tests), `app.qa` (an offline batch after an unreadable queue keeps the 2 saved items: 2 + 10 = 12) |
| 5.7 | **observed** | `runBatch` set `result.queued` *before* calling `enqueue`. When the queue refused (`QueueFullError` or a storage error), the row still said "queued", the summary over-counted, and the original network error message was overwritten. | `queued` is now set only after the queue accepts the request. A refused request stays `network_error`, with "…not queued (reason)" appended to its own message. | `offlineQueue.qa` › enqueue failures |
| 5.8 | **observed** | **Duplicate Run tap.** Two taps in the same frame both read `running === false` from the render closure. That started two batches: 20 requests instead of 10, sharing one integrity tracker. | A `runningRef` is set synchronously. | `app.qa` › two Run taps |
| 5.9 | **observed** | Turning on Simulate Offline **during a replay** did not stop the replay, so the remaining queued requests still went out. | The queue context keeps an `offlineRef` that the toggle sets synchronously. `replayOne` checks it for each item and returns `retryLater`. The runner now uses the same `isOffline()` instead of its own effect-synced copy. | `app.qa` › mid-replay toggle (1 request sent, 2 stay queued) |
| 5.10 | **observed** | A storage write that failed mid-sync showed a bare "write failed" notice. It also left a permanent "sending" badge, because the in-flight marker was saved but its removal was not. | The notice now says the sync stopped and that unconfirmed requests stay queued and are re-sent with the same Idempotency-Key. The badge only shows while a sync is running. | `app.qa`: the retry re-sends `key-1` and then `key-2` (at-least-once) |
| 5.11 | **observed** | If the server settings could not be read at startup, `ConfigContext` marked itself hydrated and **saved the defaults over them**. This is the same failure as 5.6. | A `mayPersist` flag allows writes only after a successful read or a user edit. | `app.qa` › settings not overwritten |
| 5.12 | **observed** | A body of 9,000 nested `[` characters is 18 KB, under the 20 KB preview limit, and `JSON.parse` handles it. `JSON.stringify(…, null, 2)` then throws a `RangeError`, which crashed the inspector into its error boundary. | `formatBody` falls back to the raw text when pretty-printing fails. | `integrity.qa`, `app.qa` |
| 5.13 | **observed** (measured) | **With corruption on for 100% of requests, corrupted bodies were reported INTACT.** There is no clean baseline in that case, so a field that the batch has no majority for was simply not judged. Measured over 1,000 batches using the backend's real `corruptJson` (table below). | When the consensus baseline has no strict majority for a field's type, or for whether the field is present, any body touching that field is **UNVERIFIED**, never INTACT. The row reads "OK (integrity unverified)" and the inspector lists the paths under "Not verifiable". Raising the majority threshold to 2/3 was also measured (400 batches) and rejected: it cut detection on a 4-field body from about 81% to 55%. | `integrity.qa` › 100% corrupted payloads |

How often a 100%-corrupted body was reported INTACT, before and after 5.13 (5 requests per batch, the default; 1,000 batches):

| Body shape | Before | After | Caught (unchanged) |
|---|---|---|---|
| 4 flat fields | 16.8% | 1.5% | ~83% |
| nested (7 fields, an array and an object) | 3.3% | 0.0% | ~96% |
| list of 3 objects | 0.5% | 0.0% | ~99% |
| 1 field | 70.7% | 32.1% | ~30% (see F) |

### C. Security audit of `/mobile` (sec-auditor pass)

- **5.14 review (hardened):** stored queue items and pairing responses are now treated as untrusted input.
  - **Stored queue items:** `projectKey` must match `^[A-Z0-9]{6}$`, and `path` must not contain `.` or `..` segments, including the `%2e` and backslash forms that URL parsers resolve. Items failing this are treated as corrupt storage, so they are never replayed.
  - **Pairing responses:** the endpoint `path` and `proxyPath` get the same check. This means a hostile pairing server cannot steer requests to `/proxy/K7Q2XM/../../api/...`.
  - **Tests:** 11 invalid-key variants never reach the network: lowercase, symbols, a space, a dash, `Ä`, a full-width `Ｋ`, a trailing `\n`, 5 or 7 characters, empty, and `../../`.
- **Checked clean:**
  - **Secrets:** no hardcoded secrets. Only `EXPO_PUBLIC_*` values (a base URL and a port, which are not secrets) are inlined. A canary `expo export` for iOS and Android had 0 hits, and `.env` is ignored by the root `.gitignore`.
  - **Code hygiene:** no `console.*`, no `any`, and no WebView or HTML rendering. Response bodies always render as `<Text>`, and a test asserts that `<script>` and `<img onerror>` payloads stay as text.
  - **Credentials:** the device never holds a JWT, because it uses key-only routes.
  - **Contained failures:** every screen and the inspector have an error boundary.
- **Accepted:**
  - **Cleartext HTTP.** `usesCleartextTraffic` on Android and `NSAllowsLocalNetworking` on iOS are there for LAN development only. Drop cleartext for a release build pointed at an HTTPS cloud URL.
  - **`npm audit`.** It reports 22 findings, all in Expo and Metro build tooling, none of which is in the shipped bundle.

### D. Test-infrastructure lessons (**observed**)

- **A one-shot fault was used up by the wrong caller.** `MemoryStorage.failNextRead` was consumed by the *simulate-offline flag* read, which happens to run first. The queue load succeeded, and the test failed for a reason unrelated to the bug. Fix: `failNextReadOf(key)` targets a single key.
- **`restoreMocks` does not restore AsyncStorage's mock.** `jest.spyOn` on the AsyncStorage mock returns its existing `jest.fn`, which `restoreMocks` never restores. A rejecting `setItem` leaked into two later tests. Restore it by hand with `getMockImplementation()`.
- **A fake Axios adapter never times out.** Axios enforces `timeout` only inside its built-in adapters. The timeout tests therefore use a deadline transport on fake timers instead.
- **Two `fireEvent.press` calls can't reproduce a double tap.** RNTL re-renders between them, which disables the button. A probe component calls the context function twice inside one `act()` instead.

### E. Checked and already correct (kept as regression tests)

- **Single-flight sync:** a second and third tap return the *same* promise, and a tap after completion starts a fresh sync.
- **Empty queue:** replaying an empty queue makes 0 replay calls and 0 storage writes.
- **Unsaved in-flight marker:** a request whose marker could not be saved is never sent.
- **Timeout boundary:** a response at 3,999 ms against a 4,000 ms timeout is a success with no retry; at 4,000 ms it is a timeout. Every retry gets the full timeout, and the worst case with 2 retries is exactly 12,900 ms.
- **Timeouts:** a timeout is never queued, because delivery is ambiguous.
- **Malformed JSON:** seven malformed bodies all give INVALID_JSON without a crash: truncated, empty, an HTML error page, `NaN`, two concatenated documents, a trailing comma, and single quotes.
- **Broken 5xx bodies:** a 5xx with a garbage body stays a 5xx fault.
- **Malformed pairing responses:** each gives `UNEXPECTED_RESPONSE`.

### F. Known limitations

- **1-field bodies at 100% corruption.** Consensus cannot recover the schema when every response corrupts the only field, and a wrong type can win the majority (about 21–32% still INTACT). The fix is a trusted baseline: one request with corruption off, or a clean batch earlier. The tracker keeps that baseline across batches.
- **At-least-once replay.** A delivered request whose removal could not be saved is re-sent. This relies on upstream honouring `Idempotency-Key`, which the proxy forwards since `97737ec` (5.2).
- **Whole-queue reset.** Corrupt or tampered storage resets the whole queue rather than dropping only the bad items. That is simpler, and the user is told.
- **Early offline toggle.** If Simulate Offline is toggled before its saved value has loaded (the first few ms after launch), the load can overwrite the toggle.
