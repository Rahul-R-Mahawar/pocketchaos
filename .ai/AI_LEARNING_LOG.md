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
