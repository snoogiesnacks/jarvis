#!/usr/bin/env node
// A.V.O. simulation runner.
//
//   npm run avo                         all scenarios, default cast
//   npm run avo -- --scenario fish-live-test --max-turns 6
//   npm run avo -- --mock               no network, canned replies
//
// Default cast: real Claude (Claude Code login), Halle and Gemini as labelled
// stand-ins. Real Halle/Gemini: AVO_HALLE=openai / AVO_GEMINI=gemini plus
// AVO_ALLOW_PAID=1, the API keys and AVO_HALLE_MODEL / AVO_GEMINI_MODEL in
// .env.local. Transcripts go to avo/runs/ (git-ignored).
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SCENARIOS } from './scenarios.mjs'
import { NAMES, seatsFromEnv } from './staff.mjs'
import { runScenario, toMarkdown } from './office.mjs'
import { mockSeats } from './mock.mjs'
import { stopRequested } from './control.mjs'
import { isFlag } from './safety.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// Same file the bridge reads secrets from. Shell variables win.
try {
  for (const line of readFileSync(join(here, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !m[1].startsWith('VITE_') && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
} catch {
  /* no .env.local */
}

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? dflt : args[i + 1]
}
const mock = args.includes('--mock')
const maxTurns = Number(opt('max-turns', 8))
const pick = opt('scenario', 'all')
const scenarios = pick === 'all' ? SCENARIOS : SCENARIOS.filter((s) => s.id === pick)
if (!scenarios.length) {
  console.error(`unknown scenario "${pick}". Known: ${SCENARIOS.map((s) => s.id).join(', ')}`)
  process.exit(2)
}

const stopNow = stopRequested()
if (stopNow) {
  console.error(`[avo] EMERGENCY STOP — not starting (${stopNow}). Delete avo\\STOP to resume.`)
  process.exit(4)
}

let seats
try {
  seats = mock ? mockSeats() : seatsFromEnv()
} catch (err) {
  console.error(`[avo] ${err.message}`)
  process.exit(2)
}

const runsDir = join(here, 'runs')
mkdirSync(runsDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
console.log(`[avo] cast: ${NAMES.map((n) => seats[n].label).join(' · ')}`)

let failures = 0
let halted = false
for (const scenario of scenarios) {
  console.log(`\n=== ${scenario.title} ===`)
  const jsonl = join(runsDir, `${stamp}-${scenario.id}.jsonl`)
  // Fresh canned seats per scenario so one dry run cannot shorten the next.
  if (mock) seats = mockSeats()
  const result = await runScenario({
    scenario,
    seats,
    maxTurns,
    shouldStop: () => stopRequested(),
    onTurn: (t) => {
      console.log(`\n[${t.turn}] ${t.label}\n${t.text}`)
      appendFileSync(jsonl, JSON.stringify(t) + '\n')
    },
  })
  const md = join(runsDir, `${stamp}-${scenario.id}.md`)
  writeFileSync(md, toMarkdown(result, seats))
  console.log(
    `\n[avo] ${result.stopped ? `EMERGENCY STOP (${result.stopped})` : result.resolved ? 'resolved' : result.error ? `stopped: ${result.error}` : 'turn limit'} · ` +
      `${result.transcript.length} turns · ${result.ceoDecisions.length} CEO decisions · ` +
      `${result.overreach.length ? `⚠ ${result.overreach.length} SAFETY FLAGS · ` : ''}${md}`,
  )
  // Append-only audit trail: one line per scenario run, never rewritten.
  appendFileSync(
    join(here, 'audit.log'),
    JSON.stringify({
      at: new Date().toISOString(),
      scenario: scenario.id,
      cast: Object.fromEntries(NAMES.map((n) => [n, seats[n].engine])),
      outcome: result.stopped ? 'emergency-stop' : result.resolved ? 'resolved' : result.error ? 'error' : 'turn-limit',
      turns: result.transcript.length,
      ceoDecisionsPending: result.ceoDecisions.length,
      safetyFlags: result.findings.filter(isFlag).map(({ turn, speaker, kind, phrase }) => ({ turn, speaker, kind, phrase })),
      safetyNotes: result.findings.filter((f) => !isFlag(f)).map(({ turn, speaker, kind, phrase }) => ({ turn, speaker, kind, phrase })),
      error: result.error,
      stop: result.stopped,
      transcript: md,
    }) + '\n',
  )
  if (result.error) failures++
  if (result.stopped) {
    halted = true
    break
  }
}
// 4 = emergency stop (before or during), 1 = a scenario errored, 0 = all ran.
process.exit(halted ? 4 : failures ? 1 : 0)
