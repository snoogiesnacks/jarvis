# A.V.O. phase 3 evidence packet for Gemini — built 2026-10-25T15:39:11Z

Commits: fa46477 (code) and 19963e3 (reports), branch dev/cto-007-jarvis. Review request: confirm or reject each phase 3 claim from this evidence; label findings 'VERIFIED BY EVIDENCE REVIEW (not independently executed)'.

=================== git show --stat fa46477 19963e3 ===================
fa46477 A.V.O. phase 3: stop cancels in-flight calls, BLOCKED ON CEO outcome, budget limiter (off by default)

 .gitignore                                  |   2 +
 avo/budget.mjs                              | 180 ++++++++++++++
 avo/office.mjs                              |  41 ++-
 avo/reports/evidence/10-npm-test-phase3.log | 370 ++++++++++++++++++++++++++++
 avo/run.mjs                                 |   7 +-
 avo/staff.mjs                               |  72 ++++--
 test/avo.test.mjs                           | 132 ++++++++++
 7 files changed, 782 insertions(+), 22 deletions(-)
19963e3 A.V.O. reports: phase 3 addendum (stop cancel, BLOCKED ON CEO, budget limiter)

 avo/reports/1-SAFETY-AUDIT.md        | 14 ++++++++++++++
 avo/reports/2-TEST-RESULTS.md        |  5 +++++
 avo/reports/3-AVO-READINESS.md       |  8 ++++++++
 avo/reports/4-CEO-DECISION-DIGEST.md |  6 ++++++
 4 files changed, 33 insertions(+)

=================== FILE: avo/budget.mjs (full) ===================
     1	// Budget limiter for paid A.V.O. seats (OpenAI, Gemini). OFF BY DEFAULT.
     2	//
     3	// Paid engines refuse to run unless avo/budget.json exists, is valid, is
     4	// enabled, and lists a price for the exact model. Every paid call then:
     5	//   1. RESERVES its worst-case cost before the request (estimated input +
     6	//      the full max output), and is refused if that reservation would push
     7	//      spending past any cap (per run, per day, per month);
     8	//   2. SETTLES to the actual cost from the provider's usage report;
     9	//   3. RELEASES the reservation if the call fails or is cancelled.
    10	// Everything is written to avo/budget-ledger.jsonl (append-only). If the ledger
    11	// cannot be read or written, paid calls are refused (fail closed).
    12	//
    13	// Prices are NOT hard-coded: the CEO enters them in budget.json with the source
    14	// URL and the date they were checked, because provider prices change.
    15	//
    16	//   {
    17	//     "enabled": true,
    18	//     "currency": "USD",
    19	//     "caps": { "perRun": 0.50, "perDay": 2.00, "perMonth": 20.00 },
    20	//     "prices": {
    21	//       "openai:<exact-model>": { "inputPerMTok": 0, "outputPerMTok": 0,
    22	//                                 "source": "https://...", "checked": "YYYY-MM-DD" },
    23	//       "gemini:<exact-model>": { ... }
    24	//     }
    25	//   }
    26	//
    27	// LIMITS: costs are computed from the provider's own usage numbers and the
    28	// prices in this file, so a wrong price means a wrong total. Provider-side
    29	// limits (a hard cap set in the OpenAI / Google billing console) are still
    30	// recommended as a second line of defence. This file is not tamper-proof.
    31	import { appendFileSync, existsSync, readFileSync } from 'node:fs'
    32	import { dirname, join } from 'node:path'
    33	import { fileURLToPath } from 'node:url'
    34	import { randomUUID } from 'node:crypto'
    35	
    36	const here = dirname(fileURLToPath(import.meta.url))
    37	export const BUDGET_FILE = join(here, 'budget.json')
    38	export const LEDGER_FILE = join(here, 'budget-ledger.jsonl')
    39	
    40	export class BudgetError extends Error {
    41	  constructor(msg) {
    42	    super(msg)
    43	    this.code = 'EBUDGET'
    44	  }
    45	}
    46	
    47	const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0
    48	const nonneg = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0
    49	const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    50	
    51	/** Load and validate budget.json. Returns { ok, budget } or { ok:false, why }. */
    52	export function loadBudget(file = BUDGET_FILE) {
    53	  if (!existsSync(file)) return { ok: false, why: 'no avo/budget.json (paid seats are off by default)' }
    54	  let b
    55	  try {
    56	    b = JSON.parse(readFileSync(file, 'utf8'))
    57	  } catch {
    58	    return { ok: false, why: 'avo/budget.json is not valid JSON' }
    59	  }
    60	  if (b?.enabled !== true) return { ok: false, why: 'budget.json has enabled != true' }
    61	  if (b.currency !== 'USD') return { ok: false, why: 'budget.json currency must be "USD"' }
    62	  const c = b.caps ?? {}
    63	  if (!pos(c.perRun) || !pos(c.perDay) || !pos(c.perMonth))
    64	    return { ok: false, why: 'caps.perRun, caps.perDay and caps.perMonth must all be positive numbers' }
    65	  if (!(c.perRun <= c.perDay && c.perDay <= c.perMonth))
    66	    return { ok: false, why: 'caps must satisfy perRun <= perDay <= perMonth' }
    67	  if (!b.prices || typeof b.prices !== 'object') return { ok: false, why: 'budget.json has no prices' }
    68	  for (const [k, p] of Object.entries(b.prices)) {
    69	    if (!/^(openai|gemini):\S+$/.test(k)) return { ok: false, why: `bad price key "${k}" (use openai:<model> or gemini:<model>)` }
    70	    if (!nonneg(p?.inputPerMTok) || !nonneg(p?.outputPerMTok) || !(p.inputPerMTok + p.outputPerMTok > 0))
    71	      return { ok: false, why: `price for ${k} needs inputPerMTok and outputPerMTok (USD per million tokens)` }
    72	    if (typeof p.source !== 'string' || !/^https:\/\//.test(p.source) || !isDay(p.checked))
    73	      return { ok: false, why: `price for ${k} needs a https source and a checked date` }
    74	  }
    75	  return { ok: true, budget: b }
    76	}
    77	
    78	/** Throw unless the budget allows this engine/model at all. */
    79	export function requireBudget(engine, model, file = BUDGET_FILE) {
    80	  const r = loadBudget(file)
    81	  if (!r.ok) throw new BudgetError(`budget limiter: ${r.why}`)
    82	  const price = r.budget.prices[`${engine}:${model}`]
    83	  if (!price) throw new BudgetError(`budget limiter: no price for ${engine}:${model} in budget.json`)
    84	  return { budget: r.budget, price }
    85	}
    86	
    87	const usd = (inTok, outTok, p) => (inTok * p.inputPerMTok + outTok * p.outputPerMTok) / 1e6
    88	
    89	/** Billable tokens from a provider usage report. Unknown shape → null. */
    90	export function tokensFromUsage(engine, usage) {
    91	  if (!usage) return null
    92	  if (engine === 'openai') {
    93	    // Reasoning tokens are included in output_tokens and billed as output.
    94	    if (!nonneg(usage.input_tokens) || !nonneg(usage.output_tokens)) return null
    95	    return { input: usage.input_tokens, output: usage.output_tokens }
    96	  }
    97	  if (engine === 'gemini') {
    98	    // Output = visible candidates + thinking ("thoughts") tokens.
    99	    const out = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)
   100	    if (!nonneg(usage.promptTokenCount) || !nonneg(out)) return null
   101	    return { input: usage.promptTokenCount, output: out }
   102	  }
   103	  return null
   104	}
   105	
   106	function readLedger(file) {
   107	  if (!existsSync(file)) return []
   108	  try {
   109	    return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
   110	  } catch {
   111	    throw new BudgetError('budget limiter: ledger unreadable — refusing paid calls until it is fixed')
   112	  }
   113	}
   114	
   115	/** Money committed (settled + still-open reservations) since `fromIso`, optionally for one run. */
   116	export function committed(entries, { fromIso = '', runId } = {}) {
   117	  const open = new Map()
   118	  let total = 0
   119	  for (const e of entries) {
   120	    if (e.at < fromIso || (runId && e.runId !== runId)) continue
   121	    if (e.kind === 'reserve') open.set(e.id, e.usd)
   122	    else if (e.kind === 'settle') {
   123	      open.delete(e.id)
   124	      total += e.usd
   125	    } else if (e.kind === 'release') open.delete(e.id)
   126	  }
   127	  for (const v of open.values()) total += v
   128	  return total
   129	}
   130	
   131	function windowStarts(now) {
   132	  const z = (n) => String(n).padStart(2, '0')
   133	  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
   134	  const month = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
   135	  return { day, month, label: `${now.getFullYear()}-${z(now.getMonth() + 1)}` }
   136	}
   137	
   138	/**
   139	 * Reserve worst-case cost for one call, or throw BudgetError.
   140	 * Input tokens are estimated generously from characters (1 token per 3 chars).
   141	 */
   142	export function reserve({ engine, model, runId, promptChars, maxOutputTokens, file = BUDGET_FILE, ledger = LEDGER_FILE, now = new Date() }) {
   143	  const { budget, price } = requireBudget(engine, model, file)
   144	  if (!pos(maxOutputTokens)) throw new BudgetError('budget limiter: maxOutputTokens must be set for paid calls')
   145	  const estimate = usd(Math.ceil(promptChars / 3), maxOutputTokens, price)
   146	  const entries = readLedger(ledger)
   147	  const w = windowStarts(now)
   148	  const checks = [
   149	    ['per run', committed(entries, { runId }), budget.caps.perRun],
   150	    ['per day', committed(entries, { fromIso: w.day }), budget.caps.perDay],
   151	    ['per month', committed(entries, { fromIso: w.month }), budget.caps.perMonth],
   152	  ]
   153	  for (const [name, spent, cap] of checks)
   154	    if (spent + estimate > cap)
   155	      throw new BudgetError(`budget limiter: ${name} cap $${cap.toFixed(2)} would be exceeded (committed $${spent.toFixed(4)} + this call up to $${estimate.toFixed(4)})`)
   156	  const id = randomUUID()
   157	  write(ledger, { at: now.toISOString(), kind: 'reserve', id, runId, engine, model, usd: estimate })
   158	  return { id, estimate, price, ledger, runId, engine, model }
   159	}
   160	
   161	/** Record actual cost. Missing usage → keep the full reservation as the cost. */
   162	export function settle(r, usage, now = new Date()) {
   163	  const t = tokensFromUsage(r.engine, usage)
   164	  const cost = t ? usd(t.input, t.output, r.price) : r.estimate
   165	  write(r.ledger, { at: now.toISOString(), kind: 'settle', id: r.id, runId: r.runId, engine: r.engine, model: r.model, usd: cost, tokens: t, usageKnown: Boolean(t) })
   166	  return cost
   167	}
   168	
   169	/** Cancel a reservation for a call that never produced a billable result. */
   170	export function release(r, why, now = new Date()) {
   171	  write(r.ledger, { at: now.toISOString(), kind: 'release', id: r.id, runId: r.runId, engine: r.engine, model: r.model, usd: 0, why: String(why).slice(0, 200) })
   172	}
   173	
   174	function write(ledger, entry) {
   175	  try {
   176	    appendFileSync(ledger, JSON.stringify(entry) + '\n')
   177	  } catch {
   178	    throw new BudgetError('budget limiter: cannot write ledger — refusing paid calls')
   179	  }
   180	}

