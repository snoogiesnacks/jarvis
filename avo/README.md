# A.V.O. — Autonomous Virtual Office simulation

Halle, Claude and Gemini work through a situation together, taking turns on
their own until they agree a plan (`[RESOLVED]`) or hit the turn limit. Each
run saves a transcript and a list of **decisions for the CEO** to `avo/runs/`.

## Run it

| How | What runs |
|---|---|
| Double-click `avo\Run-AVO.cmd` | All 3 scenarios, live |
| `npm run avo -- --scenario fish-live-test` | One scenario |
| `npm run avo:mock` | Dry run, no network |
| `npm test` | Test suite (includes `test/avo.test.mjs`) |

Scenarios: `fish-live-test`, `clean-pro-double-charge`, `meeting-mode-guest`
(see `scenarios.mjs`; premises are marked, not real events).

## Who is at the table

Default: **Claude is real** (Claude Agent SDK on your Claude Code login, the
same path as the JARVIS bridge). **Halle and Gemini are stand-ins**: Claude
playing them, labelled `STAND-IN` in every line and transcript. A stand-in is
not the real agent and nothing it says is that agent's view or approval.

To seat the real Halle / Gemini (paid APIs — approve a spend cap first), add to
`.env.local` (never `VITE_`):

```
AVO_ALLOW_PAID=1
AVO_HALLE=openai
OPENAI_API_KEY=...
AVO_HALLE_MODEL=<exact OpenAI model name>
AVO_GEMINI=gemini
GEMINI_API_KEY=...
AVO_GEMINI_MODEL=<exact Gemini model name>
```

A missing piece is an error, never a silent switch.

## Safety rails

- Talk only: no tools, no MCP servers, no settings or hooks loaded.
- Agents may not claim real-world actions; CEO-only items are flagged `CEO DECISION:`.
- Secrets from the environment are redacted from every reply and error.
- Hard turn limit (`--max-turns`, default 8) caps usage.
