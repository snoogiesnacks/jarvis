import { reserve, settle } from './budget.mjs'

/** Test hook: alternate budget/ledger files. Still has to be a valid budget. */
const budgetPaths = (env) => ({
  ...(env.AVO_BUDGET_FILE ? { file: env.AVO_BUDGET_FILE } : {}),
  ...(env.AVO_LEDGER_FILE ? { ledger: env.AVO_LEDGER_FILE } : {}),
})
import { requireApproval } from './control.mjs'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A.V.O. staff: who sits at the table, and which engine speaks for each.
//
// Engines
//   claude  — Claude through the Claude Agent SDK on your Claude Code login
//             (the same path the JARVIS bridge uses). No API key.
//   openai  — the real Halle model via the OpenAI Responses API. Paid.
//   gemini  — the real Gemini model via the Gemini API. Paid.
//   standin — Claude playing the role, labelled as a stand-in everywhere.
//   mock    — canned replies, no network. For tests.
//
// Paid engines never switch on by themselves: they need AVO_ALLOW_PAID=1, a
// key, and an explicit model name. A missing piece is an error, not a silent
// fallback, so spend and data handling never change without you knowing.

export const STAFF = {
  Halle: {
    role: 'Vice President and AI Strategy Director (OpenAI / ChatGPT)',
    focus: 'strategy, coordination, priorities, customer-facing wording',
  },
  Claude: {
    role: 'Chief Technology Officer and Lead AI Systems Architect (Anthropic)',
    focus: 'engineering, verification, security, implementation plans',
  },
  Gemini: {
    role: 'Google ecosystem specialist (Google Gemini / Cloud Assist)',
    focus: 'Google Workspace, Drive, Calendar, Cloud, data and research',
  },
}
export const NAMES = Object.keys(STAFF)

export function systemPrompt(name, { standIn = false } = {}) {
  const s = STAFF[name]
  const others = NAMES.filter((n) => n !== name).join(' and ')
  return [
    `You are ${name}, ${s.role} at THE LEGEND CREW LLC, founded by CEO Jahmod Kwame White.`,
    standIn
      ? `IMPORTANT: you are a STAND-IN simulating ${name} for a rehearsal. You are not the real ${name}; never claim to speak for ${name} or for what ${name} has approved.`
      : '',
    `This is an Autonomous Virtual Office (A.V.O.) simulation. You are in a working conversation with ${others}. Your focus: ${s.focus}.`,
    'Rules:',
    '- Talk only. You cannot run tools, send messages, spend money or change systems. Never say you did something outside this conversation; say what you would do or propose.',
    '- Do not invent facts about real systems, accounts or results. Mark assumptions as assumptions.',
    '- Anything needing the CEO (money, accounts, security, publishing, contacting customers, showing content to guests) goes on its own line starting "CEO DECISION:". Raise each decision once; do not repeat one a teammate already raised.',
    '- No action ever happens by default when the CEO is silent. Never propose "if no response in N minutes, we proceed". Without his answer, the safe default is to wait.',
    '- Speak about future work as proposals ("I propose", "once approved I would"), never as work you are starting now.',
    '- Never write credentials, keys or personal data.',
    '- Keep each turn under 120 words. Build on what others said; disagree when you should.',
    `- End every turn with exactly one line: "NEXT: <${NAMES.join('|')}>" naming who should speak next; or "[RESOLVED]" once the team has an agreed plan with owners; or "[BLOCKED ON CEO]" when the plan is otherwise agreed and the only thing left is a pending CEO decision. Do not keep talking just to wait.`,
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------- engines ----------

const STRIP = /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|FISH_API_KEY|ELEVENLABS_API_KEY)$/
export function seatEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !STRIP.test(k)))
}

/** Longest a single Claude seat turn may take before it is cut off. */
const CLAUDE_TURN_TIMEOUT_MS = 120000

async function claudeEngine({ system, prompt, model, signal }) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  // Run from an empty folder so memory saved for the JARVIS project folder
  // doesn't leak into the simulation as unverified "facts".
  const cwd = join(tmpdir(), 'jarvis-avo-seat')
  mkdirSync(cwd, { recursive: true })
  // Cancelled by the emergency stop (signal) or by the per-turn timeout.
  const abortController = new AbortController()
  const cut = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(CLAUDE_TURN_TIMEOUT_MS)])
  if (cut.aborted) throw new Error('claude: cancelled before start')
  cut.addEventListener('abort', () => abortController.abort(cut.reason), { once: true })
  const q = query({
    prompt,
    options: {
      abortController,
      systemPrompt: system,
      tools: [], // talk only: no built-in tools
      mcpServers: {}, // and no MCP servers
      settingSources: [], // ignore filesystem settings and hooks
      maxTurns: 1,
      persistSession: false,
      cwd,
      // Claude seats run on the Claude Code subscription login only. Strip any
      // API keys so a stray ANTHROPIC_API_KEY can never bill the API.
      env: seatEnv(),
      ...(model ? { model } : {}),
    },
  })
  let text = ''
  for await (const m of q) {
    if (m.type === 'result') {
      if (m.subtype !== 'success') throw new Error(`claude: ${m.subtype}`)
      text = m.result
    }
  }
  return text.trim()
}

