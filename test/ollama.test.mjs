import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { reviewDir } from '../bridge/ollama.mjs'

test('a named review folder is used as given', () => {
  assert.equal(reviewDir({ JARVIS_REVIEW_DIR: ' C:/somewhere ' }, '/nowhere'), 'C:/somewhere')
})

test('"off" disables review records even when the workforce folder exists', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'jarvis-review-'))
  mkdirSync(path.join(home, 'Legend Crew AI', 'divisions', 'jarvis', 'review'), { recursive: true })
  assert.equal(reviewDir({ JARVIS_REVIEW_DIR: 'OFF' }, home), null)
})

test('with nothing set, the workforce review folder is used when present', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'jarvis-review-'))
  const dir = path.join(home, 'Legend Crew AI', 'divisions', 'jarvis', 'review')
  mkdirSync(dir, { recursive: true })
  assert.equal(reviewDir({}, home), dir)
})

test('with nothing set and no workforce folder, records are off', () => {
  assert.equal(reviewDir({}, mkdtempSync(path.join(tmpdir(), 'jarvis-review-'))), null)
})

test('bridge:local starts the bridge in Ollama mode through the launcher', async () => {
  const { readFileSync } = await import('node:fs')
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(pkg.scripts['bridge:local'], /scripts\/with-env\.mjs JARVIS_PROVIDER=ollama -- node bridge\/server\.mjs/)
})
