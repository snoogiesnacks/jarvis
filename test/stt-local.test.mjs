// Local offline STT (bridge/stt-local.mjs). The model test runs only where the Whisper model and
// sherpa-onnx-node runtime are installed (see docs/STT-LOCAL-EVALUATION-2026-11-22.md); elsewhere it is skipped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

process.env.JARVIS_STT = 'local'
const stt = await import('../bridge/stt-local.mjs')
const { encodeWav } = await import('../src/lib/wav.ts')

test('a repeated sentence (known Whisper hallucination) is collapsed', () => {
  assert.equal(stt.dedupeSentences('Open the Q status for the corporate division. Open the Q status for the corporate division.'), 'Open the Q status for the corporate division.')
  assert.equal(stt.dedupeSentences('Stop. Stop talking.'), 'Stop. Stop talking.')
  assert.equal(stt.dedupeSentences(''), '')
})

test('Whisper non-speech markers are treated as silence', () => {
  for (const s of ['[BLANK_AUDIO]', '(music)', ' [Noise] ', '(inaudible).']) assert.equal(stt.isNonSpeech(s), true, s)
  assert.equal(stt.isNonSpeech('play some music'), false)
})

const ready = stt.modelPresent() && stt.localSttEnabled()
const sample = path.join(stt.MODEL_DIR, 'test_wavs', '0.wav')

test('transcribes the model\'s own sample offline', { skip: !ready && 'model/runtime not installed' }, async () => {
  const want = fs.readFileSync(path.join(stt.MODEL_DIR, 'test_wavs', 'trans.txt'), 'utf8').split(/\r?\n/)[0].toLowerCase()
  const { text, ms } = await stt.transcribeWav(fs.readFileSync(sample))
  const words = want.replace(/[^a-z ]/g, '').split(/\s+/).filter(w => w.length > 3)
  const hit = words.filter(w => text.toLowerCase().includes(w)).length
  assert.ok(hit / words.length >= 0.8, `got "${text}" for "${want}"`)
  assert.ok(ms < 5000, `${ms} ms`)
})

test('accepts the browser\'s WAV encoding (encodeWav) end to end', { skip: !ready && 'model/runtime not installed' }, async () => {
  // Read the sample with a minimal parser, re-encode with the browser encoder, transcribe again.
  const b = fs.readFileSync(sample)
  let o = 12, data = null, rate = 0, bits = 16
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4), len = b.readUInt32LE(o + 4)
    if (id === 'fmt ') { rate = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22) }
    if (id === 'data') { data = b.subarray(o + 8, o + 8 + len); break }
    o += 8 + len + (len % 2)
  }
  assert.equal(rate, 16000); assert.equal(bits, 16)
  const f = new Float32Array(data.length / 2)
  for (let i = 0; i < f.length; i++) f[i] = data.readInt16LE(i * 2) / 32768
  const { text } = await stt.transcribeWav(Buffer.from(encodeWav(f)))
  assert.ok(text.length > 10, `got "${text}"`)
})

test('WAV parser reads exactly what encodeWav writes', () => {
  const src = new Float32Array([0, 0.5, -0.5, 0.25])
  const got = stt.parseWav16k(Buffer.from(encodeWav(src)))
  assert.equal(got.length, 4)
  src.forEach((x, i) => assert.ok(Math.abs(got[i] - x) < 1e-4, `${i}: ${got[i]} vs ${x}`))
  assert.throws(() => stt.parseWav16k(Buffer.from(encodeWav(src, 44100))), e => e.status === 415)
})

test('rejects audio that is not 16 kHz WAV with 415', { skip: !ready && 'model/runtime not installed' }, async () => {
  await assert.rejects(stt.transcribeWav(Buffer.from('this is not a wav file at all, just text padding.'.repeat(40))), e => e.status === 415)
  await assert.rejects(stt.transcribeWav(Buffer.from(encodeWav(new Float32Array(8000), 8000))), e => e.status === 415)
})
