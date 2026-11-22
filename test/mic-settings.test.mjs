import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAudioConstraints, summariseTrack, isDeviceUnavailable } from '../src/lib/micSettings.ts'

test('constraints always request echo cancellation, noise suppression and auto gain', () => {
  const c = buildAudioConstraints(null)
  assert.equal(c.echoCancellation, true)
  assert.equal(c.noiseSuppression, true)
  assert.equal(c.autoGainControl, true)
  assert.equal(c.deviceId, undefined)
})

test('a chosen microphone is requested exactly', () => {
  assert.deepEqual(buildAudioConstraints('abc123').deviceId, { exact: 'abc123' })
})

test('report lists the features the browser did not confirm', () => {
  const r = summariseTrack({ deviceId: 'x', echoCancellation: true, noiseSuppression: false, sampleRate: 48000 }, 'USB Mic')
  assert.equal(r.device, 'USB Mic')
  assert.equal(r.noiseSuppression, false)
  assert.equal(r.autoGainControl, 'unknown')
  assert.deepEqual(r.missing, ['noiseSuppression', 'autoGainControl'])
  assert.equal(r.sampleRate, 48000)
})

test('fully applied settings report nothing missing', () => {
  const r = summariseTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }, '')
  assert.deepEqual(r.missing, [])
  assert.equal(r.device, 'default microphone')
})

test('only device-level failures fall back to the default microphone', () => {
  assert.equal(isDeviceUnavailable({ name: 'OverconstrainedError' }), true)
  assert.equal(isDeviceUnavailable({ name: 'NotFoundError' }), true)
  assert.equal(isDeviceUnavailable({ name: 'NotAllowedError' }), false) // permission denied must not be retried silently
  assert.equal(isDeviceUnavailable(null), false)
})
