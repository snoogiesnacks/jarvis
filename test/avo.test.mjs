import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runScenario, toMarkdown, redactor } from '../avo/office.mjs'
import { makeSeat, seatsFromEnv, systemPrompt } from '../avo/staff.mjs'
import { mockSeats } from '../avo/mock.mjs'
import { SCENARIOS } from '../avo/scenarios.mjs'

const sc = SCENARIOS[0]

test('conversation runs on its own until resolved', async () => {
  const r = await runScenario({ scenario: sc, seats: mockSeats({ resolveAt: 4 }) })
  assert.equal(r.resolved, true)
  assert.equal(r.transcript.length, 4)
  assert.equal(r.transcript[0].speaker, sc.opener)
})

test('turn limit stops a conversation that never resolves', async () => {
  const r = await runScenario({ scenario: sc, seats: mockSeats({ resolveAt: 99 }), maxTurns: 6 })
  assert.equal(r.resolved, false)
  assert.equal(r.transcript.length, 6)
})

test('speakers follow NEXT: hand-offs and never answer themselves', async () => {
  const r = await runScenario({ scenario: sc, seats: mockSeats({ resolveAt: 99 }), maxTurns: 6 })
  for (let i = 1; i < r.transcript.length; i++)
    assert.notEqual(r.transcript[i].speaker, r.transcript[i - 1].speaker)
})

test('an engine failure stops the run and is reported, not hidden', async () => {
  const r = await runScenario({ scenario: sc, seats: mockSeats({ fail: 3 }) })
  assert.match(r.error, /simulated outage/)
  assert.equal(r.transcript.length, 2)
})

test('CEO decisions are collected once each', async () => {
  const r = await runScenario({ scenario: sc, seats: mockSeats({ resolveAt: 4 }) })
  assert.equal(r.ceoDecisions.length, 1)
  assert.match(r.ceoDecisions[0], /approve the live test window/)
})

test('secrets are redacted from replies and errors', async () => {
  const env = { OPENAI_API_KEY: 'sk-live-ABCDEFGH12345' }
  const seats = mockSeats()
  seats.Claude.reply = async () => 'leaking sk-live-ABCDEFGH12345 [RESOLVED]'
  const r = await runScenario({ scenario: sc, seats, env })
  assert.ok(!JSON.stringify(r).includes('sk-live-ABCDEFGH12345'))
  assert.equal(redactor(env)('x sk-live-ABCDEFGH12345 y'), 'x [REDACTED] y')
})

test('stand-ins are labelled and told they are not the real agent', () => {
  const s = makeSeat('Halle', 'standin', {})
  assert.match(s.label, /STAND-IN/)
  assert.equal(s.real, false)
  assert.match(systemPrompt('Halle', { standIn: true }), /not the real Halle/)
})

test('default cast: real Claude, stand-ins for Halle and Gemini', () => {
  const seats = seatsFromEnv({})
  assert.equal(seats.Claude.engine, 'claude')
  assert.equal(seats.Halle.engine, 'standin')
  assert.equal(seats.Gemini.engine, 'standin')
})

test('paid engines refuse to run without explicit approval, key and model', async () => {
  const halle = makeSeat('Halle', 'openai', { OPENAI_API_KEY: 'k'.repeat(20) })
  await assert.rejects(halle.reply('hi'), /AVO_ALLOW_PAID=1/)
  const gem = makeSeat('Gemini', 'gemini', { AVO_ALLOW_PAID: '1', GEMINI_API_KEY: 'k'.repeat(20) })
  await assert.rejects(gem.reply('hi'), /AVO_GEMINI_MODEL/)
})

test('transcript says it is a simulation and lists the cast', async () => {
  const seats = mockSeats({ resolveAt: 2 })
  const md = toMarkdown(await runScenario({ scenario: sc, seats }), seats)
  assert.match(md, /This is a simulation/)
  assert.match(md, /Halle \(mock\)/)
})

test('agents are told they can only talk', () => {
  for (const n of ['Halle', 'Claude', 'Gemini']) {
    const p = systemPrompt(n)
    assert.match(p, /Talk only/)
    assert.match(p, /CEO DECISION:/)
  }
})
