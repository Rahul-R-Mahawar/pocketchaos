# Submission assets

Everything needed to present, demo and package PocketChaos for the FiftyFive Build With AI Hackathon 2026. These tools have no dependencies; they need Node 22.18+ and, for the PDF, any Chrome-family browser.

| File | What it is | How to use it |
|---|---|---|
| `presentation-deck.html` | 8-slide dark-mode deck: problem, solution, architecture, security, AI workflow, QA, learning from AI failures | Open in a browser. Use ← / → (or swipe) to move and **F** for full screen. **Print / Save as PDF** gives one 16:9 page per slide. |
| `SUBMISSION_REPORT.md` | The written submission: product, architecture, AI development workflow, QA, and the page 9 checklist | Read on GitHub or in an editor. This file is the source for the PDF. |
| `export-pdf.mjs` | Markdown → print-styled HTML → PDF | `npm run export:pdf` (in this folder) writes `SUBMISSION_REPORT.html` and `PocketChaos_Submission_Report.pdf` |
| `demo-seeder.ts` | One-click demo data: demo account, large project-key banner, 3 chaos endpoints, optional live traffic | `node submission-assets/demo-seeder.ts --traffic` (see `--help`); the backend must be running |
| `VIDEO_PRODUCTION_GUIDE.md` | 5-minute narration in five timed blocks, second-by-second screen choreography, AI voiceover / Remotion / Playwright notes | Read before recording |
| `package-submission.sh` | Builds `dist/PocketChaos_Hackathon_Submission.zip`: the committed project and full Git history, after a secret scan | `./submission-assets/package-submission.sh` (see `--help`) |

**Credentials.** The demo seeder never prints the demo password. It takes `DEMO_PASSWORD` from the environment, or generates one once and stores it in `submission-assets/.env.demo.local`. That file is git-ignored by `.env.*` and never packaged.

**Packaging.** `package-submission.sh` packages only what is committed, so commit this folder before building the final ZIP.
