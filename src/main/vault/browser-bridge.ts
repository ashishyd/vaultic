import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { vaultStore } from './vault-store'
import { biometricGate } from './biometric'
import { hostnameOf, hostsMatch } from './url-match'

export const BRIDGE_PORT = 17843
export const BRIDGE_HOST = '127.0.0.1'

const NATIVE_HOST_NAME = 'com.vaultic.browser'
/** Stable Chrome extension ID (from extension/manifest.json key). */
export const EXTENSION_ID = 'lpeabbfkhjldbhilgbjoieaiofamefgf'

let server: Server | null = null

function tokenPath(): string {
  return join(app.getPath('userData'), 'bridge-token')
}

export function getOrCreateBridgeToken(): string {
  const path = tokenPath()
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8').trim()
    if (existing.length >= 32) return existing
  }
  const token = randomBytes(32).toString('hex')
  writeFileSync(path, token, { mode: 0o600 })
  return token
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  })
  res.end(payload)
}

function unauthorized(res: ServerResponse): void {
  sendJson(res, 401, { error: 'unauthorized' })
}

function locked(res: ServerResponse): void {
  sendJson(res, 423, { error: 'locked', message: 'Unlock Vaultic to continue' })
}

function authOk(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization
  if (!header) return false
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return Boolean(match && match[1] === token)
}

async function promptMasterPasswordFallback(reason: string): Promise<boolean> {
  // When Touch ID is unavailable, allow through if vault is unlocked —
  // browser fills already require an unlocked vault + bearer token.
  // Touch ID still gates when available.
  const { isBiometricsAvailable, promptBiometrics } = await import('./biometric')
  if (!isBiometricsAvailable()) return true
  return promptBiometrics(reason)
}

async function requireBridgeAuth(reason: string): Promise<boolean> {
  return biometricGate(reason, () => promptMasterPasswordFallback(reason))
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string
): Promise<void> {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {})
    return
  }

  const url = new URL(req.url || '/', `http://${BRIDGE_HOST}:${BRIDGE_PORT}`)

  // Status is public enough to say "is the bridge up" without the token,
  // but unlock state requires the token.
  if (url.pathname === '/v1/ping' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, version: app.getVersion() })
    return
  }

  if (!authOk(req, token)) {
    unauthorized(res)
    return
  }

  if (url.pathname === '/v1/status' && req.method === 'GET') {
    sendJson(res, 200, {
      unlocked: vaultStore.isUnlocked,
      version: app.getVersion(),
      hasVault: vaultStore.hasVault()
    })
    return
  }

  if (!vaultStore.isUnlocked) {
    locked(res)
    return
  }

  if (url.pathname === '/v1/logins' && req.method === 'GET') {
    const pageUrl = url.searchParams.get('url') || ''
    const host = hostnameOf(pageUrl) || url.searchParams.get('host') || ''
    if (!host) {
      sendJson(res, 400, { error: 'url_or_host_required' })
      return
    }
    const matches = vaultStore.listLogins().filter((l) => {
      const loginHost = hostnameOf(l.url)
      if (loginHost) return hostsMatch(host, loginHost)
      // Fall back: service name contains host (rough)
      return l.service.toLowerCase().includes(host.split('.')[0])
    })
    sendJson(res, 200, {
      host,
      logins: matches.map((l) => ({
        id: l.id,
        service: l.service,
        username: l.username,
        url: l.url,
        hasTotp: l.hasTotp,
        favorite: l.favorite
      }))
    })
    return
  }

  const unlockMatch = /^\/v1\/logins\/([^/]+)\/unlock$/.exec(url.pathname)
  if (unlockMatch && req.method === 'POST') {
    const id = decodeURIComponent(unlockMatch[1])
    const ok = await requireBridgeAuth('fill login in Chrome')
    if (!ok) {
      sendJson(res, 403, { error: 'auth_declined' })
      return
    }
    const login = vaultStore.listLogins().find((l) => l.id === id)
    const password = vaultStore.getLoginPassword(id)
    if (!login || password === null) {
      sendJson(res, 404, { error: 'not_found' })
      return
    }
    let totp: string | undefined
    if (login.hasTotp) {
      try {
        totp = vaultStore.getTotpCode(id)?.code
      } catch {
        totp = undefined
      }
    }
    sendJson(res, 200, {
      id: login.id,
      service: login.service,
      username: login.username,
      password,
      url: login.url,
      totp
    })
    return
  }

  if (url.pathname === '/v1/logins' && req.method === 'POST') {
    const ok = await requireBridgeAuth('save login from Chrome')
    if (!ok) {
      sendJson(res, 403, { error: 'auth_declined' })
      return
    }
    let body: {
      service?: string
      username?: string
      password?: string
      url?: string
      notes?: string
    }
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      sendJson(res, 400, { error: 'invalid_json' })
      return
    }
    if (!body.password || (!body.service && !body.url)) {
      sendJson(res, 400, { error: 'password_and_service_or_url_required' })
      return
    }
    const host = hostnameOf(body.url)
    const service = (body.service || host || 'Saved login').trim()
    const summary = await vaultStore.addLogin({
      service,
      username: (body.username || '').trim(),
      password: body.password,
      url: body.url?.trim() || undefined,
      notes: body.notes?.trim() || undefined
    })
    sendJson(res, 201, { id: summary.id, service: summary.service, username: summary.username })
    return
  }

  sendJson(res, 404, { error: 'not_found' })
}

export function startBrowserBridge(): void {
  if (server) return
  const token = getOrCreateBridgeToken()

  server = createServer((req, res) => {
    handleRequest(req, res, token).catch((err) => {
      console.error('[browser-bridge]', err)
      sendJson(res, 500, { error: 'internal' })
    })
  })

  server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
    console.log(`[browser-bridge] listening on http://${BRIDGE_HOST}:${BRIDGE_PORT}`)
  })

  server.on('error', (err) => {
    console.error('[browser-bridge] failed to start:', err)
  })
}

export function stopBrowserBridge(): void {
  if (!server) return
  server.close()
  server = null
}

export function getBridgeInfo(): {
  port: number
  host: string
  token: string
  extensionId: string
  nativeHostName: string
} {
  return {
    port: BRIDGE_PORT,
    host: BRIDGE_HOST,
    token: getOrCreateBridgeToken(),
    extensionId: EXTENSION_ID,
    nativeHostName: NATIVE_HOST_NAME
  }
}
