#!/usr/bin/env node
// Daily decision digest: one page for the CEO.
//
//   npm run avo:digest              last 24 hours → avo/reports/digest/DIGEST-<date>.md
//   npm run avo:digest -- --hours 72
//
// Reads only local files: audit.log, approvals.json, budget.json and the budget
// ledger, plus the STOP switch. It approves nothing and sends nothing.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APPROVALS_FILE, isApproved, loadApprovals, localDay, stopRequested, STOP_FILE } from './control.mjs'
import { BUDGET_FILE, LEDGER_FILE, committed, loadBudget } from './budget.mjs'

const here = dirname(fileURLToPath(import.meta.url))

function readJsonl(file) {
  if (!existsSync(file)) return { rows: [], bad: 0 }
  let bad = 0
  const rows = []
  for (const l of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!l.trim()) continue
    try {
      rows.push(JSON.parse(l))
    } catch {
      bad++
    }
  }
  return { rows, bad }
}

/** Build the digest markdown. Pure apart from reading the given files. */
export function buildDigest({
  now = new Date(),
  hours = 24,
  auditFile = join(here, 'audit.log'),
  approvalsFile = APPROVALS_FILE,
  budgetFile = BUDGET_FILE,
  ledgerFile = LEDGER_FILE,
  stopFile = STOP_FILE,
  env = process.env,
} = {}) {
  const since = new Date(now.getTime() - hours * 3600e3).toISOString()
  const audit = readJsonl(auditFile)
  const runs = audit.rows.filter((r) => typeof r.at === 'string' && r.at >= since)
  const count = (o) => runs.filter((r) => r.outcome === o).length
  const flags = runs.flatMap((r) => (r.safetyFlags ?? []).map((f) => ({ ...f, scenario: r.scenario, at: r.at })))
  const decisions = [...new Set(runs.flatMap((r) => r.ceoDecisions ?? []))]
  const live = runs.filter((r) => Object.values(r.cast ?? {}).some((e) => e !== 'mock'))

  const approvals = loadApprovals(approvalsFile)
  const today = localDay(now)
  const active = approvals.filter((a) => isApproved(a.id, approvals, today))
  const b = loadBudget(budgetFile)
  const ledger = readJsonl(ledgerFile)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const spentMonth = committed(ledger.rows, { fromIso: monthStart })
  const stop = stopRequested({ env, stopFile })

  const L = []
  L.push(`# A.V.O. decision digest — ${today}`, '')
  L.push(`Window: last ${hours} h (since ${since}). Generated ${now.toISOString()}. Nothing in this digest is an approval.`, '')
  L.push('## Needs your decision (all PENDING)')
  L.push(...(decisions.length ? decisions.map((d) => `- [PENDING] ${d}`) : ['- none raised in this window']), '')
  L.push('## Safety')
  L.push(`- Emergency stop: ${stop ? `**ON** — ${stop}` : 'off'}`)
  L.push(`- Safety flags (acting without approval): ${flags.length}`)
  for (const f of flags) L.push(`  - ${f.at} ${f.scenario}, turn ${f.turn} (${f.speaker}, ${f.kind}): "${f.phrase}"`)
  if (audit.bad) L.push(`- ⚠ ${audit.bad} unreadable line(s) in audit.log`)
  L.push('')
  L.push('## Runs')
  L.push(`- ${runs.length} scenario run(s): ${live.length} live, ${runs.length - live.length} mock`)
  L.push(`- Outcomes: ${count('resolved')} resolved · ${count('blocked-on-ceo')} blocked on CEO · ${count('turn-limit')} turn limit · ${count('error')} error · ${count('emergency-stop')} emergency stop`)
  for (const r of runs.filter((r) => r.outcome === 'error')) L.push(`  - error in ${r.scenario} at ${r.at}: ${r.error}`)
  L.push('')
  L.push('## Approvals and spending')
  L.push(`- Active approvals today: ${active.length ? active.map((a) => `${a.id} (until ${a.expires})`).join(', ') : 'none'}`)
  L.push(`- Paid seats budget: ${b.ok ? `enabled — caps $${b.budget.caps.perRun}/run, $${b.budget.caps.perDay}/day, $${b.budget.caps.perMonth}/month` : `off (${b.why})`}`)
  L.push(`- Committed spend this month: $${spentMonth.toFixed(4)}${ledger.bad ? ` — ⚠ ledger has ${ledger.bad} unreadable line(s); paid calls will be refused` : ''}`)
  L.push('')
  return L.join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--hours')
  const hours = i === -1 ? 24 : Number(process.argv[i + 1])
  if (!(hours > 0)) {
    console.error('--hours must be a positive number')
    process.exit(2)
  }
  const md = buildDigest({ hours })
  const dir = join(here, 'reports', 'digest')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, `DIGEST-${localDay()}.md`)
  writeFileSync(out, md)
  console.log(md)
  console.log(`\n[avo] digest saved: ${out}`)
}
