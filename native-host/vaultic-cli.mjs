#!/usr/bin/env node
// vaultic run [-p <project>] -- <command...>
// Asks the running Vaultic app for one project's API keys (Touch ID prompt in the app),
// then runs <command> with them as environment variables. Nothing is written to disk.
import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import { fetchEnv } from './env-client.mjs'

const USAGE = 'Usage: vaultic run [-p <project>] -- <command...>\n  Default project: current folder name.'

function fail(msg, code = 1) {
  process.stderr.write(`vaultic: ${msg}\n`)
  process.exit(code)
}

const argv = process.argv.slice(2)
const dash = argv.indexOf('--')
const head = dash === -1 ? argv : argv.slice(0, dash)
const cmd = dash === -1 ? [] : argv.slice(dash + 1)
if (head[0] !== 'run' || cmd.length === 0) fail(USAGE, 2)

let project = basename(process.cwd())
const p = head.indexOf('-p')
if (p !== -1) project = head[p + 1] || fail(USAGE, 2)

let vars
try {
  vars = await fetchEnv({ project, reason: `run "${cmd[0]}"` })
} catch (e) {
  fail(e.message)
}

const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env: { ...process.env, ...vars } })
child.on('error', (e) => fail(`cannot run ${cmd[0]}: ${e.code || e.message}`, 127))
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 130 : 1)))
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill(s))
