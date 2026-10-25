# A.V.O. Safety Audit — 2026-10-25 (rev. 2, after independent review)

Prepared by Claude (CTO). Scope: offline only. $0 API spend, no live A.V.O.
model calls in this phase, no payments, deployments, unattended schedules or
credential changes. Times are UTC; New York is UTC−4 (14:37 UTC = 10:37 local).

**Labels.** VERIFIED = backed by a command, log and file:line below ·
REPORTED = stated by someone, not checked here · UNVERIFIED = not yet shown ·
BLOCKED = cannot proceed without something missing · REQUIRES CEO = Jahmod decides.

**Where evidence lives:** `avo/reports/evidence/`. "Sandbox" = the Linux shell
Claude uses on Jahmod's laptop, reading `C:\Users\boogi\jarvis` directly. It
is not Windows; nothing here was run on Windows by Claude.

## 1. Controls and their real strength

| Control | Status | Code | Test (file:line) / evidence |
|---|---|---|---|
| Agents can only talk: no built-in tools, no MCP servers, no settings or hooks | VERIFIED (code + test that prompts say so) | `avo/staff.mjs:76-78` | `test/avo.test.mjs:86` |
| Claude seats run with all API keys stripped from their environment, so they can only use the Claude Code subscription login | VERIFIED | `avo/staff.mjs:62`, `:84` | `test/avo.test.mjs:244`. Also: no `.env.local` exists in the repo today, so earlier runs could not have loaded one (`ls` in sandbox, 15:12 UTC) |
| Paid engines (OpenAI, Gemini) need `AVO_ALLOW_PAID=1` + key + exact model + a CEO approval entry **for that engine** (`paid-api-openai` / `paid-api-gemini`) | VERIFIED | `avo/staff.mjs:98-103` | `test/avo.test.mjs:71`, `:163` |
| Approval entries count only if `approvedBy` is "Jahmod", `date` and `expires` are real YYYY-MM-DD dates, and today is within them | VERIFIED | `avo/control.mjs:40-71` | `test/avo.test.mjs:138` |
| Agent text claiming approval is never read as approval; transcripts print every decision as `[PENDING]` | VERIFIED | `avo/office.mjs:88` | `test/avo.test.mjs:172` |
| **Limit:** the approvals file is not tamper-proof authorization. Anything that can write to the folder can forge an entry. It stops tool-less agents and accidents, not a compromised PC. | KNOWN LIMIT | `avo/control.mjs:15-19` | — |
| **Limit:** no spend cap exists anywhere. | KNOWN LIMIT → paid use stays disabled | `avo/control.mjs:18` | — |
| Emergency stop: `avo\STOP`, `avo\STOP.txt`, or `AVO_STOP` = 1/true/yes/on. Checked before start (exit 4) and before every turn; a halted run also exits 4 | VERIFIED | `avo/control.mjs:32`, `avo/run.mjs:49-52`, `:79`, `:116`, `avo/office.mjs:38` | `test/avo.test.mjs:112`, `:124`, `:249`; `evidence/08-runner-stop-and-mock.log` (exit 4) |
| **Limit:** stop is checked between turns; a model call already in progress finishes first (up to 60 s for paid engines, unbounded for the Claude seat) | KNOWN LIMIT | — | — |
| Secrets in environment variables redacted from replies, errors, transcripts | VERIFIED | `avo/office.mjs:10` | `test/avo.test.mjs:48` |
| Stand-ins labelled `STAND-IN, played by Claude — not the real <name>` on every line, and told so | VERIFIED | `avo/staff.mjs:42`, `:152` | `test/avo.test.mjs:57`, `:64`, `:79` |
| Prompt rule: CEO silence never triggers action | VERIFIED in code; behaviour shown in **one** live run only | `avo/staff.mjs:49` | `test/avo.test.mjs:94`; live run `2026-10-25T14-41-32-629Z-meeting-mode-guest` (agents waited) |
| Safety detector (tripwire, wording-based) | VERIFIED on 30 test sentences + 2 real transcripts. **Not a control**: a plainly worded action ("Gemini publishes the copy now") is not detected | `avo/safety.mjs:29-84` | `test/avo.test.mjs:180`, `:224`, `:232`, `:238`; `evidence/04-safety-scan-live-runs.log` |
| Audit log `avo/audit.log`: one append-only line per scenario run | VERIFIED (written by mock runs at 15:14 UTC); not yet written by a live run | `avo/run.mjs:94` | `evidence/08-runner-stop-and-mock.log` |

## 2. Findings and fixes

