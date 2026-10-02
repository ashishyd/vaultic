import { createHmac } from 'crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Decode a base32 secret (RFC 4648), ignoring spaces and padding. */
export function decodeBase32(secret: string): Buffer {
  const cleaned = secret.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = ''
  for (const ch of cleaned) {
    const val = BASE32_ALPHABET.indexOf(ch)
    if (val === -1) continue
    bits += val.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

/** Extract a base32 secret from a raw secret or otpauth:// URI. */
export function normalizeTotpSecret(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.toLowerCase().startsWith('otpauth://')) {
    try {
      const url = new URL(trimmed)
      const secret = url.searchParams.get('secret')
      return secret ? secret.replace(/\s+/g, '').toUpperCase() : null
    } catch {
      return null
    }
  }
  const cleaned = trimmed.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z2-7]+=*$/.test(cleaned)) return null
  return cleaned.replace(/=+$/, '')
}

export function generateTotpCode(
  secretBase32: string,
  nowMs = Date.now(),
  stepSeconds = 30,
  digits = 6
): { code: string; remainingSeconds: number } {
  const key = decodeBase32(secretBase32)
  if (key.length === 0) throw new Error('Invalid TOTP secret')
  const counter = Math.floor(nowMs / 1000 / stepSeconds)
  const remainingSeconds = stepSeconds - (Math.floor(nowMs / 1000) % stepSeconds)

  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter & 0xffffffff, 4)

  const hmac = createHmac('sha1', key).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)
  const code = (binary % 10 ** digits).toString().padStart(digits, '0')
  return { code, remainingSeconds }
}