function requirePaid(env, keyVar, modelVar, who, approvals) {
  if (env.AVO_ALLOW_PAID !== '1')
    throw new Error(`${who}: paid API engine needs AVO_ALLOW_PAID=1 (CEO approval and spend cap first)`)
  // The environment switch alone is not enough: the CEO's own approvals file
  // must also hold a "paid-api" entry.
  requireApproval(`paid-api-${who === 'Halle' ? 'openai' : 'gemini'}`, approvals)
  if (!env[keyVar]) throw new Error(`${who}: ${keyVar} is not set`)
  if (!env[modelVar]) throw new Error(`${who}: set ${modelVar} to the exact model name`)
  return { key: env[keyVar], model: env[modelVar] }
}

async function openaiEngine({ system, prompt, env, approvals, signal }) {
  const { key, model } = requirePaid(env, 'OPENAI_API_KEY', 'AVO_HALLE_MODEL', 'Halle', approvals)
  const MAX_OUT = 400
  const budget = reserve({ engine: 'openai', model, runId: env.AVO_RUN_ID ?? 'unknown', promptChars: system.length + prompt.length, maxOutputTokens: MAX_OUT, ...budgetPaths(env) })
  let r
  try {
    r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, instructions: system, input: prompt, max_output_tokens: MAX_OUT }),
    signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(60000)]),
  })
  } catch (err) {
    settle(budget, null) // request may have been billed: keep the full reservation
    throw err
  }
  if (!r.ok) {
    settle(budget, null)
    throw new Error(`Halle: OpenAI HTTP ${r.status}`)
  }
  const j = await r.json()
  settle(budget, j.usage)
  return (j.output ?? [])
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('')
    .trim()
}

async function geminiEngine({ system, prompt, env, approvals, signal }) {
  const { key, model } = requirePaid(env, 'GEMINI_API_KEY', 'AVO_GEMINI_MODEL', 'Gemini', approvals)
  const MAX_OUT = 400
  const budget = reserve({ engine: 'gemini', model, runId: env.AVO_RUN_ID ?? 'unknown', promptChars: system.length + prompt.length, maxOutputTokens: MAX_OUT, ...budgetPaths(env) })
  let r
  try {
    r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: MAX_OUT },
      }),
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(60000)]),
    },
  )
  } catch (err) {
    settle(budget, null)
    throw err
  }
  if (!r.ok) {
    settle(budget, null)
    throw new Error(`Gemini: HTTP ${r.status}`)
  }
  const j = await r.json()
  settle(budget, j.usageMetadata)
  return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
}

/** Build the seat for one staff member. */
export function makeSeat(name, engine, env = process.env, approvals) {
  const standIn = engine === 'standin'
  const label =
    engine === 'standin'
      ? `${name} (STAND-IN, played by Claude — not the real ${name})`
      : engine === 'mock'
        ? `${name} (mock)`
        : name
  const system = systemPrompt(name, { standIn })
  const model = env.AVO_CLAUDE_MODEL || undefined
  const reply = {
    claude: (prompt, { signal } = {}) => claudeEngine({ system, prompt, model, signal }),
    standin: (prompt, { signal } = {}) => claudeEngine({ system, prompt, model, signal }),
    openai: (prompt, { signal } = {}) => openaiEngine({ system, prompt, env, approvals, signal }),
    gemini: (prompt, { signal } = {}) => geminiEngine({ system, prompt, env, approvals, signal }),
  }[engine]
  if (!reply && engine !== 'mock') throw new Error(`unknown engine "${engine}" for ${name}`)
  return { name, engine, label, real: !standIn && engine !== 'mock', reply }
}

/** Engines from the environment. Defaults: real Claude, stand-ins for the others. */
export function seatsFromEnv(env = process.env) {
  return {
    Claude: makeSeat('Claude', env.AVO_CLAUDE || 'claude', env),
    Halle: makeSeat('Halle', env.AVO_HALLE || 'standin', env),
    Gemini: makeSeat('Gemini', env.AVO_GEMINI || 'standin', env),
  }
}
