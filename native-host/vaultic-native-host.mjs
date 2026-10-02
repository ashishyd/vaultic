#!/usr/bin/env node
/**
 * Chrome Native Messaging host for Vaultic.
 * Protocol: length-prefixed JSON on stdin/stdout (uint32 LE).
 * Forwards requests to the local Vaultic browser bridge with the stored token.
 */
import { readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import http from 'http'

const __dirname = dirname(fileURLToPath(import.meta.url))

function readConfig() {
  const candidates = [
    join(__dirname, 'bridge-config.json'),
    join(process.env.HOME || '', 'Library/Application Support/Vaultic/native-host/bridge-config.json')
  ]
  for (const c of candidates) {
    if (existsSync(c)) {
      return JSON.parse(readFileSync(c, 'utf8'))
    }
  }
  return null
}

function sendMessage(msg) {
  const json = Buffer.from(JSON.stringify(msg), 'utf8')
  const header = Buffer.alloc(4)
  header.writeUInt32LE(json.length, 0)
  process.stdout.write(header)
  process.stdout.write(json)
}

function readMessages(onMessage) {
  let buffer = Buffer.alloc(0)
  process.stdin.on('readable', () => {
    let chunk
    while ((chunk = process.stdin.read()) !== null) {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 4) {
        const len = buffer.readUInt32LE(0)
        if (buffer.length < 4 + len) break
        const json = buffer.subarray(4, 4 + len).toString('utf8')
        buffer = buffer.subarray(4 + len)
        try {
          onMessage(JSON.parse(json))
        } catch (err) {
          sendMessage({ ok: false, error: 'invalid_message' })
        }
      }
    }
  })
}

function bridgeRequest(config, method, path, body) {
  return new Promise((resolve) => {
    const url = new URL(path, config.baseUrl)
    const payload = body ? JSON.stringify(body) : null
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          Authorization: `Bearer ${config.token}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        },
        timeout: 60000
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let data
          try {
            data = text ? JSON.parse(text) : {}
          } catch {
            data = { raw: text }
          }
          resolve({ status: res.statusCode || 0, data })
        })
      }
    )
    req.on('error', (err) => {
      resolve({ status: 0, data: { error: 'bridge_unreachable', message: err.message } })
    })
    if (payload) req.write(payload)
    req.end()
  })
}

async function handle(msg) {
  const config = readConfig()
  if (!config?.token || !config?.baseUrl) {
    return { ok: false, error: 'not_configured', message: 'Open Vaultic → Settings → Browser extension to finish setup.' }
  }

  const type = msg?.type
  if (type === 'ping') {
    const result = await bridgeRequest(config, 'GET', '/v1/ping')
    return { ok: result.status === 200, ...result.data }
  }
  if (type === 'status') {
    const result = await bridgeRequest(config, 'GET', '/v1/status')
    return { ok: result.status === 200, status: result.status, ...result.data }
  }
  if (type === 'findLogins') {
    const pageUrl = encodeURIComponent(msg.url || '')
    const result = await bridgeRequest(config, 'GET', `/v1/logins?url=${pageUrl}`)
    return { ok: result.status === 200, status: result.status, ...result.data }
  }
  if (type === 'unlockLogin') {
    const result = await bridgeRequest(config, 'POST', `/v1/logins/${encodeURIComponent(msg.id)}/unlock`, {})
    return { ok: result.status === 200, status: result.status, ...result.data }
  }
  if (type === 'saveLogin') {
    const result = await bridgeRequest(config, 'POST', '/v1/logins', {
      service: msg.service,
      username: msg.username,
      password: msg.password,
      url: msg.url
    })
    return { ok: result.status === 201, status: result.status, ...result.data }
  }
  return { ok: false, error: 'unknown_type' }
}

readMessages(async (msg) => {
  try {
    const result = await handle(msg)
    sendMessage(result)
  } catch (err) {
    sendMessage({ ok: false, error: 'host_error', message: err instanceof Error ? err.message : String(err) })
  }
})
