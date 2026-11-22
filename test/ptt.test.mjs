// Push-to-talk: routing rules, key-state plumbing, and the gate's forced mode.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routePtt, acceptsUnheld, isTypingTarget, setPtt, pttHeld, onPtt } from '../src/lib/ptt.ts'
import { createNoiseGate } from '../src/lib/noiseGate.ts'

test('held words in dormant mode act as the wake word plus command', () => {
  assert.deepEqual(routePtt('  what is on my calendar ', 'wake'), { action: 'wake', text: 'what is on my calendar' })
})

test('held words mid-conversation or over his speech are an utterance', () => {
  assert.equal(routePtt('stop', 'guard').action, 'utterance')
  assert.equal(routePtt('next item', 'command').action, 'utterance')
})

test('nothing heard, or voice off, is dropped with a reason', () => {
  assert.equal(routePtt('   ', 'command').action, 'drop')
  assert.match(routePtt('', 'wake').why, /nothing heard/)
  assert.equal(routePtt('hello', 'deaf').action, 'drop')
})

test('push-to-talk only refuses unheld speech; default accepts it', () => {
  assert.equal(acceptsUnheld(true), false)
  assert.equal(acceptsUnheld(false), true)
})

test('typing in fields never triggers push-to-talk', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(isTypingTarget({ tagName }), true)
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(isTypingTarget({ tagName: 'BODY' }), false)
  assert.equal(isTypingTarget(null), false)
})

test('key state notifies subscribers once per change', () => {
  const seen = []
  const off = onPtt(h => seen.push(h))
  setPtt(true); setPtt(true); setPtt(false); setPtt(false)
  off()
  setPtt(true); setPtt(false)
  assert.deepEqual(seen, [true, false])
  assert.equal(pttHeld(), false)
})

test('gate: holding opens it even below the trigger, releasing ends it at once', () => {
  const g = createNoiseGate()
  const F = 1000 / 60
  let t = 0
  for (; t < 3000; t += F) g.step(0.004, t)                       // quiet room, floor learned
  const ev = []
  for (let i = 0; i < 60; i++, t += F) { const s = g.step(0.005, t, false, true); if (s.event) ev.push(s.event) }   // whisper, held 1 s
  const rel = g.step(0.005, t, false, false)
  assert.deepEqual(ev, ['arm', 'start'])
  assert.equal(rel.event, 'end')
  assert.equal(rel.speaking, false)
})

test('gate: holding over a loud TV still captures, and the TV alone does not', () => {
  const g = createNoiseGate()
  const F = 1000 / 60
  let t = 0, tvStarts = 0
  const tv = i => 0.04 + 0.02 * Math.sin(i / 5)
  for (let i = 0; t < 30000; t += F, i++) if (g.step(tv(i), t).event === 'start') tvStarts++
  let held = []
  for (let i = 0; i < 90; i++, t += F) { const s = g.step(tv(i) + 0.005, t, false, true); if (s.event) held.push(s.event) }
  assert.ok(tvStarts <= 1, `TV-only starts: ${tvStarts}`)
  assert.deepEqual(held, ['arm', 'start'])
  assert.equal(g.step(tv(0), t, false, false).event, 'end')
})

test('gate: a tap released before confirming is discarded, not sent', () => {
  const g = createNoiseGate()
  assert.equal(g.step(0.004, 0, false, true).event, 'arm')
  assert.equal(g.step(0.004, 17, false, false).event, 'discard')
})
