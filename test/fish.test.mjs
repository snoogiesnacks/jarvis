// Fish Audio is a paid API. These tests pin the rules that keep a blank or
// mistyped setting from silently selecting a paid model or an empty voice.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_FISH_VOICE_ID,
  FISH_MODELS,
  FREE_FISH_MODEL,
  fishRequest,
  resolveFishModel,
  resolveFishVoiceId,
} from '../bridge/fish.mjs'

test('model defaults to the free tier when unset or blank, without warning', () => {
  const warnings = []
  for (const raw of [undefined, '', '   ']) {
    assert.equal(resolveFishModel(raw, (m) => warnings.push(m)), FREE_FISH_MODEL)
  }
  assert.deepEqual(warnings, [])
})

test('every known model id is accepted as written (surrounding space trimmed)', () => {
  for (const id of FISH_MODELS) assert.equal(resolveFishModel(` ${id} `), id)
})

test('an unknown model falls back to free and warns once', () => {
  const warnings = []
  assert.equal(resolveFishModel('s3-ultra', (m) => warnings.push(m)), FREE_FISH_MODEL)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /s3-ultra/)
})

test('the free model is the first listed and is never the paid default name', () => {
  assert.equal(FISH_MODELS[0], FREE_FISH_MODEL)
  assert.notEqual(FREE_FISH_MODEL, 's2.1-pro')
})

test('blank voice id falls back to the default; a set one is trimmed and kept', () => {
  for (const raw of [undefined, '', '  ']) {
    assert.equal(resolveFishVoiceId(raw), DEFAULT_FISH_VOICE_ID)
  }
  assert.equal(resolveFishVoiceId(' abc123 '), 'abc123')
})

test('fishRequest builds the expected call and keeps the key out of the body', () => {
  const [url, init] = fishRequest({
    key: 'test-key-not-real',
    model: FREE_FISH_MODEL,
    voiceId: 'voice1',
    text: 'Good evening, sir.',
  })
  assert.equal(url, 'https://api.fish.audio/v1/tts')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.authorization, 'Bearer test-key-not-real')
  assert.equal(init.headers.model, FREE_FISH_MODEL)
  const body = JSON.parse(init.body)
  assert.deepEqual(body, {
    text: 'Good evening, sir.',
    reference_id: 'voice1',
    format: 'mp3',
    mp3_bitrate: 64,
    latency: 'balanced',
  })
  assert.ok(!init.body.includes('test-key-not-real'))
})
