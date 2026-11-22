import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeWav, STT_RATE } from '../src/lib/wav.ts'

test('encodeWav writes a 16 kHz mono 16-bit PCM header', () => {
  const v = new DataView(encodeWav(new Float32Array(160)))
  const s = (o, n) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(o + i)))
  assert.equal(s(0, 4), 'RIFF'); assert.equal(s(8, 4), 'WAVE'); assert.equal(s(36, 4), 'data')
  assert.equal(v.getUint16(20, true), 1)          // PCM
  assert.equal(v.getUint16(22, true), 1)          // mono
  assert.equal(v.getUint32(24, true), STT_RATE)
  assert.equal(v.getUint16(34, true), 16)
  assert.equal(v.getUint32(40, true), 320)
  assert.equal(v.byteLength, 44 + 320)
})

test('encodeWav clamps and scales samples', () => {
  const v = new DataView(encodeWav(new Float32Array([0, 1, -1, 2, -2, 0.5])))
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(i => v.getInt16(44 + i * 2, true)), [0, 32767, -32768, 32767, -32768, 16383])
})
