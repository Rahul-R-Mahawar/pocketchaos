# Project Blueprint: PocketChaos
**Tagline:** Mobile API Chaos Proxy & Negative-Testing Companion
**Hackathon:** FiftyFive Build With AI Hackathon 2026 (Deadline: 30 Oct 2026 EOD)
**Developer:** Solo Participant
**Tech Stack:** MERN (MongoDB, Express.js, React, Node.js) + React Native (Expo / TypeScript)

---

## 1. Problem Statement & Core MVP Scope
### The Problem
Mobile developers struggle to test how their React Native, Flutter, or Android apps handle real-world network failures (flaky 3G latency, unexpected 500/401 status codes, dropped packets, or corrupted JSON payloads) without modifying backend code or setting up complex desktop SSL proxies.

### The Solution (Focused MVP)
A two-part developer tool:
1. **PocketChaos Web Dashboard & Proxy Server (MERN):** Developers create a project, define mock or proxied API routes, and toggle live "Chaos Rules" (Latency injection, Error rate %, Status code override, Payload corruption).
2. **PocketChaos Mobile Companion (React Native):** Developers pair their phone via a 6-character `projectKey`, trigger automated resilience test runs against the chaos endpoints, test offline request queueing, and inspect real-time pass/fail telemetry on their device.

### Scope Boundaries (Build Smart, Not Big)
- **IN SCOPE:** JWT Authentication, Project & Endpoint CRUD, Chaos Rule Engine Middleware, Live Request Logs, React Native Test Runner & Offline Queue Tester.
- **OUT OF SCOPE:** System-level VPN/SSL MITM packet sniffing, billing/subscriptions, multi-organization RBAC.

---

## 2. Repository Structure (Monorepo)
Initialize Git immediately (`git init`) and commit iteratively. Full Git history is mandatory for submission.

- `.ai/` — AI Context Engineering, Custom Agents, and Failure Learning Log
- `backend/` — Node.js + Express + TypeScript + MongoDB + Jest/Supertest
- `web/` — React (Vite + TypeScript + TailwindCSS) Control Plane Dashboard
- `mobile/` — React Native (Expo + TypeScript) Mobile Testing Companion
- `README.md` — Setup, Architecture, and AI Workflow documentation

---

## 3. Data Models & API Contracts

### MongoDB Schemas
1. **User:** `_id`, `email` (unique), `passwordHash`, `createdAt`
2. **ChaosEndpoint:**
   - `_id`, `userId`, `projectKey` (6-char uppercase code for mobile pairing)
   - `name`, `path` (e.g., `/users/profile`), `method` (`GET` | `POST` | `PUT` | `DELETE`)
   - `targetUrl` (optional: forward to safe external URL, or return `mockResponseJson`)
   - `chaosConfig`:
     - `enabled` (boolean)
     - `delayMs` (number, 0 to 10000)
     - `failureRate` (number, 0 to 100 percentage)
     - `overrideStatusCode` (number, e.g., 500, 503, 401, 429)
     - `corruptJson` (boolean: replaces random field values with `null` or corrupts types)
3. **RequestLog:** `_id`, `endpointId`, `projectKey`, `timestamp`, `method`, `path`, `statusReturned`, `latencyMs`, `chaosApplied` (string), `clientPlatform`

### Core API Endpoints
- `POST /api/auth/register` & `POST /api/auth/login` (Returns JWT)
- `GET /api/endpoints` & `POST /api/endpoints` (CRUD for rules, validated with Zod)
- `PATCH /api/endpoints/:id/chaos` (Instant toggle for chaos parameters)
- `DELETE /api/endpoints/:id` (Deletes endpoint owned by user)
- `GET /api/logs/:projectKey` (Returns latest 50 request logs for live dashboard/mobile view)
- `GET /api/mobile/pair/:projectKey` (Fetches active endpoints & chaos scenarios for the React Native app)
- `ALL /proxy/:projectKey/*` (**The Chaos Engine Route**: intercepts requests, evaluates `chaosConfig`, applies delay/status/corruption, logs telemetry, and returns response)

---

## 4. 12-Day Execution Roadmap (Oct 18 – Oct 30, 2026)
- **Days 1–2 (Oct 18–19):** Initialize Git, commit `.ai/` files, build `/backend` Auth + Endpoint CRUD + Zod validation.
- **Days 3–4 (Oct 20–21):** Build `/proxy/:projectKey/*` Chaos Engine + SSRF protection + Jest/Supertest negative test suite.
- **Days 5–6 (Oct 22–23):** Build `/web` React dashboard (Auth screens, Endpoint creator, live Chaos sliders, Request log table).
- **Days 7–8 (Oct 24–25):** Build `/mobile` React Native app (Project Key pairing screen, Batch Chaos Test Runner, Offline Queue simulator, Payload Inspector).
- **Days 9–10 (Oct 26–27):** Run full QA & Security audits using `.ai/agents/`, fix bugs, and document findings in `.ai/AI_LEARNING_LOG.md`.
- **Days 11–12 (Oct 28–30):** Deploy Backend & Web UI, build Android APK, scrub secrets, verify Git history, and record the 5-minute demo video.