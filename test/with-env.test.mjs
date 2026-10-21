// scripts/with-env.mjs replaces the POSIX-only `VAR=1 node ...` form that broke
// `npm run bridge:writes` on Windows. These tests run the real script.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/with-env.mjs', import.meta.url))
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })

test('sets variables for the child, including empty values and values containing "="', () => {
  const result = run(
    'TEST_FOO=bar',
    'TEST_EMPTY=',
    'TEST_EQ=a=b',
    '--',
    'node',
    '-e',
    'console.log([process.env.TEST_FOO, process.env.TEST_EMPTY, process.env.TEST_EQ].join("|"))',
  )
  assert.equal(result.status, 0)
  assert.equal(result.stdout.trim(), 'bar||a=b')
})

test('passes the child exit code through', () => {
  const result = run('X=1', '--', 'node', '-e', 'process.exit(3)')
  assert.equal(result.status, 3)
})

test('does not leak variables into this process', () => {
  run('TEST_LEAK=1', '--', 'node', '-e', '0')
  assert.equal(process.env.TEST_LEAK, undefined)
})

test('exits 2 with usage when the separator or command is missing', () => {
  assert.equal(run('FOO=1').status, 2)
  assert.equal(run('FOO=1', '--').status, 2)
})

test('exits 2 when an assignment is not NAME=value', () => {
  const result = run('NOEQUALS', '--', 'node', '-e', '0')
  assert.equal(result.status, 2)
  assert.match(result.stderr, /NAME=value/)
})

test('exits 127 when the command cannot be started', () => {
  assert.equal(run('X=1', '--', 'definitely-not-a-real-command-xyz').status, 127)
})
