// Guards the Windows-compatibility fix: npm scripts run through cmd.exe on
// Windows, so POSIX inline environment assignments in them fail there.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))

test('no npm script uses POSIX inline env assignment (VAR=1 command)', () => {
  for (const [name, command] of Object.entries(pkg.scripts)) {
    assert.doesNotMatch(command, /(^|&&|\|\||;)\s*[A-Za-z_][A-Za-z0-9_]*=\S*\s+\S/, `script "${name}" uses inline env syntax that fails on Windows`)
  }
})

test('bridge:writes enables writes through the cross-platform launcher', () => {
  const command = pkg.scripts['bridge:writes']
  assert.match(command, /scripts\/with-env\.mjs/)
  assert.match(command, /JARVIS_ALLOW_WRITES=1/)
  assert.match(command, /bridge\/server\.mjs/)
})

test('every script file an npm script points at exists', () => {
  for (const [name, command] of Object.entries(pkg.scripts)) {
    for (const token of command.split(/\s+/).filter((t) => /\.m?js$/.test(t))) {
      assert.ok(existsSync(fileURLToPath(new URL(token, root))), `script "${name}" points at missing file ${token}`)
    }
  }
})
