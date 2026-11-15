// Budget limiter for paid A.V.O. seats (OpenAI, Gemini). OFF BY DEFAULT.
//
// Paid engines refuse to run unless avo/budget.json exists, is valid, is
// enabled, and lists a price for the exact model. Every paid call then:
//   1. RESERVES its worst-case cost before the request (estimated input +
//      the full max output), and is refused if that reservation would push
//      spending past any cap (per run, per day, per month);
//   2. SETTLES to the actual cost from the provider's usage report;
//   3. RELEASES the reservation if the call fails or is cancelled.
// Everything is written to avo/budget-ledger.jsonl (append-only). If the ledger
// cannot be read or written, paid calls are refused (fail closed).
//
// Prices are NOT hard-coded: the CEO enters them in budget.json with the source
// URL and the date they were checked, because provider prices change.
//
//   {
//     "enabled": true,
//     "currency": "USD",
//     "caps": { "perRun": 0.50, "perDay": 2.00, "perMonth": 20.00 },
//     "prices": {
//       "openai:<exact-model>": { "inputPerMTok": 0, "outputPerMTok": 0,
//                                 "source": "https://...", "checked": "YYYY-MM-DD" },
//       "gemini:<exact-model>": { ... }
//     }
//   }
//
// LIMITS: costs are computed from the provider's own usage numbers and the
// prices in this file, so a wrong price means a wrong total. Provider-side
// limits (a hard cap set in the OpenAI / Google billing console) are still
// recommended as a second line of defence. This file is not tamper-proof.
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
export const BUDGET_FILE = join(here, 'budget.json')
export const LEDGER_FILE = join(here, 'budget-ledger.jsonl')

export class BudgetError extends Error {
  constructor(msg) {
    super(msg)
    this.code = 'EBUDGET'
  }
}

const pos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0
const nonneg = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Load and validate budget.json. Returns { ok, budget } or { ok:false, why }. */
export function loadBudget(file = BUDGET_FILE) {
  if (!existsSync(file)) return { ok: false, why: 'no avo/budget.json (paid seats are off by default)' }
  let b
  try {
    b = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { ok: false, why: 'avo/budget.json is not valid JSON' }
  }
  if (b?.enabled !== true) return { ok: false, why: 'budget.json has enabled != true' }
  if (b.currency !== 'USD') return { ok: false, why: 'budget.json currency must be "USD"' }
  const c = b.caps ?? {}
  if (!pos(c.perRun) || !pos(c.perDay) || !pos(c.perMonth))
    return { ok: false, why: 'caps.perRun, caps.perDay and caps.perMonth must all be positive numbers' }
  if (!(c.perRun <= c.perDay && c.perDay <= c.perMonth))
    return { ok: false, why: 'caps must satisfy perRun <= perDay <= perMonth' }
  if (!b.prices || typeof b.prices !== 'object') return { ok: false, why: 'budget.json has no prices' }
  for (const [k, p] of Object.entries(b.prices)) {
    if (!/^(openai|gemini):\S+$/.test(k)) return { ok: false, why: `bad price key "${k}" (use openai:<model> or gemini:<model>)` }
    if (!nonneg(p?.inputPerMTok) || !nonneg(p?.outputPerMTok) || !(p.inputPerMTok + p.outputPerMTok > 0))
      return { ok: false, why: `price for ${k} needs inputPerMTok and outputPerMTok (USD per million tokens)` }
    if (typeof p.source !== 'string' || !/^https:\/\//.test(p.source) || !isDay(p.checked))
      return { ok: false, why: `price for ${k} needs a https source and a checked date` }
  }
  return { ok: true, budget: b }
}

/** Throw unless the budget allows this engine/model at all. */
export function requireBudget(engine, model, file = BUDGET_FILE) {
  const r = loadBudget(file)
  if (!r.ok) throw new BudgetError(`budget limiter: ${r.why}`)
  const price = r.budget.prices[`${engine}:${model}`]
  if (!price) throw new BudgetError(`budget limiter: no price for ${engine}:${model} in budget.json`)
  return { budget: r.budget, price }
}

const usd = (inTok, outTok, p) => (inTok * p.inputPerMTok + outTok * p.outputPerMTok) / 1e6

/** Billable tokens from a provider usage report. Unknown shape → null. */
export function tokensFromUsage(engine, usage) {
  if (!usage) return null
  if (engine === 'openai') {
    // Reasoning tokens are included in output_tokens and billed as output.
    if (!nonneg(usage.input_tokens) || !nonneg(usage.output_tokens)) return null
    return { input: usage.input_tokens, output: usage.output_tokens }
  }
  if (engine === 'gemini') {
    // Output = visible candidates + thinking ("thoughts") tokens.
    const out = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0)
    if (!nonneg(usage.promptTokenCount) || !nonneg(out)) return null
    return { input: usage.promptTokenCount, output: out }
  }
  return null
}

