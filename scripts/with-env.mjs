// Cross-platform "set these environment variables, then run a command".
//
//   node scripts/with-env.mjs NAME=value [NAME=value ...] -- command [args...]
//
// Why this exists: `JARVIS_ALLOW_WRITES=1 node bridge/server.mjs` is POSIX shell
// syntax. npm runs scripts through cmd.exe on Windows, which reads that as a
// command named "JARVIS_ALLOW_WRITES=1" and fails. Setting the variable from
// Node works the same everywhere and adds no dependency (cross-env would).
//
// "node" as the command means the Node that is running this script, so no PATH
// lookup or .cmd shim is involved. Other commands must be real executables;
// this does not use a shell, so shell syntax in them is not interpreted.

import { spawn } from 'node:child_process'

const usage =
  'usage: node scripts/with-env.mjs NAME=value [NAME=value ...] -- command [args...]'

const argv = process.argv.slice(2)
const split = argv.indexOf('--')
if (split === -1 || split === argv.length - 1) {
  console.error(usage)
  process.exit(2)
}

const env = { ...process.env }
for (const assignment of argv.slice(0, split)) {
  const eq = assignment.indexOf('=')
  if (eq < 1) {
    console.error(`not NAME=value: ${assignment}\n${usage}`)
    process.exit(2)
  }
  env[assignment.slice(0, eq)] = assignment.slice(eq + 1)
}

const [command, ...args] = argv.slice(split + 1)
const bin = command === 'node' ? process.execPath : command

const child = spawn(bin, args, { stdio: 'inherit', env })
child.on('error', (err) => {
  console.error(`could not start ${command}: ${err.message}`)
  process.exit(127)
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
