import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatUptime } from '../ops/uptime.mjs'

test('minutes, hours and days', () => {
  assert.equal(formatUptime(0), '0m')
  assert.equal(formatUptime(5 * 60000), '5m')
  assert.equal(formatUptime((2 * 60 + 3) * 60000), '2h 3m')
  assert.equal(formatUptime((1440 + 61) * 60000), '1d 1h 1m')
})

test('bad input reads as zero', () => {
  for (const v of [-1, NaN, undefined, 'x', null]) {
    assert.equal(formatUptime(v), '0m')
  }
})
