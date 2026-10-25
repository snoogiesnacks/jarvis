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
    '- Anything needing the CEO (money, accounts, security, publishing, contacting customers) goes on its own line starting "CEO DECISION:".',
    '- Never write credentials, keys or personal data.',
    '- Keep each turn under 120 words. Build on what others said; disagree when you should.',
    `- End every turn with exactly one line: "NEXT: <${NAMES.join('|')}>" naming who should speak next, or "[RESOLVED]" once the team has an agreed plan with owners.`,
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------- engines ----------

async function claudeEngine({ system, prompt, model }) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const q = query({
    prompt,
    options: {
      systemPrompt: system,
      tools: [], // talk only: no built-in tools
      mcpServers: {}, // and no MCP servers
      settingSources: [], // ignore filesystem settings and hooks
      maxTurns: 1,
      persistSession: false,
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

function requirePaid(env, keyVar, modelVar, who) {
  if (env.AVO_ALLOW_PAID !== '1')
    throw new Error(`${who}: paid API engine needs AVO_ALLOW_PAID=1 (CEO approval and spend cap first)`)
  if (!env[keyVar]) throw new Error(`${who}: ${keyVar} is not set`)
  if (!env[modelVar]) throw new Error(`${who}: set ${modelVar} to the exact model name`)
  return { key: env[keyVar], model: env[modelVar] }
}

async function openaiEngine({ system, prompt, env }) {
  const { key, model } = requirePaid(env, 'OPENAI_API_KEY', 'AVO_HALLE_MODEL', 'Halle')
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, instructions: system, input: prompt, max_output_tokens: 400 }),
    signal: AbortSignal.timeout(60000),
  })
  if (!r.ok) throw new Error(`Halle: OpenAI HTTP ${r.status}`)
  const j = await r.json()
  return (j.output ?? [])
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('')
    .trim()
}

async function geminiEngine({ system, prompt, env }) {
  const { key, model } = requirePaid(env, 'GEMINI_API_KEY', 'AVO_GEMINI_MODEL', 'Gemini')
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 400 },
      }),
      signal: AbortSignal.timeout(60000),
    },
  )
  if (!r.ok) throw new Error(`Gemini: HTTP ${r.status}`)
  const j = await r.json()
  return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
}

/** Build the seat for one staff member. */
export function makeSeat(name, engine, env = process.env) {
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
    claude: (prompt) => claudeEngine({ system, prompt, model }),
    standin: (prompt) => claudeEngine({ system, prompt, model }),
    openai: (prompt) => openaiEngine({ system, prompt, env }),
    gemini: (prompt) => geminiEngine({ system, prompt, env }),
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
