import { net, session, type Session } from 'electron'

// No "persist:" prefix => Electron keeps this session's cookies/cache purely in
// memory, cleared the moment the process exits; nothing from it is ever written
// to disk, and it's never shared with the app's own browsing/session state.
const PARTITION = 'preview-fetch'

let ephemeralSession: Session | null = null

/**
 * A dedicated, non-persistent Electron session — effectively an incognito tab
 * that only this module uses. Every bookmark-preview fetch (title/description/
 * thumbnail) goes through it, since some saved links are sensitive: no history,
 * no disk cookies, no cache survives past the running process.
 */
function getEphemeralSession(): Session {
  if (!ephemeralSession) {
    ephemeralSession = session.fromPartition(PARTITION, { cache: false })
    // Belt-and-suspenders: this session should never be able to prompt for or
    // receive OS-level permissions (camera, location, notifications, etc).
    ephemeralSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  }
  return ephemeralSession
}

export interface EphemeralResponse {
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  body: Buffer
  /** True when the body was cut off at maxBytes — `body` holds only the bytes collected so far. */
  truncated: boolean
}

export interface EphemeralFetchOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  /**
   * Stops reading (and resolves with whatever was collected) once the body
   * exceeds this many bytes, rather than buffering an unbounded response.
   */
  maxBytes?: number
}

/** GET a URL through the ephemeral session. Rejects on network error, timeout, or over maxBytes. */
export function ephemeralFetch(url: string, options: EphemeralFetchOptions = {}): Promise<EphemeralResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const req = net.request({
      url,
      method: 'GET',
      session: getEphemeralSession(),
      redirect: 'follow'
    })

    for (const [key, value] of Object.entries(options.headers ?? {})) {
      req.setHeader(key, value)
    }

    const timer = options.timeoutMs
      ? setTimeout(() => {
          if (settled) return
          settled = true
          req.abort()
          reject(new Error('Request timed out'))
        }, options.timeoutMs)
      : null

    function cleanup(): void {
      if (timer) clearTimeout(timer)
    }

    req.on('response', (res) => {
      const rawContentType = res.headers['content-type']
      const contentType = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType
      const headers = { get: (name: string) => (name.toLowerCase() === 'content-type' ? (contentType ?? null) : null) }

      const chunks: Buffer[] = []
      let received = 0
      res.on('data', (chunk: Buffer) => {
        if (settled) return
        received += chunk.length
        chunks.push(chunk)
        if (options.maxBytes && received > options.maxBytes) {
          settled = true
          cleanup()
          req.abort()
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            headers,
            body: Buffer.concat(chunks),
            truncated: true
          })
        }
      })
      res.on('end', () => {
        if (settled) return
        settled = true
        cleanup()
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers,
          body: Buffer.concat(chunks),
          truncated: false
        })
      })
      res.on('error', (err: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err)
      })
    })
    req.on('error', (err: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    })
    req.end()
  })
}
