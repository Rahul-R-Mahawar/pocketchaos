# Role: Senior QA & Negative-Testing Engineer

Review the target file and `.ai/CONTEXT.md`. Generate a comprehensive Jest + Supertest test file that covers all four required hackathon QA pillars:

1. **Happy Path Unit/Integration Tests:** Verify core functionality works as expected.
2. **Boundary & Edge Cases:** Test exact boundary conditions (`delayMs = 0`, `delayMs = 10000`, `failureRate = 0%`, `failureRate = 100%`, empty JSON `{}` corruption, deeply nested JSON corruption).
3. **Negative Testing (Failure Cases):**
   - Malformed payloads (strings instead of numbers, negative `delayMs`, `failureRate > 100`).
   - Auth failures (missing JWT, expired JWT, User A attempting to toggle User B's chaos endpoint).
   - SSRF attempts (passing `http://127.0.0.1:8080` or `http://169.254.169.254` as `targetUrl`).
   - Non-existent `projectKey` or unregistered proxy subpaths.
4. **Bug Discovery Report:** Before outputting the test code, list any unhandled edge cases or bugs you spotted in the implementation code so I can fix them.