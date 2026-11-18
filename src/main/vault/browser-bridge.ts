import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { randomBytes } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { vaultStore } from './vault-store'
import { biometricGate } from './biometric'
import { hostnameOf, hostsMatch } from './url-match'
import { fetchImageAsDataUrl } from './link-preview'

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

  // Names only (no values, no prompt): lets an agent discover what it may ask for.
  if (url.pathname === '/v1/env/names' && req.method === 'GET') {
    sendJson(res, 200, { keys: vaultStore.listApiKeys().map((k) => ({ project: k.project, name: k.name })) })
    return
  }

  // `vaultic run`: API-key values for one project, as env vars. Touch ID on every call, never cached.
  if (url.pathname === '/v1/env' && req.method === 'POST') {
    let body: { project?: string; names?: string[]; reason?: string }
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      sendJson(res, 400, { error: 'invalid_json' })
      return
    }
    const project = (body.project || '').trim().toLowerCase()
    if (!project) {
      sendJson(res, 400, { error: 'project_required' })
      return
    }
    // Summaries carry no secrets, so a missing project is reported before any prompt.
    const keys = vaultStore
      .listApiKeys()
      .filter((k) => k.project.toLowerCase() === project && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k.name))
      .filter((k) => !Array.isArray(body.names) || body.names.includes(k.name))
    if (keys.length === 0) {
      sendJson(res, 404, { error: 'not_found' })
      return
    }
    // The caller's description is shown in the Touch ID prompt, so strip control chars and cap its length.
    const what = String(body.reason ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120).trim()
    const ok = await requireBridgeAuth(`inject ${keys.length} API keys ${what ? `to ${what}` : 'into a command'}`)
    if (!ok) {
      sendJson(res, 403, { error: 'auth_declined' })
      return
    }
    await vaultStore.markApiKeysUsed(keys.map((k) => k.id))
    const vars: Record<string, string> = {}
    for (const k of keys) {
      const value = vaultStore.getApiKeyValue(k.id)
      if (value !== null) vars[k.name] = value
    }
    sendJson(res, 200, { vars })
    return
  }

  if (url.pathname === '/v1/bookmarks' && req.method === 'POST') {
    const ok = await requireBridgeAuth('save bookmark from Chrome')
    if (!ok) {
      sendJson(res, 403, { error: 'auth_declined' })
      return
    }
    let body: {
      title?: string
      url?: string
      folder?: string
      description?: string
      imageUrl?: string
    }
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      sendJson(res, 400, { error: 'invalid_json' })
      return
    }
    const pageUrl = body.url?.trim()
    if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) {
      sendJson(res, 400, { error: 'url_required' })
      return
    }
    if (vaultStore.hasBookmarkUrl(pageUrl)) {
      sendJson(res, 200, { ok: true, alreadyExists: true })
      return
    }
    const title = (body.title || hostnameOf(pageUrl) || pageUrl).trim().slice(0, 200)
    const summary = await vaultStore.addBookmark({
      title,
      url: pageUrl,
      folder: body.folder?.trim() || undefined
    })
    // Best-effort preview — the page already handed us its own title/description/image,
    // captured straight from the loaded tab, so this just downloads the image server-side
    // (no CORS restriction here) rather than re-fetching the whole page a second time.
    const description = body.description?.trim().slice(0, 300) || undefined
    if (description || body.imageUrl) {
      const image = body.imageUrl ? await fetchImageAsDataUrl(body.imageUrl, pageUrl) : undefined
      if (description || image) {
        await vaultStore.saveBookmarkPreview(summary.id, { title, description, image })
      }
    }
    sendJson(res, 201, { id: summary.id, title: summary.title, host: summary.host })
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
