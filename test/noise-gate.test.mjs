// Synthetic energy traces for the speech gate (src/lib/noiseGate.ts). 60 frames/s, seeded RNG, no microphone.
// These prove gate logic only. A real TV-on/TV-off room benchmark still has to be run on the laptop's microphone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createNoiseGate, percentileOf } from '../src/lib/noiseGate.ts'

const FRAME = 1000 / 60
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }

/** Run a list of [durationMs, energyFn(t, r)] segments through a gate; return events with times. */
function run(gate, segments, { guard = () => false, seed = 7 } = {}) {
  const r = rng(seed); let t = 0; const events = []
  for (const [dur, fn] of segments) {
    const end = t + dur
    for (; t < end; t += FRAME) { const s = gate.step(fn(t, r), t, guard(t)); events.open = (events.open ?? []); events.open.push([t, s.speaking]); if (s.event) events.push({ e: s.event, t, floor: s.floor }) }
  }
  return events
}
const starts = (ev, from = 0, to = Infinity) => ev.filter(x => x.e === 'start' && x.t >= from && x.t < to).length
const openFrac = (ev, from) => { const f = ev.open.filter(([t]) => t >= from); return f.filter(([, o]) => o).length / f.length }
const quiet = (t, r) => 0.004 + r() * 0.002                                  // empty room
const tv = (t, r) => (Math.sin(t / 90) > -0.3 ? 0.035 + r() * 0.03 : 0.018 + r() * 0.006)   // talk-show audio: syllables and short dips
const user = level => (t, r) => (Math.sin(t / 70) > -0.6 ? level * (0.8 + r() * 0.4) : level * 0.25)  // near-field voice with brief dips
const plus = (a, b) => (t, r) => a(t, r) + b(t, r)

test('percentileOf picks the requested rank', () => {
  assert.equal(percentileOf([5, 1, 3, 2, 4], 0.5), 3)
  assert.equal(percentileOf([5, 1, 3, 2, 4], 0), 1)
  assert.equal(percentileOf([], 0.5), 0)
})

test('quiet room: each spoken sentence is one segment', () => {
  const ev = run(createNoiseGate(), [[5000, quiet], [1500, user(0.08)], [2000, quiet], [2500, user(0.08)], [2000, quiet]])
  assert.equal(starts(ev), 2)
  assert.equal(ev.filter(x => x.e === 'end').length, 2)
})

test('TV on: the old EMA floor keeps triggering on the TV (the defect being fixed)', () => {
  const ev = run(createNoiseGate({ floorMode: 'ema' }), [[5000, quiet], [60000, tv]])
  assert.ok(openFrac(ev, 25000) > 0.5, `old gate open ${(openFrac(ev, 25000) * 100).toFixed(0)}% of TV-only time`)
})

test('TV on: the percentile floor learns the TV within seconds and stops triggering', () => {
  const ev = run(createNoiseGate(), [[5000, quiet], [60000, tv]])
  assert.ok(starts(ev, 25000) <= 1, `new gate starts during TV-only tail: ${starts(ev, 25000)}`)
  assert.ok(openFrac(ev, 25000) < 0.05, `new gate open ${(openFrac(ev, 25000) * 100).toFixed(1)}% of TV-only time`)
  const learned = ev.filter(x => x.t > 25000).map(x => x.floor)
  assert.ok(learned.every(f => f > 0.02) || learned.length === 0, 'floor sits at TV level')
})

test('TV on: the CEO speaking near the microphone is still heard', () => {
  const ev = run(createNoiseGate(), [[5000, quiet], [30000, tv], [2500, plus(tv, user(0.3))], [3000, tv]])
  assert.equal(starts(ev, 35000, 37500), 1, 'one segment for the spoken command over the TV')
})

test('a long continuous request is not cut into pieces by its own loudness', () => {
  const ev = run(createNoiseGate(), [[5000, quiet], [12000, user(0.1)], [2000, quiet]])
  assert.equal(starts(ev), 1)
  assert.equal(ev.filter(x => x.e === 'end').length, 1)
})

test('guard (JARVIS speaking) ignores residual echo at 2x the floor but not a real barge-in', () => {
  const echo = (t, r) => 0.004 + 0.008 * (0.8 + r() * 0.4)   // ~2x quiet floor
  const ev = run(createNoiseGate(), [[5000, quiet], [4000, echo], [1500, user(0.15)], [1000, quiet]], { guard: t => t >= 5000 && t < 10500 })
  assert.equal(starts(ev, 5000, 9000), 0, 'echo during guard ignored')
  assert.equal(starts(ev, 9000, 10500), 1, 'loud barge-in during guard still heard')
})