function readLedger(file) {
  if (!existsSync(file)) return []
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    throw new BudgetError('budget limiter: ledger unreadable — refusing paid calls until it is fixed')
  }
}

/** Money committed (settled + still-open reservations) since `fromIso`, optionally for one run. */
export function committed(entries, { fromIso = '', runId } = {}) {
  const open = new Map()
  let total = 0
  for (const e of entries) {
    if (e.at < fromIso || (runId && e.runId !== runId)) continue
    if (e.kind === 'reserve') open.set(e.id, e.usd)
    else if (e.kind === 'settle') {
      open.delete(e.id)
      total += e.usd
    } else if (e.kind === 'release') open.delete(e.id)
  }
  for (const v of open.values()) total += v
  return total
}

function windowStarts(now) {
  const z = (n) => String(n).padStart(2, '0')
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const month = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  return { day, month, label: `${now.getFullYear()}-${z(now.getMonth() + 1)}` }
}

/**
 * Reserve worst-case cost for one call, or throw BudgetError.
 * Input tokens are estimated generously from characters (1 token per 3 chars).
 */
export function reserve({ engine, model, runId, promptChars, maxOutputTokens, file = BUDGET_FILE, ledger = LEDGER_FILE, now = new Date() }) {
  const { budget, price } = requireBudget(engine, model, file)
  if (!pos(maxOutputTokens)) throw new BudgetError('budget limiter: maxOutputTokens must be set for paid calls')
  const estimate = usd(Math.ceil(promptChars / 3), maxOutputTokens, price)
  const entries = readLedger(ledger)
  const w = windowStarts(now)
  const checks = [
    ['per run', committed(entries, { runId }), budget.caps.perRun],
    ['per day', committed(entries, { fromIso: w.day }), budget.caps.perDay],
    ['per month', committed(entries, { fromIso: w.month }), budget.caps.perMonth],
  ]
  for (const [name, spent, cap] of checks)
    if (spent + estimate > cap)
      throw new BudgetError(`budget limiter: ${name} cap $${cap.toFixed(2)} would be exceeded (committed $${spent.toFixed(4)} + this call up to $${estimate.toFixed(4)})`)
  const id = randomUUID()
  write(ledger, { at: now.toISOString(), kind: 'reserve', id, runId, engine, model, usd: estimate })
  return { id, estimate, price, ledger, runId, engine, model }
}

/** Record actual cost. Missing usage → keep the full reservation as the cost. */
export function settle(r, usage, now = new Date()) {
  const t = tokensFromUsage(r.engine, usage)
  const cost = t ? usd(t.input, t.output, r.price) : r.estimate
  write(r.ledger, { at: now.toISOString(), kind: 'settle', id: r.id, runId: r.runId, engine: r.engine, model: r.model, usd: cost, tokens: t, usageKnown: Boolean(t) })
  return cost
}

/** Cancel a reservation for a call that never produced a billable result. */
export function release(r, why, now = new Date()) {
  write(r.ledger, { at: now.toISOString(), kind: 'release', id: r.id, runId: r.runId, engine: r.engine, model: r.model, usd: 0, why: String(why).slice(0, 200) })
}

function write(ledger, entry) {
  try {
    appendFileSync(ledger, JSON.stringify(entry) + '\n')
  } catch {
    throw new BudgetError('budget limiter: cannot write ledger — refusing paid calls')
  }
}
