# A.V.O. Readiness — 2026-10-25 (rev. 2)

## Verified capabilities

- **VERIFIED:** turn-taking conversations reach a plan or the turn limit.
  - 11 live runs on Windows, started by Jahmod: 9 resolved in 4–7 turns, 2 hit the 8-turn limit (`evidence/03-avo-runs-index.log`).
  - Mock runs pass in the sandbox (`evidence/08-runner-stop-and-mock.log`).
- **VERIFIED:** the real Claude seat runs on Jahmod's Claude Code login with API keys stripped. Halle and Gemini are labelled Claude stand-ins.
- **VERIFIED (code + tests):** CEO gating (with the limits in the Safety Audit) and the emergency stop.
- **VERIFIED (mock runs only):** the audit log is written.
- **VERIFIED:** each run leaves a transcript (`.md`) and raw turns (`.jsonl`) in `avo/runs/`.

## Remaining blockers, in Halle's order

| # | Item | Status |
|---|---|---|
| 1 | Network gate fail-closed + regressions | DONE (`bridge/net.mjs`; `test/net.test.mjs:46`, `:94`, `:103`) |
| 2 | CEO approval enforcement + emergency stop | DONE in code; approval file not tamper-proof; stop does not abort an in-flight call |
| 3 | Accurate safety detection + audit logging | DONE as a tripwire; wording-based limits documented |
| 4 | Four evidence-backed reports | DONE (this set, rev. 2) |
| 5 | Budget limiter design | NOT STARTED: design only, stays inactive. Must precede any paid seat |
| — | Real Halle / Gemini seats | REQUIRES CEO + BLOCKED on #5 |
| — | Unattended runs (Windows Task Scheduler) | REQUIRES CEO |
| — | Gemini independent check of these fixes | BLOCKED: Gemini has no repo or log access (REPORTED by Halle) |

## Next offline steps ($0)

1. Abort signal so the emergency stop cancels an in-flight model call.
2. Budget-limiter design doc: per-run and monthly caps, hard stop, off by default.
3. End runs with `[BLOCKED ON CEO]` instead of burning turns on a pending decision.
4. Daily decision digest generated from `audit.log`.
5. A way to give Gemini read-only evidence, for example these report files pasted or uploaded by Jahmod.
