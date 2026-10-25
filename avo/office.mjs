// The A.V.O. table: runs one scenario as a conversation between the seats.
import { NAMES } from './staff.mjs'

const NEXT_RE = /NEXT:\s*\**\s*(Halle|Claude|Gemini)\b/i
const RESOLVED_RE = /\[RESOLVED\]/i
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

export async function runScenario({ scenario, seats, maxTurns = 8, onTurn = () => {}, env }) {
  const redact = redactor(env)
  const transcript = []
  let speaker = scenario.opener
  let resolved = false
  let error = null
  for (let turn = 1; turn <= maxTurns; turn++) {
    const seat = seats[speaker]
    let text
    try {
      text = redact(String(await seat.reply(render(scenario, transcript, speaker), { turn })))
    } catch (err) {
      error = `${speaker}: ${redact(String(err?.message ?? err))}`
      break
    }
    const entry = { turn, speaker, label: seat.label, real: seat.real, text }
    transcript.push(entry)
    onTurn(entry)
    if (RESOLVED_RE.test(text)) {
      resolved = true
      break
    }
    const asked = text.match(NEXT_RE)?.[1]
    const proper = asked && NAMES.find((n) => n.toLowerCase() === asked.toLowerCase())
    speaker = proper && proper !== speaker ? proper : NAMES[(NAMES.indexOf(speaker) + 1) % NAMES.length]
  }
  const ceoDecisions = [
    ...new Set(transcript.flatMap((t) => [...t.text.matchAll(CEO_RE)].map((m) => `${m[1].trim()} (${t.speaker})`))),
  ]
  return { scenario: scenario.id, title: scenario.title, transcript, resolved, error, ceoDecisions }
}

export function toMarkdown(result, seats, when = new Date()) {
  const cast = Object.values(seats).map((s) => `- ${s.label} — engine: ${s.engine}`)
  return [
    `# A.V.O. simulation — ${result.title}`,
    '',
    `Run: ${when.toISOString()} · Outcome: ${result.resolved ? 'RESOLVED' : result.error ? 'STOPPED ON ERROR' : 'TURN LIMIT REACHED'}`,
    '',
    '**This is a simulation.** Stand-ins are Claude playing a role; they are not Halle or Gemini and nothing they say is that agent\'s view or approval. No actions were taken outside this conversation.',
    '',
    '## Cast',
    ...cast,
    '',
    '## Conversation',
    ...result.transcript.flatMap((t) => [`**${t.turn}. ${t.label}**`, '', t.text, '']),
    ...(result.error ? ['## Error', result.error, ''] : []),
    '## Decisions for the CEO',
    ...(result.ceoDecisions.length ? result.ceoDecisions.map((d) => `- ${d}`) : ['- none raised']),
    '',
  ].join('\n')
}
