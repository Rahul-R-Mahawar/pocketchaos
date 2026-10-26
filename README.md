# PocketChaos

**Mobile API Chaos Proxy & Negative-Testing Companion**: a FiftyFive Build With AI Hackathon 2026 submission.

PocketChaos lets mobile developers put their app on a bad network, a flaky server and a drifting API contract on demand. There is no backend change and no device certificate to install. Point the app at one proxy URL, switch chaos rules on from a web dashboard, and test resilience from a phone.

| App | What it does | Stack |
|---|---|---|
| [`backend/`](backend) | Control-plane API plus the chaos proxy `/proxy/:projectKey/*` (latency, injected faults, JSON corruption, telemetry) | Express 5, TypeScript, MongoDB/Mongoose, Zod, JWT |
| [`web/`](web) | Dashboard: endpoints, live chaos controls, live telemetry | React 19, Vite, Tailwind CSS |
| [`mobile/`](mobile) | Companion app: pairing, batch chaos runner, schema-integrity detector, offline queue and replay, payload inspector | Expo SDK 58, React Native, TypeScript |

## Live demo

| | URL |
|---|---|
| Dashboard | https://pocketchaos.onrender.com |
| API / chaos proxy | https://pocketchaos-backend.onrender.com (health: [`/health`](https://pocketchaos-backend.onrender.com/health)) |
| Mobile app (web preview) | https://pocketchaos-mobile-web.onrender.com: the Expo app built for the browser. Try pairing, the Chaos Runner and the offline queue without installing anything |

Register an account on the dashboard, or ask for the demo account details through the submission process; no credentials are kept in this repository. The deployment is defined in [`render.yaml`](render.yaml): a Node web service, the dashboard and a browser build of the mobile app as static sites, with MongoDB Atlas behind it.

## Quick start

Requires Node 20.19+ (Node 22.18+ for the demo seeder). No MongoDB install is needed for local runs.

```bash
# 1. Backend with an in-memory MongoDB (data is discarded on exit)
cd backend && npm install
JWT_SECRET=$(openssl rand -hex 32) CORS_ORIGINS=http://localhost:5173 npm run dev:memory

# 2. Web dashboard → http://localhost:5173
cd web && npm install
npm run dev

# 3. Demo account, three chaos endpoints and live traffic (prints the project key)
node submission-assets/demo-seeder.ts --traffic

# 4. Mobile app in Expo Go or a simulator; pair with the project key
cd mobile && npm install && npx expo start
```

For a persistent setup, copy each app's `.env.example` to `.env` and fill it in. Secrets are never committed: the backend validates its environment with Zod at startup and refuses to boot without a strong `JWT_SECRET`.

## How it works

1. Sign up on the dashboard; the account gets a 6-character **project key**.
2. Define an endpoint: either mock JSON, or forwarding to an upstream URL that passes the SSRF checks.
3. Set chaos rules:
   - **Delay:** 0–10,000 ms.
   - **Failure rate:** 0–100%.
   - **Fault status:** 400–599.
   - **Corrupt JSON:** on or off.
4. Pair the phone with the key. The phone never holds a password or token.
5. Run a batch from the phone (timeouts, exponential backoff, offline queueing) and watch the telemetry on the web.

Every proxied response carries `X-PocketChaos-Applied`, e.g. `delay:250ms,corrupt_json:3`.

## Tests

```bash
cd backend && npm test   # 349 tests: Jest, Supertest, in-memory MongoDB
cd web     && npm test   # 125 tests: Vitest, Testing Library
cd mobile  && npm test   # 233 tests: jest-expo, RN Testing Library
```

That is 707 automated tests in total. They include boundary cases (`delayMs` 0/10,000/10,001, `failureRate` 0/100) and negative cases: SSRF, DNS rebinding, JWT tampering, cross-user access, malformed JSON, storage failures and duplicate taps.

## Security highlights

- **Configuration:** no hardcoded secrets or URLs; the environment is validated at startup.
- **Ownership:** a Bearer JWT pinned to HS256, and every query scoped to its owner.
- **Input validation:** Zod on every body, param and query.
- **Rate limits:** on every route group.
- **SSRF guard (`isSafeExternalUrl`):** http(s) only. It blocks loopback, RFC 1918, link-local and cloud metadata (`169.254.169.254`) and private IPv6, and pins DNS at connect time.
- **Proxy responses:** sandboxed with a CSP.

## AI-assisted development

This project was built with Claude Code against written context:

- [`POCKETCHAOS_MASTER_PLAN.md`](POCKETCHAOS_MASTER_PLAN.md): problem, scope, data models, API contracts.
- [`.ai/CONTEXT.md`](.ai/CONTEXT.md): the engineering contract (security rules, response envelope, chaos-engine semantics, standards).
- [`.ai/agents/`](.ai/agents): `architect-agent`, `qa-breaker-agent` and `sec-auditor-agent` roles.
- [`.ai/AI_LEARNING_LOG.md`](.ai/AI_LEARNING_LOG.md): every AI failure recorded as *symptom → cause → fix → guard*.

## Submission assets

[`submission-assets/`](submission-assets) holds:
- The slide deck.
- The submission report: [Markdown](submission-assets/SUBMISSION_REPORT.md) and [PDF](submission-assets/PocketChaos_Submission_Report.pdf).
- The demo seeder.
- The video production guide.
- The ZIP packager, which runs a secret scan of the tree and full history before building the archive.

## Status and limitations

- **Deployment:** live on Render's free tier (see [Live demo](#live-demo)); a sleeping service takes about 50 s to wake on the first request.
- **Telemetry:** uses 2-second polling, not WebSockets.
- **Dashboard login:** the JWT is kept in `localStorage`.
- **Network config:** cleartext HTTP is enabled for LAN development only.

See §2.7 of the [submission report](submission-assets/SUBMISSION_REPORT.md) for the full list.
