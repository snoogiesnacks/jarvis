# A.V.O. Test Results — 2026-10-25 (rev. 2)

## Fresh run

| Field | Value |
|---|---|
| Command | `npm test` → `node --test` |
| Where | Linux sandbox reading `C:\Users\boogi\jarvis` (not Windows) |
| Started | see first lines of `evidence/02-npm-test.log` |
| Exit code | 0 |
| Tests | **50** |
| Pass | **50** |
| Fail | 0 |
| TODO | 0 |
| Skipped | 0 |
| Cancelled | 0 |

Raw logs: `evidence/02-npm-test.log` (full TAP), `evidence/07-net-tests.log`
(network gate, 11/11), `evidence/08-runner-stop-and-mock.log` (runner exit
codes: 4 under stop, 0 for a mock run).

## Per file

| File | Tests | Was at "36" |
|---|---|---|
| `test/avo.test.mjs` | 24 | 13 |
| `test/net.test.mjs` | 11 | 8 (incl. the TODO) |
| `test/fish.test.mjs` | 6 | 6 |
| `test/with-env.test.mjs` | 6 | 6 |
| `test/package-scripts.test.mjs` | 3 | 3 |
| **Total** | **50** | **36** |

## Reconciliation: 36 / 35 / 1 TODO / 0 fail → 50 / 50 / 0 / 0

- The old TODO was `test/net.test.mjs` "blockedAddress fails closed on empty or missing input": a known defect reported as `todo`, never as a pass. The defect is fixed, and the test is now a real, passing test (`test/net.test.mjs:46`). That turns 35 pass + 1 TODO into 36 pass.
- **+3 network tests:** public IPv6 still allowed (`:52`); IPv6 judged by value (`:94`); public addresses wrongly blocked before (`:103`).
- **+11 A.V.O. tests:**
  - emergency stop halts before next turn (`:112`);
  - stop file / `AVO_STOP` detection (`:124`);
  - dated, unexpired CEO approvals (`:138`);
  - per-engine paid approval (`:163`);
  - agent text is not approval (`:172`);
  - detector categories (`:180`);
  - documented detector limit (`:224`);
  - two regressions on real transcripts (`:232`, `:238`);
  - API keys stripped from Claude seats (`:244`);
  - runner exits 4 under stop (`:249`).
- One older test (`:71`) was updated for per-engine approval ids.
- 36 + 3 + 11 = **50**.

Correction to rev. 1 of this report: it said "+7 A.V.O. tests" while listing 8, and its total of 45 was right only by that list. Superseded by the counts above.

## History (REPORTED from this session's earlier messages; earlier logs were not kept)

| Approx. time (local) | Total | Pass | TODO | Fail |
|---|---|---|---|---|
| 10:17 | 34 | 33 | 1 | 0 |
| 10:38 | 35 | 34 | 1 | 0 |
| 10:42 | 36 | 35 | 1 | 0 |
| 11:05 | 45 | 45 | 0 | 0 |
| 11:14 (fresh log) | 50 | 50 | 0 | 0 |

## Not covered

- **UNVERIFIED:** anything on Windows itself.
- **UNVERIFIED:** the frontend build and the Fish Audio voice (Jahmod's listening test is pending).
- **BLOCKED:** live A.V.O. model calls (none in this phase) and any paid API call (disabled).
