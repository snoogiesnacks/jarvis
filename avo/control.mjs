// CEO control for A.V.O.: approvals and the emergency stop.
//
// APPROVALS. Only the CEO grants approval, by editing avo/approvals.json by
// hand. Agents have no tools and cannot write files, and nothing an agent says
// in a conversation is ever read as approval. Every decision an agent raises is
// PENDING until an entry with its id appears in that file.
//
//   { "approvals": [ { "id": "paid-api-openai", "approvedBy": "Jahmod",
//                      "date": "2026-11-01", "expires": "2026-12-01", "note": "..." } ] }
//
// Rules: `date` and `expires` must be real YYYY-MM-DD dates; an entry is valid
// from `date` until the end of `expires` (required). Each paid engine needs its
// own id (paid-api-openai, paid-api-gemini). Revoke by deleting the entry.
// Dates are compared with the LOCAL calendar date of the machine running A.V.O.
// (localDay below). Another machine or time zone may see the window open or
// close up to a day apart, so give `expires` a day's margin.
//
// LIMITS — this is NOT tamper-proof authorization. Anyone or anything that can
// write files in this folder can create an entry that looks like Jahmod's. It
// stops agents (which have no tools) and accidents, not a compromised machine.
// There is also NO spend cap enforced anywhere yet; a budget limiter must exist
// before any paid engine is approved.
//
// EMERGENCY STOP. Create a file named STOP or STOP.txt in the avo folder, or
// set AVO_STOP=1. A run refuses to start, and a running one halts before its
// next turn. To recover: delete that file. Nothing else needs resetting.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const STOP_FILE = join(here, 'STOP')
export const APPROVALS_FILE = join(here, 'approvals.json')

export function stopRequested({ env = process.env, stopFile = STOP_FILE } = {}) {
  if (/^(1|true|yes|on)$/i.test(String(env.AVO_STOP ?? '').trim())) return `AVO_STOP=${env.AVO_STOP} is set`
  for (const f of [stopFile, `${stopFile}.txt`])
    if (existsSync(f)) return `emergency stop file present: ${f}`
  return null
}

/** Approvals from the CEO's file. A missing or malformed file means none. */
export function loadApprovals(file = APPROVALS_FILE) {
  try {
    const list = JSON.parse(readFileSync(file, 'utf8'))?.approvals
    if (!Array.isArray(list)) return []
    return list.filter(
      (a) =>
        a &&
        typeof a.id === 'string' &&
        a.id.trim() !== '' &&
        a.approvedBy === 'Jahmod' &&
        isDay(a.date) &&
        isDay(a.expires) &&
        a.expires >= a.date,
    )
  } catch {
    return []
  }
}

/** A real calendar date written YYYY-MM-DD. */
function isDay(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** Approved, and today (local date) is within [date, expires]. */
export function isApproved(id, approvals = loadApprovals(), today = localDay()) {
  return approvals.some((a) => a.id === id && a.date <= today && today <= a.expires)
}

export function localDay(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`
}

/** Throw unless the CEO has approved `id`. The one gate every effect goes through. */
export function requireApproval(id, approvals = loadApprovals()) {
  if (!isApproved(id, approvals)) {
    const err = new Error(`not approved by the CEO: "${id}" (add it to avo/approvals.json)`)
    err.code = 'ENOTAPPROVED'
    throw err
  }
}
