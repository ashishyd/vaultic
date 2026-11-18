// Shared by vaultic-cli.mjs and vaultic-mcp.mjs: ask the running Vaultic app for API keys as env vars.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BRIDGE = 'http://127.0.0.1:17843'
const TOKEN_PATH = join(homedir(), 'Library', 'Application Support', 'Vaultic', 'bridge-token')

async function call(path, init) {
  let token
  try {
    token = readFileSync(TOKEN_PATH, 'utf8').trim()
  } catch {
    throw new Error('cannot read the bridge token. Start Vaultic at least once.')
  }
  let res
  try {
    res = await fetch(`${BRIDGE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120_000)
    })
  } catch {
    throw new Error('Vaultic is not running (bridge on 127.0.0.1:17843 unreachable).')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 423) throw new Error('vault is locked. Unlock Vaultic and retry.')
  if (res.status === 403) throw new Error('Touch ID failed or was cancelled.')
  if (res.status === 404) throw new Error('no matching API keys for that project/names.')
  if (!res.ok) throw new Error(`bridge error: ${data.error || res.status}`)
  return data
}

/** Touch ID prompt in the app. `reason` is shown in it. Resolves to { NAME: value }. */
export async function fetchEnv({ project, names, reason }) {
  return (await call('/v1/env', { method: 'POST', body: JSON.stringify({ project, names, reason }) })).vars
}

/** [{ project, name }] with no values and no prompt. */
export async function listSecretNames() {
  return (await call('/v1/env/names', { method: 'GET' })).keys
}