| # | Finding | Status | Evidence |
|---|---|---|---|
| F1 | Old rules: agents agreed to act "under assumed approval" when the CEO was silent (14:34 and 14:37 UTC runs, meeting-mode). The real Claude seat agreed (14:37 run, turn 8). Nothing left the simulation. | FIXED (rule + tripwire) | `evidence/04-safety-scan-live-runs.log` (2 and 3 flags); `test/fixtures/avo-run-1037-overreach.jsonl` |
| F2 | `blockedAddress` allowed empty, missing and any non-IP input (`''`, `null`, `localhost`, `not-an-ip`, `:::`) | FIXED | `bridge/net.mjs:108`; `evidence/01-network-gate.log` (before = ALLOWED, after = blocked); `test/net.test.mjs:46` |
| F3 | `blockedAddress` compared IPv6 as strings: long-form loopback, `::7f00:1`, NAT64 and 6to4 forms of private addresses were allowed. Found by the independent reviewer; pre-existing. | FIXED | `bridge/net.mjs:56`, `:110-124`; `evidence/06-network-gate-review-fixes.log` (11 wrong of 37 → 0); `test/net.test.mjs:94` |
| F4 | `192 && b === 0` blocked all of 192.0.0.0/16 (e.g. public 192.0.78.9), not the /24 its comment says. Pre-existing. | FIXED | `bridge/net.mjs:98`; `test/net.test.mjs:103` |
| F5 | Detector rev. 1: any earlier negative word hid an overreach ("We don't have time so we proceed without approval"); it also missed conditionals and over-matched (`act` had no word boundary). Found by the reviewer. | FIXED in rev. 2 | `avo/safety.mjs:49-71`; `test/avo.test.mjs:180` |
| F6 | Approvals accepted any `date` string, never expired, and one `paid-api` entry unlocked both engines | FIXED | `avo/control.mjs:40-71`; `test/avo.test.mjs:138`, `:163` |
| F7 | A stray `ANTHROPIC_API_KEY` could have billed the API from a Claude seat | FIXED (keys stripped) | `avo/staff.mjs:62`, `:84`; `test/avo.test.mjs:244` |
| F8 | A run halted mid-way exited 0; only `AVO_STOP=1` exactly worked | FIXED | `avo/run.mjs:116`; `test/avo.test.mjs:124` |
| F9 | Digest rev. 1 said approval could be given by telling Claude or Halle, which contradicts the gate | FIXED | `4-CEO-DECISION-DIGEST.md` |
| F10 | Stand-ins quoted Claude Code memory as fact (14:27 UTC run) | FIXED by running seats from an empty folder (`avo/staff.mjs`, `cwd`). Absence in later runs: REPORTED by manual read, no automated check | — |
| F11 | Claude created a test `avo\STOP` it could not delete, which would have blocked all runs | FIXED: file removed after Jahmod granted deletion; stop tests now use temp folders | REPORTED (no log captured) |

## 3. Open risks

| Risk | Status |
|---|---|
| Wording detector can be bypassed by plain phrasing | KNOWN LIMIT; approval gate is the control |
| Approval file can be forged by anything with write access | KNOWN LIMIT; needs signing or an out-of-band approval channel before real actions exist |
| No budget limiter / spend cap | BLOCKED: must be designed and built before any paid seat. Paid use stays disabled |
| Emergency stop does not cut off an in-flight model call | KNOWN LIMIT; add an abort signal per call (next) |
| IPv4 with dotted tail inside other IPv6 prefixes (e.g. `64:ff9b::8.8.8.8`) is blocked even when public | Over-blocks (fails closed); acceptable |
| Gemini review | COMPLETE by evidence review, 15:26 UTC: Gemini reviewed `GEMINI-EVIDENCE-PACKET.md` and `evidence/09`, did not execute anything herself, and replied "Review complete." (REPORTED: her reply in the Gemini app) |
| Every Halle/Gemini line in any transcript is a Claude stand-in, not their view or approval | By design |
| `audit.log` uses one append per scenario from a single process; parallel runs (not supported today) could interleave lines | OPEN (raised by Gemini). If parallel runs are added: per-run files or a lock |
| Approval dates are read in the laptop's **local** date, and include the whole `expires` day. A different machine or time zone could open or close the window up to a day early or late | OPEN (raised by Gemini). Documented in `avo/control.mjs`; set `expires` with a day's margin |
| Safety detector is English-only and phrase-bound (slang, other languages, "I am executing this now") | KNOWN LIMIT (raised by Gemini; same as above) |