=================== DIFF fa46477 (code + tests) ===================
diff --git a/.gitignore b/.gitignore
index c59c883..6cdd9c7 100644
--- a/.gitignore
+++ b/.gitignore
@@ -32,3 +32,5 @@ avo/STOP
 avo/STOP.txt
 avo/approvals.json
 avo/audit.log
+avo/budget.json
+avo/budget-ledger.jsonl
diff --git a/avo/office.mjs b/avo/office.mjs
index beb2d86..9e22a84 100644
--- a/avo/office.mjs
+++ b/avo/office.mjs
@@ -4,6 +4,7 @@ import { NAMES } from './staff.mjs'
 
 const NEXT_RE = /NEXT:\s*\**\s*(Halle|Claude|Gemini)\b/i
 const RESOLVED_RE = /\[RESOLVED\]/i
+const BLOCKED_RE = /\[BLOCKED ON CEO\]/i
 const CEO_RE = /^\s*[-*]?\s*\**CEO DECISION:?\**:?\s*(.+)$/gim
 
 /** Replace any secret-looking environment value that appears in text. */
@@ -27,23 +28,51 @@ function render(scenario, transcript, speaker) {
   return lines.join('\n')
 }
 
-export async function runScenario({ scenario, seats, maxTurns = 8, onTurn = () => {}, env, shouldStop = () => null }) {
+export async function runScenario({ scenario, seats, maxTurns = 8, onTurn = () => {}, env, shouldStop = () => null, stopPollMs = 500 }) {
   const redact = redactor(env)
   const transcript = []
   let speaker = scenario.opener
   let resolved = false
+  let blocked = false
   let error = null
   let stopped = null
   for (let turn = 1; turn <= maxTurns; turn++) {
     stopped = shouldStop()
     if (stopped) break
     const seat = seats[speaker]
+    // While a seat is thinking, keep watching for the emergency stop. On stop,
+    // the call is cancelled (engines honour the signal) and the run moves on
+    // without waiting for it, even if an engine ignores the signal.
+    const controller = new AbortController()
+    let onStop
+    const stopWatch = new Promise((resolve) => (onStop = resolve))
+    const poll = setInterval(() => {
+      const why = shouldStop()
+      if (why) {
+        controller.abort(new Error(`emergency stop: ${why}`))
+        onStop({ stopped: why })
+      }
+    }, stopPollMs)
     let text
     try {
-      text = redact(String(await seat.reply(render(scenario, transcript, speaker), { turn })))
+      const outcome = await Promise.race([
+        Promise.resolve(seat.reply(render(scenario, transcript, speaker), { turn, signal: controller.signal })).then((t) => ({ text: t })),
+        stopWatch,
+      ])
+      if (outcome.stopped) {
+        stopped = `${outcome.stopped} (cancelled ${speaker}'s turn ${turn} mid-call)`
+        break
+      }
+      text = redact(String(outcome.text))
     } catch (err) {
+      if (controller.signal.aborted) {
+        stopped = `${shouldStop() ?? 'emergency stop'} (cancelled ${speaker}'s turn ${turn} mid-call)`
+        break
+      }
       error = `${speaker}: ${redact(String(err?.message ?? err))}`
       break
+    } finally {
+      clearInterval(poll)
     }
     const entry = { turn, speaker, label: seat.label, real: seat.real, text }
     transcript.push(entry)
@@ -52,6 +81,10 @@ export async function runScenario({ scenario, seats, maxTurns = 8, onTurn = () =
       resolved = true
       break
     }
+    if (BLOCKED_RE.test(text)) {
+      blocked = true
+      break
+    }
     const asked = text.match(NEXT_RE)?.[1]
     const proper = asked && NAMES.find((n) => n.toLowerCase() === asked.toLowerCase())
     speaker = proper && proper !== speaker ? proper : NAMES[(NAMES.indexOf(speaker) + 1) % NAMES.length]
@@ -63,7 +96,7 @@ export async function runScenario({ scenario, seats, maxTurns = 8, onTurn = () =
   const ceoDecisions = [
     ...new Set(transcript.flatMap((t) => [...t.text.matchAll(CEO_RE)].map((m) => `${m[1].trim()} (${t.speaker})`))),
   ]
-  return { scenario: scenario.id, title: scenario.title, transcript, resolved, error, stopped, ceoDecisions, overreach, findings }
+  return { scenario: scenario.id, title: scenario.title, transcript, resolved, blocked, error, stopped, ceoDecisions, overreach, findings }
 }
 
 export function toMarkdown(result, seats, when = new Date()) {
@@ -71,7 +104,7 @@ export function toMarkdown(result, seats, when = new Date()) {
   return [
     `# A.V.O. simulation — ${result.title}`,
     '',
-    `Run: ${when.toISOString()} · Outcome: ${result.stopped ? 'EMERGENCY STOP' : result.resolved ? 'RESOLVED' : result.error ? 'STOPPED ON ERROR' : 'TURN LIMIT REACHED'}`,
+    `Run: ${when.toISOString()} · Outcome: ${result.stopped ? 'EMERGENCY STOP' : result.resolved ? 'RESOLVED' : result.blocked ? 'BLOCKED ON CEO' : result.error ? 'STOPPED ON ERROR' : 'TURN LIMIT REACHED'}`,
     '',
     '**This is a simulation.** Stand-ins are Claude playing a role; they are not Halle or Gemini and nothing they say is that agent\'s view or approval. No actions were taken outside this conversation.',
     '',
diff --git a/avo/run.mjs b/avo/run.mjs
index d78fd9c..d21bf54 100644
--- a/avo/run.mjs
+++ b/avo/run.mjs
@@ -52,6 +52,9 @@ if (stopNow) {
   process.exit(4)
 }
 
+// One id per invocation, used by the budget limiter's per-run cap.
+process.env.AVO_RUN_ID ??= new Date().toISOString()
+
 let seats
 try {
   seats = mock ? mockSeats() : seatsFromEnv()
@@ -85,7 +88,7 @@ for (const scenario of scenarios) {
   const md = join(runsDir, `${stamp}-${scenario.id}.md`)
   writeFileSync(md, toMarkdown(result, seats))
   console.log(
-    `\n[avo] ${result.stopped ? `EMERGENCY STOP (${result.stopped})` : result.resolved ? 'resolved' : result.error ? `stopped: ${result.error}` : 'turn limit'} · ` +
+    `\n[avo] ${result.stopped ? `EMERGENCY STOP (${result.stopped})` : result.resolved ? 'resolved' : result.blocked ? 'BLOCKED ON CEO' : result.error ? `stopped: ${result.error}` : 'turn limit'} · ` +
       `${result.transcript.length} turns · ${result.ceoDecisions.length} CEO decisions · ` +
       `${result.overreach.length ? `⚠ ${result.overreach.length} SAFETY FLAGS · ` : ''}${md}`,
   )
@@ -96,7 +99,7 @@ for (const scenario of scenarios) {
       at: new Date().toISOString(),
       scenario: scenario.id,
       cast: Object.fromEntries(NAMES.map((n) => [n, seats[n].engine])),
-      outcome: result.stopped ? 'emergency-stop' : result.resolved ? 'resolved' : result.error ? 'error' : 'turn-limit',
+      outcome: result.stopped ? 'emergency-stop' : result.resolved ? 'resolved' : result.blocked ? 'blocked-on-ceo' : result.error ? 'error' : 'turn-limit',
       turns: result.transcript.length,
       ceoDecisionsPending: result.ceoDecisions.length,
       safetyFlags: result.findings.filter(isFlag).map(({ turn, speaker, kind, phrase }) => ({ turn, speaker, kind, phrase })),
diff --git a/avo/staff.mjs b/avo/staff.mjs
index 4c8ec4d..e0a7a6b 100644
--- a/avo/staff.mjs
+++ b/avo/staff.mjs
@@ -1,3 +1,10 @@
+import { reserve, settle } from './budget.mjs'
+
+/** Test hook: alternate budget/ledger files. Still has to be a valid budget. */
+const budgetPaths = (env) => ({
+  ...(env.AVO_BUDGET_FILE ? { file: env.AVO_BUDGET_FILE } : {}),
+  ...(env.AVO_LEDGER_FILE ? { ledger: env.AVO_LEDGER_FILE } : {}),
+})
 import { requireApproval } from './control.mjs'
 import { mkdirSync } from 'node:fs'
 import { tmpdir } from 'node:os'
@@ -50,7 +57,7 @@ export function systemPrompt(name, { standIn = false } = {}) {
     '- Speak about future work as proposals ("I propose", "once approved I would"), never as work you are starting now.',
     '- Never write credentials, keys or personal data.',
     '- Keep each turn under 120 words. Build on what others said; disagree when you should.',
-    `- End every turn with exactly one line: "NEXT: <${NAMES.join('|')}>" naming who should speak next, or "[RESOLVED]" once the team has an agreed plan with owners.`,
+    `- End every turn with exactly one line: "NEXT: <${NAMES.join('|')}>" naming who should speak next; or "[RESOLVED]" once the team has an agreed plan with owners; or "[BLOCKED ON CEO]" when the plan is otherwise agreed and the only thing left is a pending CEO decision. Do not keep talking just to wait.`,
   ]
     .filter(Boolean)
     .join('\n')
@@ -63,15 +70,24 @@ export function seatEnv(env = process.env) {
   return Object.fromEntries(Object.entries(env).filter(([k]) => !STRIP.test(k)))
 }
 
-async function claudeEngine({ system, prompt, model }) {
+/** Longest a single Claude seat turn may take before it is cut off. */
+const CLAUDE_TURN_TIMEOUT_MS = 120000
+
+async function claudeEngine({ system, prompt, model, signal }) {
   const { query } = await import('@anthropic-ai/claude-agent-sdk')
   // Run from an empty folder so memory saved for the JARVIS project folder
   // doesn't leak into the simulation as unverified "facts".
   const cwd = join(tmpdir(), 'jarvis-avo-seat')
   mkdirSync(cwd, { recursive: true })
+  // Cancelled by the emergency stop (signal) or by the per-turn timeout.
+  const abortController = new AbortController()
+  const cut = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(CLAUDE_TURN_TIMEOUT_MS)])
+  if (cut.aborted) throw new Error('claude: cancelled before start')
+  cut.addEventListener('abort', () => abortController.abort(cut.reason), { once: true })
   const q = query({
     prompt,
     options: {
+      abortController,
       systemPrompt: system,
       tools: [], // talk only: no built-in tools
       mcpServers: {}, // and no MCP servers
@@ -106,16 +122,28 @@ function requirePaid(env, keyVar, modelVar, who, approvals) {
   return { key: env[keyVar], model: env[modelVar] }
 }
 
-async function openaiEngine({ system, prompt, env, approvals }) {
+async function openaiEngine({ system, prompt, env, approvals, signal }) {
   const { key, model } = requirePaid(env, 'OPENAI_API_KEY', 'AVO_HALLE_MODEL', 'Halle', approvals)
-  const r = await fetch('https://api.openai.com/v1/responses', {
+  const MAX_OUT = 400
+  const budget = reserve({ engine: 'openai', model, runId: env.AVO_RUN_ID ?? 'unknown', promptChars: system.length + prompt.length, maxOutputTokens: MAX_OUT, ...budgetPaths(env) })
+  let r
+  try {
+    r = await fetch('https://api.openai.com/v1/responses', {
     method: 'POST',
     headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
-    body: JSON.stringify({ model, instructions: system, input: prompt, max_output_tokens: 400 }),
-    signal: AbortSignal.timeout(60000),
+    body: JSON.stringify({ model, instructions: system, input: prompt, max_output_tokens: MAX_OUT }),
+    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(60000)]),
   })
-  if (!r.ok) throw new Error(`Halle: OpenAI HTTP ${r.status}`)
+  } catch (err) {
+    settle(budget, null) // request may have been billed: keep the full reservation
+    throw err
+  }
+  if (!r.ok) {
+    settle(budget, null)
+    throw new Error(`Halle: OpenAI HTTP ${r.status}`)
+  }
   const j = await r.json()
+  settle(budget, j.usage)
   return (j.output ?? [])
     .flatMap((o) => o.content ?? [])
     .filter((c) => c.type === 'output_text')
@@ -124,9 +152,13 @@ async function openaiEngine({ system, prompt, env, approvals }) {
     .trim()
 }
 
-async function geminiEngine({ system, prompt, env, approvals }) {
+async function geminiEngine({ system, prompt, env, approvals, signal }) {
   const { key, model } = requirePaid(env, 'GEMINI_API_KEY', 'AVO_GEMINI_MODEL', 'Gemini', approvals)
-  const r = await fetch(
+  const MAX_OUT = 400
+  const budget = reserve({ engine: 'gemini', model, runId: env.AVO_RUN_ID ?? 'unknown', promptChars: system.length + prompt.length, maxOutputTokens: MAX_OUT, ...budgetPaths(env) })
+  let r
+  try {
+    r = await fetch(
     `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
     {
       method: 'POST',
@@ -134,13 +166,21 @@ async function geminiEngine({ system, prompt, env, approvals }) {
       body: JSON.stringify({
         systemInstruction: { parts: [{ text: system }] },
         contents: [{ role: 'user', parts: [{ text: prompt }] }],
-        generationConfig: { maxOutputTokens: 400 },
+        generationConfig: { maxOutputTokens: MAX_OUT },
       }),
-      signal: AbortSignal.timeout(60000),
+      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(60000)]),
     },
   )
-  if (!r.ok) throw new Error(`Gemini: HTTP ${r.status}`)
+  } catch (err) {
+    settle(budget, null)
+    throw err
+  }
+  if (!r.ok) {
+    settle(budget, null)
+    throw new Error(`Gemini: HTTP ${r.status}`)
+  }
   const j = await r.json()
+  settle(budget, j.usageMetadata)
   return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
 }
 
@@ -156,10 +196,10 @@ export function makeSeat(name, engine, env = process.env, approvals) {
   const system = systemPrompt(name, { standIn })
   const model = env.AVO_CLAUDE_MODEL || undefined
   const reply = {
-    claude: (prompt) => claudeEngine({ system, prompt, model }),
-    standin: (prompt) => claudeEngine({ system, prompt, model }),
-    openai: (prompt) => openaiEngine({ system, prompt, env, approvals }),
-    gemini: (prompt) => geminiEngine({ system, prompt, env, approvals }),
+    claude: (prompt, { signal } = {}) => claudeEngine({ system, prompt, model, signal }),
+    standin: (prompt, { signal } = {}) => claudeEngine({ system, prompt, model, signal }),
+    openai: (prompt, { signal } = {}) => openaiEngine({ system, prompt, env, approvals, signal }),
+    gemini: (prompt, { signal } = {}) => geminiEngine({ system, prompt, env, approvals, signal }),
   }[engine]
   if (!reply && engine !== 'mock') throw new Error(`unknown engine "${engine}" for ${name}`)
   return { name, engine, label, real: !standIn && engine !== 'mock', reply }
diff --git a/test/avo.test.mjs b/test/avo.test.mjs
index d0d1ae9..69e048d 100644
--- a/test/avo.test.mjs
+++ b/test/avo.test.mjs
@@ -6,6 +6,7 @@ import { mockSeats } from '../avo/mock.mjs'
 import { SCENARIOS } from '../avo/scenarios.mjs'
 import { stopRequested, loadApprovals, isApproved, requireApproval } from '../avo/control.mjs'
 import { seatEnv } from '../avo/staff.mjs'
+import { loadBudget, reserve, settle, release, committed, tokensFromUsage } from '../avo/budget.mjs'
 import { spawnSync } from 'node:child_process'
 import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
 import { classify, scan, isFlag } from '../avo/safety.mjs'
@@ -254,3 +255,134 @@ test('runner refuses to start under emergency stop and exits 4', () => {
   assert.equal(r.status, 4)
   assert.match(r.stderr, /EMERGENCY STOP/)
 })
+
+test('emergency stop cancels a turn that is still running, and the run does not wait for it', async () => {
+  const seats = mockSeats({ resolveAt: 99 })
+  let sawAbort = false
+  seats[sc.opener].reply = (prompt, { signal }) =>
+    new Promise((resolve, reject) => {
+      const t = setTimeout(() => resolve('finished anyway\nNEXT: Claude'), 10000)
+      signal.addEventListener('abort', () => { sawAbort = true; clearTimeout(t); reject(signal.reason) })
+    })
+  let stopAfter = Date.now() + 150
+  const started = Date.now()
+  const r = await runScenario({ scenario: sc, seats, stopPollMs: 20, shouldStop: () => (Date.now() > stopAfter ? 'STOP file' : null) })
+  assert.ok(Date.now() - started < 2000, 'run ended promptly')
+  assert.equal(sawAbort, true, 'the in-flight call received the abort signal')
+  assert.match(r.stopped, /STOP file .*mid-call/)
+  assert.equal(r.transcript.length, 0)
+})
+
+test('emergency stop still ends the run when an engine ignores the abort signal', async () => {
+  const seats = mockSeats({ resolveAt: 99 })
+  seats[sc.opener].reply = () => new Promise(() => {}) // never settles, ignores signal
+  let stopAfter = Date.now() + 100
+  const r = await runScenario({ scenario: sc, seats, stopPollMs: 20, shouldStop: () => (Date.now() > stopAfter ? 'AVO_STOP' : null) })
+  assert.match(r.stopped, /AVO_STOP .*mid-call/)
+})
+
+test('paid engines pass the abort signal to the network call (fetch stubbed, no network)', async () => {
+  const realFetch = globalThis.fetch
+  let calledUrl
+  globalThis.fetch = (url, opts) =>
+    new Promise((_, reject) => {
+      calledUrl = url
+      opts.signal.addEventListener('abort', () => reject(opts.signal.reason))
+    })
+  try {
+    const { budgetFile, ledgerFile } = tempBudget()
+    const env = { AVO_ALLOW_PAID: '1', OPENAI_API_KEY: 'k'.repeat(20), AVO_HALLE_MODEL: 'test-model', AVO_BUDGET_FILE: budgetFile, AVO_LEDGER_FILE: ledgerFile, AVO_RUN_ID: 'r1' }
+    const approved = [{ id: 'paid-api-openai', approvedBy: 'Jahmod', date: '2000-01-01', expires: '2999-12-31' }]
+    const halle = makeSeat('Halle', 'openai', env, approved)
+    const ac = new AbortController()
+    const p = halle.reply('hi', { signal: ac.signal })
+    ac.abort(new Error('stop'))
+    await assert.rejects(p, /stop/)
+    assert.match(calledUrl, /openai/)
+    // A cancelled call keeps its full reservation as spent (conservative).
+    const kinds = readFileSync(ledgerFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l).kind)
+    assert.deepEqual(kinds, ['reserve', 'settle'])
+  } finally {
+    globalThis.fetch = realFetch
+  }
+})
+
+test('a run can end BLOCKED ON CEO instead of burning turns', async () => {
+  const seats = mockSeats({ resolveAt: 99 })
+  seats.Claude.reply = async () => 'Plan agreed except the field list.\nCEO DECISION: confirm guest fields\n[BLOCKED ON CEO]'
+  const r = await runScenario({ scenario: { ...sc, opener: 'Claude' }, seats })
+  assert.equal(r.blocked, true)
+  assert.equal(r.resolved, false)
+  assert.equal(r.transcript.length, 1)
+  assert.match(toMarkdown(r, seats), /Outcome: BLOCKED ON CEO/)
+})
+
+test('agents are told they may end BLOCKED ON CEO', () => {
+  assert.match(systemPrompt('Gemini'), /\[BLOCKED ON CEO\]/)
+})
+
+function tempBudget(caps = { perRun: 0.01, perDay: 0.02, perMonth: 0.05 }) {
+  const dir = mkdtempSync(join(tmpdir(), 'avo-budget-'))
+  const budgetFile = join(dir, 'budget.json')
+  const ledgerFile = join(dir, 'ledger.jsonl')
+  writeFileSync(budgetFile, JSON.stringify({
+    enabled: true, currency: 'USD', caps,
+    prices: {
+      'openai:test-model': { inputPerMTok: 1, outputPerMTok: 4, source: 'https://example.com/pricing', checked: '2026-10-25' },
+      'gemini:test-model': { inputPerMTok: 1, outputPerMTok: 4, source: 'https://example.com/pricing', checked: '2026-10-25' },
+    },
+  }))
+  return { budgetFile, ledgerFile }
+}
+
+test('budget: paid seats are off unless a valid, enabled budget.json exists', () => {
+  const dir = mkdtempSync(join(tmpdir(), 'avo-b-'))
+  const f = join(dir, 'budget.json')
+  assert.match(loadBudget(f).why, /off by default/)
+  const bad = [
+    [{ enabled: false }, /enabled/],
+    [{ enabled: true, currency: 'EUR' }, /currency/],
+    [{ enabled: true, currency: 'USD', caps: { perRun: 1, perDay: 0, perMonth: 5 } }, /positive/],
+    [{ enabled: true, currency: 'USD', caps: { perRun: 5, perDay: 1, perMonth: 9 } }, /perRun <= perDay/],
+    [{ enabled: true, currency: 'USD', caps: { perRun: 1, perDay: 2, perMonth: 3 }, prices: { 'openai:m': { inputPerMTok: 1, outputPerMTok: 1 } } }, /source/],
+    [{ enabled: true, currency: 'USD', caps: { perRun: 1, perDay: 2, perMonth: 3 }, prices: { 'x:m': {} } }, /bad price key/],
+  ]
+  for (const [cfg, why] of bad) {
+    writeFileSync(f, JSON.stringify(cfg))
+    assert.match(loadBudget(f).why, why)
+  }
+})
+
+test('budget: a call is refused before it is made when its worst case would pass a cap', () => {
+  const { budgetFile, ledgerFile } = tempBudget({ perRun: 0.0021, perDay: 0.003, perMonth: 0.01 })
+  const args = { engine: 'openai', model: 'test-model', runId: 'r1', promptChars: 300, maxOutputTokens: 400, file: budgetFile, ledger: ledgerFile }
+  // worst case: 100 in * $1/M + 400 out * $4/M = $0.0017
+  const r1 = reserve(args)
+  assert.ok(Math.abs(r1.estimate - 0.0017) < 1e-9)
+  assert.throws(() => reserve(args), /per run cap/) // 0.0017 + 0.0017 > 0.002
+  settle(r1, { input_tokens: 100, output_tokens: 50 }) // actual $0.0003
+  const r2 = reserve(args) // run now at 0.0003 + 0.0017 = 0.0020: allowed
+  release(r2, 'test')
+  assert.throws(() => reserve({ ...args, runId: 'r2', maxOutputTokens: 1000 }), /cap .* would be exceeded/) // 0.0003 + 0.0041 > 0.003
+})
+
+test('budget: unknown model, missing max output, or unreadable ledger fail closed', () => {
+  const { budgetFile, ledgerFile } = tempBudget()
+  const base = { engine: 'openai', model: 'test-model', runId: 'r', promptChars: 10, maxOutputTokens: 10, file: budgetFile, ledger: ledgerFile }
+  assert.throws(() => reserve({ ...base, model: 'other' }), /no price for openai:other/)
+  assert.throws(() => reserve({ ...base, maxOutputTokens: 0 }), /maxOutputTokens/)
+  writeFileSync(ledgerFile, '{ broken')
+  assert.throws(() => reserve(base), /ledger unreadable/)
+})
+
+test('budget: provider usage maps to billable tokens (reasoning/thinking counted as output)', () => {
+  assert.deepEqual(tokensFromUsage('openai', { input_tokens: 75, output_tokens: 1186, output_tokens_details: { reasoning_tokens: 1024 } }), { input: 75, output: 1186 })
+  assert.deepEqual(tokensFromUsage('gemini', { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 30 }), { input: 10, output: 50 })
+  assert.equal(tokensFromUsage('openai', {}), null)
+  // Missing usage: settle keeps the full reservation as the cost.
+  const { budgetFile, ledgerFile } = tempBudget()
+  const r = reserve({ engine: 'gemini', model: 'test-model', runId: 'r', promptChars: 30, maxOutputTokens: 100, file: budgetFile, ledger: ledgerFile })
+  assert.equal(settle(r, undefined), r.estimate)
+  const entries = readFileSync(ledgerFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
+  assert.ok(Math.abs(committed(entries) - r.estimate) < 1e-12)
+})

=================== Report addenda (19963e3) ===================
diff --git a/avo/reports/1-SAFETY-AUDIT.md b/avo/reports/1-SAFETY-AUDIT.md
index 94d2495..f5b923f 100644
--- a/avo/reports/1-SAFETY-AUDIT.md
+++ b/avo/reports/1-SAFETY-AUDIT.md
@@ -61,3 +61,17 @@ is not Windows; nothing here was run on Windows by Claude.
 | `audit.log` uses one append per scenario from a single process; parallel runs (not supported today) could interleave lines | OPEN (raised by Gemini). If parallel runs are added: per-run files or a lock |
 | Approval dates are read in the laptop's **local** date, and include the whole `expires` day. A different machine or time zone could open or close the window up to a day early or late | OPEN (raised by Gemini). Documented in `avo/control.mjs`; set `expires` with a day's margin |
 | Safety detector is English-only and phrase-bound (slang, other languages, "I am executing this now") | KNOWN LIMIT (raised by Gemini; same as above) |
+
+
+## Phase 3 addendum (commit fa46477, 2026-10-25 ~15:35 UTC) — UNREVIEWED by Halle/Gemini
+
+| Change | Status | Code | Test / evidence |
+|---|---|---|---|
+| Emergency stop cancels an in-flight model call; the run does not wait even if an engine ignores the cancel | VERIFIED with stub engines | `avo/office.mjs` (stop watch per turn) | `test/avo.test.mjs` "cancels a turn that is still running", "ignores the abort signal"; `evidence/10-npm-test-phase3.log` |
+| Claude seat cancel uses the SDK `abortController`; turns time out after 120 s | Code only — **UNVERIFIED** with a live seat | `avo/staff.mjs` `claudeEngine` | — |
+| Paid engines pass the cancel to the network call | VERIFIED (fetch stubbed, no network) | `avo/staff.mjs` | "paid engines pass the abort signal" |
+| Runs can end `[BLOCKED ON CEO]` | VERIFIED | `avo/office.mjs`, `avo/staff.mjs` prompt | "a run can end BLOCKED ON CEO" |
+| Budget limiter, **off by default**: paid seats refused unless `avo/budget.json` is valid, enabled, has per-run ≤ per-day ≤ per-month caps and a price (with https source + checked date) for the exact model; worst-case cost reserved before each call; actual cost settled from provider usage (OpenAI `input_tokens`/`output_tokens`; Gemini `promptTokenCount` + `candidatesTokenCount` + `thoughtsTokenCount`); failed or cancelled calls keep the full reservation; append-only `avo/budget-ledger.jsonl`; unreadable ledger fails closed | VERIFIED (unit tests) | `avo/budget.mjs` | 4 "budget:" tests; `evidence/10` |
+| **Limits:** prices are only as right as the CEO's entries; Gemini `maxOutputTokens` vs thinking tokens not confirmed, so one call could overshoot a cap; not tamper-proof; provider-side billing caps still recommended | KNOWN LIMIT | — | — |
+
+Tests after phase 3: **59 total / 59 pass / 0 fail / 0 TODO**, exit 0 (`evidence/10-npm-test-phase3.log`). Previous: 50/50 (`evidence/02`).
diff --git a/avo/reports/2-TEST-RESULTS.md b/avo/reports/2-TEST-RESULTS.md
index eea04a7..f3c7fc7 100644
--- a/avo/reports/2-TEST-RESULTS.md
+++ b/avo/reports/2-TEST-RESULTS.md
@@ -65,3 +65,8 @@ Correction to rev. 1 of this report: it said "+7 A.V.O. tests" while listing 8,
 - **UNVERIFIED:** anything on Windows itself.
 - **UNVERIFIED:** the frontend build and the Fish Audio voice (Jahmod's listening test is pending).
 - **BLOCKED:** live A.V.O. model calls (none in this phase) and any paid API call (disabled).
+
+
+## Phase 3 update
+
+Fresh run after commit fa46477: `npm test`, exit 0, **59 total / 59 pass / 0 fail / 0 TODO / 0 skipped** (`evidence/10-npm-test-phase3.log`). +9 A.V.O. tests: stop cancels a running turn (2), paid engine passes cancel to fetch (1), BLOCKED ON CEO (2), budget limiter (4). 50 + 9 = 59.
diff --git a/avo/reports/3-AVO-READINESS.md b/avo/reports/3-AVO-READINESS.md
index 837bbcf..d3702a2 100644
--- a/avo/reports/3-AVO-READINESS.md
+++ b/avo/reports/3-AVO-READINESS.md
@@ -30,3 +30,11 @@
 3. End runs with `[BLOCKED ON CEO]` instead of burning turns on a pending decision.
 4. Daily decision digest generated from `audit.log`.
 5. A way to give Gemini read-only evidence, for example these report files pasted or uploaded by Jahmod.
+
+
+## Phase 3 update (fa46477)
+
+- Blocker #5 (budget limiter): BUILT, off by default, unit-tested. Paid seats still REQUIRE CEO: an `approvals.json` entry per engine **and** a valid `budget.json` with real prices, plus provider-side billing caps.
+- Emergency stop now cancels in-flight calls (live Claude seat: UNVERIFIED).
+- `[BLOCKED ON CEO]` outcome added.
+- Open: Halle/Gemini review of phase 3; live-seat cancel check.
diff --git a/avo/reports/4-CEO-DECISION-DIGEST.md b/avo/reports/4-CEO-DECISION-DIGEST.md
index 416e85d..0e8e66b 100644
--- a/avo/reports/4-CEO-DECISION-DIGEST.md
+++ b/avo/reports/4-CEO-DECISION-DIGEST.md
@@ -30,3 +30,9 @@ git commit -m "A.V.O. phase 2: fail-closed network gate, CEO approval gate, emer
 ```
 
 The sandbox also lists about 60 other files as modified. Those are line endings only (Windows vs Linux checkout) and should not appear on your PC.
+
+
+## Update after phase 3
+
+- `commit-phase2`: DONE (1c1daa9, pushed by Jahmod). Phase 3 committed as fa46477, **not pushed**: `git push fork dev/cto-007-jarvis`.
+- `paid-api-openai` / `paid-api-gemini`: the budget limiter now exists (off). Still REQUIRES CEO: approval entries, `avo/budget.json` with caps and current prices (source + date), and billing caps in the OpenAI / Google consoles.

=================== FILE: avo/reports/evidence/10-npm-test-phase3.log ===================
# command: npm test   started: 2026-10-25T15:35:20Z
# exit code: 0

> jarvis@0.0.0 test
> node --test

TAP version 13
# Subtest: conversation runs on its own until resolved
ok 1 - conversation runs on its own until resolved
  ---
  duration_ms: 6.971028
  type: 'test'
  ...
# Subtest: turn limit stops a conversation that never resolves
ok 2 - turn limit stops a conversation that never resolves
  ---
  duration_ms: 1.520871
  type: 'test'
  ...
# Subtest: speakers follow NEXT: hand-offs and never answer themselves
ok 3 - speakers follow NEXT: hand-offs and never answer themselves
  ---
  duration_ms: 1.361142
  type: 'test'
  ...
# Subtest: an engine failure stops the run and is reported, not hidden
ok 4 - an engine failure stops the run and is reported, not hidden
  ---
  duration_ms: 0.93395
  type: 'test'
  ...
# Subtest: CEO decisions are collected once each
ok 5 - CEO decisions are collected once each
  ---
  duration_ms: 1.818672
  type: 'test'
  ...
# Subtest: secrets are redacted from replies and errors
ok 6 - secrets are redacted from replies and errors
  ---
  duration_ms: 0.550022
  type: 'test'
  ...
# Subtest: stand-ins are labelled and told they are not the real agent
ok 7 - stand-ins are labelled and told they are not the real agent
  ---
  duration_ms: 0.26175
  type: 'test'
  ...
# Subtest: default cast: real Claude, stand-ins for Halle and Gemini
ok 8 - default cast: real Claude, stand-ins for Halle and Gemini
  ---
  duration_ms: 0.152396
  type: 'test'
  ...
# Subtest: paid engines refuse to run without explicit approval, key and model
ok 9 - paid engines refuse to run without explicit approval, key and model
  ---
  duration_ms: 1.3655
  type: 'test'
  ...
# Subtest: transcript says it is a simulation and lists the cast
ok 10 - transcript says it is a simulation and lists the cast
  ---
  duration_ms: 1.021986
  type: 'test'
  ...
# Subtest: agents are told they can only talk
ok 11 - agents are told they can only talk
  ---
  duration_ms: 0.2081
  type: 'test'
  ...
# Subtest: agents are told silence from the CEO never triggers an action
ok 12 - agents are told silence from the CEO never triggers an action
  ---
  duration_ms: 0.126186
  type: 'test'
  ...
# Subtest: acting on assumed approval is flagged in the result and transcript
ok 13 - acting on assumed approval is flagged in the result and transcript
  ---
  duration_ms: 1.315486
  type: 'test'
  ...
# Subtest: emergency stop halts a run before the next turn
ok 14 - emergency stop halts a run before the next turn
  ---
  duration_ms: 0.373801
  type: 'test'
  ...
# Subtest: emergency stop: STOP file or AVO_STOP=1 is detected; absence is not
ok 15 - emergency stop: STOP file or AVO_STOP=1 is detected; absence is not
  ---
  duration_ms: 0.90664
  type: 'test'
  ...
# Subtest: approvals come only from a well-formed, dated, unexpired CEO entry
ok 16 - approvals come only from a well-formed, dated, unexpired CEO entry
  ---
  duration_ms: 2.168996
  type: 'test'
  ...
# Subtest: paid engines refuse even with AVO_ALLOW_PAID=1, key and model, unless the CEO file approves
ok 17 - paid engines refuse even with AVO_ALLOW_PAID=1, key and model, unless the CEO file approves
  ---
  duration_ms: 0.317385
  type: 'test'
  ...
# Subtest: agent text claiming approval is never treated as approval
ok 18 - agent text claiming approval is never treated as approval
  ---
  duration_ms: 0.436758
  type: 'test'
  ...
# Subtest: safety detector: affirmative and questions flag; negated, quoted and safe do not
ok 19 - safety detector: affirmative and questions flag; negated, quoted and safe do not
  ---
  duration_ms: 2.702236
  type: 'test'
  ...
# Subtest: known limit: plain statements of action with no approval wording are not detected
ok 20 - known limit: plain statements of action with no approval wording are not detected
  ---
  duration_ms: 0.215224
  type: 'test'
  ...
# Subtest: regression: the 10:37 run (old rules) is flagged for acting on assumed approval
ok 21 - regression: the 10:37 run (old rules) is flagged for acting on assumed approval
  ---
  duration_ms: 7.978595
  type: 'test'
  ...
# Subtest: regression: the 10:41 run (new rules) raises no false safety flag
ok 22 - regression: the 10:41 run (new rules) raises no false safety flag
  ---
  duration_ms: 6.087923
  type: 'test'
  ...
# Subtest: Claude seats run without any API keys in their environment
ok 23 - Claude seats run without any API keys in their environment
  ---
  duration_ms: 0.377518
  type: 'test'
  ...
# Subtest: runner refuses to start under emergency stop and exits 4
ok 24 - runner refuses to start under emergency stop and exits 4
  ---
  duration_ms: 77.747565
  type: 'test'
  ...
# Subtest: emergency stop cancels a turn that is still running, and the run does not wait for it
ok 25 - emergency stop cancels a turn that is still running, and the run does not wait for it
  ---
  duration_ms: 164.166275
  type: 'test'
  ...
# Subtest: emergency stop still ends the run when an engine ignores the abort signal
ok 26 - emergency stop still ends the run when an engine ignores the abort signal
  ---
  duration_ms: 121.346981
  type: 'test'
  ...
# Subtest: paid engines pass the abort signal to the network call (fetch stubbed, no network)
ok 27 - paid engines pass the abort signal to the network call (fetch stubbed, no network)
  ---
  duration_ms: 3.330845
  type: 'test'
  ...
# Subtest: a run can end BLOCKED ON CEO instead of burning turns
ok 28 - a run can end BLOCKED ON CEO instead of burning turns
  ---
  duration_ms: 0.528731
  type: 'test'
  ...
# Subtest: agents are told they may end BLOCKED ON CEO
ok 29 - agents are told they may end BLOCKED ON CEO
  ---
  duration_ms: 0.094838
  type: 'test'
  ...
# Subtest: budget: paid seats are off unless a valid, enabled budget.json exists
ok 30 - budget: paid seats are off unless a valid, enabled budget.json exists
  ---
  duration_ms: 4.244729
  type: 'test'
  ...
# Subtest: budget: a call is refused before it is made when its worst case would pass a cap
ok 31 - budget: a call is refused before it is made when its worst case would pass a cap
  ---
  duration_ms: 3.471807
  type: 'test'
  ...
# Subtest: budget: unknown model, missing max output, or unreadable ledger fail closed
ok 32 - budget: unknown model, missing max output, or unreadable ledger fail closed
  ---
  duration_ms: 1.047964
  type: 'test'
  ...
# Subtest: budget: provider usage maps to billable tokens (reasoning/thinking counted as output)
ok 33 - budget: provider usage maps to billable tokens (reasoning/thinking counted as output)
  ---
  duration_ms: 0.991488
  type: 'test'
  ...
# Subtest: model defaults to the free tier when unset or blank, without warning
ok 34 - model defaults to the free tier when unset or blank, without warning
  ---
  duration_ms: 1.288515
  type: 'test'
  ...
# Subtest: every known model id is accepted as written (surrounding space trimmed)
ok 35 - every known model id is accepted as written (surrounding space trimmed)
  ---
  duration_ms: 0.21348
  type: 'test'
  ...
# Subtest: an unknown model falls back to free and warns once
ok 36 - an unknown model falls back to free and warns once
  ---
  duration_ms: 0.206798
  type: 'test'
  ...
# Subtest: the free model is the first listed and is never the paid default name
ok 37 - the free model is the first listed and is never the paid default name
  ---
  duration_ms: 0.134041
  type: 'test'
  ...
# Subtest: blank voice id falls back to the default; a set one is trimmed and kept
ok 38 - blank voice id falls back to the default; a set one is trimmed and kept
  ---
  duration_ms: 2.170449
  type: 'test'
  ...
# Subtest: fishRequest builds the expected call and keeps the key out of the body
ok 39 - fishRequest builds the expected call and keeps the key out of the body
  ---
  duration_ms: 0.642925
  type: 'test'
  ...
# Subtest: blockedAddress refuses private, loopback and metadata addresses
ok 40 - blockedAddress refuses private, loopback and metadata addresses
  ---
  duration_ms: 7.379345
  type: 'test'
  ...
# Subtest: blockedAddress allows ordinary public addresses
ok 41 - blockedAddress allows ordinary public addresses
  ---
  duration_ms: 0.302978
  type: 'test'
  ...
# Subtest: blockedAddress treats malformed dotted-quad input as blocked
ok 42 - blockedAddress treats malformed dotted-quad input as blocked
  ---
  duration_ms: 0.272741
  type: 'test'
  ...
# Subtest: blockedAddress fails closed on empty, missing or non-IP input
ok 43 - blockedAddress fails closed on empty, missing or non-IP input
  ---
  duration_ms: 0.267642
  type: 'test'
  ...
# Subtest: blockedAddress still allows public IPv6 in the forms DNS returns
ok 44 - blockedAddress still allows public IPv6 in the forms DNS returns
  ---
  duration_ms: 0.242965
  type: 'test'
  ...
# Subtest: vetTarget returns a URL for a normal public https address
ok 45 - vetTarget returns a URL for a normal public https address
  ---
  duration_ms: 0.395932
  type: 'test'
  ...
# Subtest: vetTarget answers 400 for anything that is not an absolute http(s) url
ok 46 - vetTarget answers 400 for anything that is not an absolute http(s) url
  ---
  duration_ms: 0.468419
  type: 'test'
  ...
# Subtest: vetTarget answers 403 for local and private targets
ok 47 - vetTarget answers 403 for local and private targets
  ---
  duration_ms: 0.636043
  type: 'test'
  ...
# Subtest: proxyError carries the status for the caller
ok 48 - proxyError carries the status for the caller
  ---
  duration_ms: 0.295654
  type: 'test'
  ...
# Subtest: blockedAddress judges IPv6 by value: long forms and embedded IPv4 are blocked
ok 49 - blockedAddress judges IPv6 by value: long forms and embedded IPv4 are blocked
  ---
  duration_ms: 0.593462
  type: 'test'
  ...
# Subtest: blockedAddress allows public addresses wrongly blocked before
ok 50 - blockedAddress allows public addresses wrongly blocked before
  ---
  duration_ms: 0.318157
  type: 'test'
  ...
# Subtest: no npm script uses POSIX inline env assignment (VAR=1 command)
ok 51 - no npm script uses POSIX inline env assignment (VAR=1 command)
  ---
  duration_ms: 1.52518
  type: 'test'
  ...
# Subtest: bridge:writes enables writes through the cross-platform launcher
ok 52 - bridge:writes enables writes through the cross-platform launcher
  ---
  duration_ms: 0.259988
  type: 'test'
  ...
# Subtest: every script file an npm script points at exists
ok 53 - every script file an npm script points at exists
  ---
  duration_ms: 10.162592
  type: 'test'
  ...
# Subtest: sets variables for the child, including empty values and values containing "="
ok 54 - sets variables for the child, including empty values and values containing "="
  ---
  duration_ms: 74.131936
  type: 'test'
  ...
# Subtest: passes the child exit code through
ok 55 - passes the child exit code through
  ---
  duration_ms: 69.73347
  type: 'test'
  ...
# Subtest: does not leak variables into this process
ok 56 - does not leak variables into this process
  ---
  duration_ms: 74.789179
  type: 'test'
  ...
# Subtest: exits 2 with usage when the separator or command is missing
ok 57 - exits 2 with usage when the separator or command is missing
  ---
  duration_ms: 99.868868
  type: 'test'
  ...
# Subtest: exits 2 when an assignment is not NAME=value
ok 58 - exits 2 when an assignment is not NAME=value
  ---
  duration_ms: 42.904412
  type: 'test'
  ...
# Subtest: exits 127 when the command cannot be started
ok 59 - exits 127 when the command cannot be started
  ---
  duration_ms: 71.693315
  type: 'test'
  ...
1..59
# tests 59
# suites 0
# pass 59
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1732.964006
