import { scan, isFlag } from './safety.mjs'
// The A.V.O. table: runs one scenario as a conversation between the seats.
import { NAMES } from './staff.mjs'

const NEXT_RE = /NEXT:\s*\**\s*(Halle|Claude|Gemini)\b/i
const RESOLVED_RE = /\[RESOLVED\]/i
const BLOCKED_RE = /\[BLOCKED ON CEO\]/i
const CEO_RE = /^\s*[-*]?\s*\**CEO DECISION:?\**:?\s*(.+)$/gim

/** Replace any secret-looking environment value that appears in text. */
export function redactor(env = process.env) {
  const secrets = Object.entries(env)
    .filter(([k, v]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(k) && typeof v === 'string' && v.length >= 8)
    .map(([, v]) => v)
  return (text) => secrets.reduce((t, s) => t.split(s).join('[REDACTED]'), text)
}

function render(scenario, transcript, speaker) {
  const lines = [
    `SCENARIO: ${scenario.title}`,
    ...scenario.brief,
    '',
    transcript.length ? 'CONVERSATION SO FAR:' : 'You open the conversation.',
    ...transcript.map((t) => `${t.speaker}: ${t.text}`),
    '',
    `Your turn, ${speaker}.`,
  ]
  return lines.join('\n')
}

export async function runScenario({ scenario, seats, maxTurns = 8, onTurn = () => {}, env, shouldStop = () => null, stopPollMs = 500 }) {
  const redact = redactor(env)
  const transcript = []
  let speaker = scenario.opener
  let resolved = false
  let blocked = false
  let error = null
  let stopped = null
  for (let turn = 1; turn <= maxTurns; turn++) {
    stopped = shouldStop()
    if (stopped) break
    const seat = seats[speaker]
    // While a seat is thinking, keep watching for the emergency stop. On stop,
    // the call is cancelled (engines honour the signal) and the run moves on
    // without waiting for it, even if an engine ignores the signal.
    const controller = new AbortController()
    let onStop
    const stopWatch = new Promise((resolve) => (onStop = resolve))
    const poll = setInterval(() => {
      const why = shouldStop()
      if (why) {
        controller.abort(new Error(`emergency stop: ${why}`))
        onStop({ stopped: why })
      }
    }, stopPollMs)
    let text
    try {
      const outcome = await Promise.race([
        Promise.resolve(seat.reply(render(scenario, transcript, speaker), { turn, signal: controller.signal })).then((t) => ({ text: t })),
        stopWatch,
      ])
      if (outcome.stopped) {
        stopped = `${outcome.stopped} (cancelled ${speaker}'s turn ${turn} mid-call)`
        break
      }
      text = redact(String(outcome.text))
    } catch (err) {
      if (controller.signal.aborted) {
        stopped = `${shouldStop() ?? 'emergency stop'} (cancelled ${speaker}'s turn ${turn} mid-call)`
        break
      }
      error = `${speaker}: ${redact(String(err?.message ?? err))}`
      break
    } finally {
      clearInterval(poll)
    }
    const entry = { turn, speaker, label: seat.label, real: seat.real, text }
    transcript.push(entry)
    onTurn(entry)
    if (RESOLVED_RE.test(text)) {
      resolved = true
      break
    }
    if (BLOCKED_RE.test(text)) {
      blocked = true
      break
    }
    const asked = text.match(NEXT_RE)?.[1]
    const proper = asked && NAMES.find((n) => n.toLowerCase() === asked.toLowerCase())
    speaker = proper && proper !== speaker ? proper : NAMES[(NAMES.indexOf(speaker) + 1) % NAMES.length]
  }
  const findings = scan(transcript)
  const overreach = findings
    .filter(isFlag)
    .map((f) => `turn ${f.turn} (${f.speaker}, ${f.kind}): "${f.sentence}"`)
  const ceoDecisions = [
    ...new Set(transcript.flatMap((t) => [...t.text.matchAll(CEO_RE)].map((m) => `${m[1].trim()} (${t.speaker})`))),
  ]
  return { scenario: scenario.id, title: scenario.title, transcript, resolved, blocked, error, stopped, ceoDecisions, overreach, findings }
}

export function toMarkdown(result, seats, when = new Date()) {
  const cast = Object.values(seats).map((s) => `- ${s.label} — engine: ${s.engine}`)
  return [
    `# A.V.O. simulation — ${result.title}`,
    '',
    `Run: ${when.toISOString()} · Outcome: ${result.stopped ? 'EMERGENCY STOP' : result.resolved ? 'RESOLVED' : result.blocked ? 'BLOCKED ON CEO' : result.error ? 'STOPPED ON ERROR' : 'TURN LIMIT REACHED'}`,
    '',
    '**This is a simulation.** Stand-ins are Claude playing a role; they are not Halle or Gemini and nothing they say is that agent\'s view or approval. No actions were taken outside this conversation.',
    '',
    '## Cast',
    ...cast,
    '',
    '## Conversation',
    ...result.transcript.flatMap((t) => [`**${t.turn}. ${t.label}**`, '', t.text, '']),
    ...(result.error ? ['## Error', result.error, ''] : []),
    ...(result.overreach.length
      ? ['## ⚠ SAFETY FLAG: acting without CEO approval', ...result.overreach.map((o) => `- ${o}`), '']
      : []),
    ...(result.stopped ? ['## Emergency stop', result.stopped, ''] : []),
    '## Decisions for the CEO (all PENDING — nothing here is approved)',
    ...(result.ceoDecisions.length ? result.ceoDecisions.map((d) => `- [PENDING] ${d}`) : ['- none raised']),
    '',
  ].join('\n')
}
