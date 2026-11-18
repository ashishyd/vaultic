#!/usr/bin/env node
// Vaultic secret broker for coding agents (MCP over stdio, no dependencies).
// The agent names a project and a command; the user approves with Touch ID in Vaultic; the command runs
// with the keys in its environment and its output comes back with every secret value redacted.
// The model never receives a key value, only the names it can ask for.
import { execFile } from 'node:child_process'
import { fetchEnv, listSecretNames } from './env-client.mjs'

const TOOLS = [
  {
    name: 'list_secrets',
    description: 'List the project and variable names of API keys in Vaultic. Never returns values.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'run_with_secrets',
    description:
      'Run a command with a Vaultic project\'s API keys set as environment variables. The user approves each call ' +
      'with Touch ID. Returns exit code and output with secret values redacted. No shell: pass command and args separately.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        names: { type: 'array', items: { type: 'string' }, description: 'Only these variables (default: all in the project).' },
        cwd: { type: 'string' }
      },
      required: ['project', 'command']
    }
  }
]

const MAX_OUTPUT = 64 * 1024
const TIMEOUT_MS = 120_000

function redact(text, vars) {
  let out = text
  for (const [name, value] of Object.entries(vars)) {
    if (value.length >= 4) out = out.split(value).join(`[REDACTED:${name}]`)
  }
  return out.length > MAX_OUTPUT ? `${out.slice(0, MAX_OUTPUT)}\n[output truncated]` : out
}

async function runWithSecrets({ project, command, args = [], names, cwd }) {
  const vars = await fetchEnv({ project, names, reason: `let an agent run "${command}"` })
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd, env: { ...process.env, ...vars }, timeout: TIMEOUT_MS, maxBuffer: 4 * MAX_OUTPUT },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        const note = err && typeof err.code !== 'number' ? `\n[${err.code || err.message}]` : ''
        resolve(`exit ${code}${note}\n--- stdout ---\n${redact(stdout, vars)}\n--- stderr ---\n${redact(stderr, vars)}`)
      }
    )
  })
}

async function callTool(name, args) {
  if (name === 'list_secrets') return JSON.stringify(await listSecretNames(), null, 2)
  if (name === 'run_with_secrets') return runWithSecrets(args)
  throw new Error(`unknown tool ${name}`)
}

function send(msg) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
}

async function handle(msg) {
  const { id, method, params } = msg
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'vaultic', version: '0.1.0' } } })
  } else if (method === 'tools/list') {
    send({ id, result: { tools: TOOLS } })
  } else if (method === 'tools/call') {
    try {
      send({ id, result: { content: [{ type: 'text', text: await callTool(params.name, params.arguments ?? {}) }] } })
    } catch (e) {
      send({ id, result: { isError: true, content: [{ type: 'text', text: e.message }] } })
    }
  } else if (method === 'ping') {
    send({ id, result: {} })
  } else if (id !== undefined) {
    send({ id, error: { code: -32601, message: `method not found: ${method}` } })
  }
}

let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    try {
      void handle(JSON.parse(line))
    } catch {
      send({ id: null, error: { code: -32700, message: 'parse error' } })
    }
  }
})
