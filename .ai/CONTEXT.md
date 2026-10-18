# PocketChaos — Master AI Context & Engineering Contract

## 1. Project Overview
PocketChaos is a full-stack developer tool (Web Control Plane + Node Chaos Proxy + React Native Mobile Companion) that allows mobile engineers to test how their apps behave under poor network conditions, latency spikes, HTTP 5xx/4xx failures, and corrupted JSON responses without modifying backend code.

## 2. Monorepo Architecture & Tech Stack
- `/backend`: Node.js (v20+), Express.js, TypeScript, MongoDB (Mongoose), Zod (validation), Jest + Supertest (testing).
- `/web`: React (Vite + TypeScript), TailwindCSS, Axios, Lucide Icons.
- `/mobile`: React Native (Expo SDK + TypeScript), AsyncStorage (for Offline Queue persistence), Axios.

## 3. Strict Security & Guardrail Rules (MANDATORY)
1. **Zero Hardcoded Secrets:** Never hardcode JWT secrets, MongoDB URIs, or URLs. Use `.env` and validate all environment variables at startup in `/backend/src/config/env.ts` using `zod`. Always maintain a safe `.env.example`.
2. **Input Validation:** Every Express `POST`, `PUT`, and `PATCH` route must validate `req.body`, `req.params`, and `req.query` using a Zod schema middleware before hitting the controller.
3. **SSRF Protection (Server-Side Request Forgery):** When `/proxy/:projectKey/*` forwards requests to a user-provided `targetUrl`, strictly validate the URL protocol (`http:` or `https:` only) and block `localhost`, `127.0.0.1`, `0.0.0.0`, `169.254.169.254`, and private IPv4/IPv6 ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
4. **Authentication & Ownership:** All `/api/endpoints/*` management routes require a valid Bearer JWT. Users may only view, modify, or delete endpoints they own (`endpoint.userId === req.user.id`).

## 4. Standardized API Response & Error Contract
All `/api/*` endpoints must return JSON adhering to this structure:
- **Success:** `{ "success": true, "data": <T> }`
- **Error:** `{ "success": false, "error": { "code": "STRING_CODE", "message": "Human-readable message", "details": [] } }`

## 5. Core Domain Logic: The Chaos Proxy Engine (`/proxy/:projectKey/*`)
When the React Native app sends a request to `/proxy/:projectKey/any/subpath`:
1. Look up the matching `ChaosEndpoint` by `projectKey`, `method`, and normalized `path`.
2. If `chaosConfig.enabled === true`:
   - **Latency Injection:** If `delayMs > 0`, pause execution for `delayMs` milliseconds (strictly capped at 10,000ms max to prevent server thread exhaustion).
   - **Probabilistic Failure:** Generate a random number between 0 and 100. If less than `failureRate`, immediately abort and return `chaosConfig.overrideStatusCode` (default `500`) with `{ "chaosFault": true, "message": "Injected by PocketChaos" }`.
   - **Payload Corruption:** If the request succeeds and `corruptJson === true`, mutate the outgoing JSON object (e.g., replace a random field value with `null` or corrupt an array/string type) while keeping HTTP 200 headers intact so the mobile client's parser/validator is stress-tested.
3. Record a `RequestLog` document with latency, status returned, and which chaos rule triggered.

## 6. Coding & Testing Standards
- Write modular, small functions with explicit TypeScript interfaces (avoid `any`).
- Every backend feature or middleware must have unit, boundary edge-case, and negative tests in `/backend/tests/`.