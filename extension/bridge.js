/**
 * Talks to Vaultic via Native Messaging (preferred) or direct localhost fallback.
 */

const NATIVE_HOST = 'com.vaultic.browser'
const BRIDGE_BASE = 'http://127.0.0.1:17843'

async function getStoredToken() {
  const { bridgeToken } = await chrome.storage.local.get('bridgeToken')
  return bridgeToken || null
}

export async function setStoredToken(token) {
  await chrome.storage.local.set({ bridgeToken: token || '' })
}

function nativeSend(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: 'native_unavailable', message: chrome.runtime.lastError.message })
          return
        }
        resolve(response || { ok: false, error: 'empty_response' })
      })
    } catch (err) {
      resolve({ ok: false, error: 'native_unavailable', message: String(err) })
    }
  })
}

async function httpSend(method, path, body) {
  const token = await getStoredToken()
  if (!token) {
    return { ok: false, error: 'no_token', message: 'Set your Vaultic bridge token in extension options, or install the native host from Vaultic Settings.' }
  }
  try {
    const res = await fetch(`${BRIDGE_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, ...data }
  } catch (err) {
    return { ok: false, error: 'bridge_unreachable', message: err.message }
  }
}

/** Prefer native messaging; fall back to localhost + stored token. */
export async function vaultRequest(type, payload = {}) {
  const native = await nativeSend({ type, ...payload })
  if (native && native.error !== 'native_unavailable') {
    return native
  }

  if (type === 'ping') return httpSend('GET', '/v1/ping')
  if (type === 'status') return httpSend('GET', '/v1/status')
  if (type === 'findLogins') {
    return httpSend('GET', `/v1/logins?url=${encodeURIComponent(payload.url || '')}`)
  }
  if (type === 'unlockLogin') {
    return httpSend('POST', `/v1/logins/${encodeURIComponent(payload.id)}/unlock`, {})
  }
  if (type === 'saveLogin') {
    return httpSend('POST', '/v1/logins', {
      service: payload.service,
      username: payload.username,
      password: payload.password,
      url: payload.url
    })
  }
  return { ok: false, error: 'unknown_type' }
}
