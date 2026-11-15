# CEO Decision Digest — 2026-10-25 (rev. 2)

Everything below is **PENDING**. Nothing in this file is approved. Silence approves nothing.

**How approval works:** only Jahmod approves.
- For a decision in this list, telling Claude or Halle what you've decided is fine. They then act only within what you said.
- For a code-gated item (`paid-api-*`), the gate reads only an entry Jahmod adds by hand to `avo/approvals.json`.
- That file is a safety latch, not tamper-proof security (see Safety Audit §1).

```json
{ "approvals": [ { "id": "<id>", "approvedBy": "Jahmod", "date": "YYYY-MM-DD", "expires": "YYYY-MM-DD", "note": "..." } ] }
```

| id | Decision | Raised by | Notes |
|---|---|---|---|
| `fish-live-test` | Run the 15-minute Fish Audio listening test | A.V.O. stand-in runs + Claude | Must-pass checks: you heard the voice; fallback works with a broken key |
| `commit-phase2` | Commit today's offline changes | Claude | Command below |
| `unattended-schedule` | Allow Windows Task Scheduler to start A.V.O. | Claude, Halle | Free; laptop on and signed in |
| `paid-api-openai` / `paid-api-gemini` | Seat the real Halle / Gemini | Claude, Halle | BLOCKED until a budget limiter exists. Needs keys, model names and a cap |
| `gemini-evidence-access` | How Gemini gets read-only evidence (for example, you upload `avo/reports`) | Halle | Gemini is BLOCKED without it |
| `guest-display-fields` | Which roadmap fields guests may see | A.V.O. stand-ins | Only before a real guest meeting |

## Commit command (when you choose)

From PowerShell in `C:\Users\boogi\jarvis`:

```
git add bridge/net.mjs test/net.test.mjs test/avo.test.mjs test/fixtures avo .gitignore
git commit -m "A.V.O. phase 2: fail-closed network gate, CEO approval gate, emergency stop, safety tripwire, reports"
```

The sandbox also lists about 60 other files as modified. Those are line endings only (Windows vs Linux checkout) and should not appear on your PC.


## Update after phase 3

- `commit-phase2`: DONE (1c1daa9, pushed by Jahmod). Phase 3 committed as fa46477, **not pushed**: `git push fork dev/cto-007-jarvis`.
- `paid-api-openai` / `paid-api-gemini`: the budget limiter now exists (off). Still REQUIRES CEO: approval entries, `avo/budget.json` with caps and current prices (source + date), and billing caps in the OpenAI / Google consoles.
