import { randomInt } from 'crypto'

export type Strength = 'weak' | 'fair' | 'strong'

export interface PasswordAnalysis {
  id: string
  strength: Strength
  reused: boolean
  ageDays: number
  stale: boolean
}

const STALE_AFTER_MS = 365 * 24 * 60 * 60 * 1000 // 1 year without a change

// A short list of extremely common passwords — a match here is always "weak"
// regardless of length/character variety.
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  '123456',
  '12345678',
  '123456789',
  'qwerty',
  'qwerty123',
  'letmein',
  'welcome',
  'admin',
  'iloveyou',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'abc123',
  '111111',
  '123123',
  'sunshine',
  'princess',
  'trustno1',
  'shadow',
  'master',
  'superman',
  'starwars'
])

/** Local, offline password strength scoring — no network, no AI. */
export function scorePassword(password: string): Strength {
  if (!password) return 'weak'
  const lower = password.toLowerCase()
  if (COMMON_PASSWORDS.has(lower)) return 'weak'

  const hasLower = /[a-z]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const hasDigit = /\d/.test(password)
  const hasSymbol = /[^a-zA-Z0-9]/.test(password)
  const classCount = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length

  if (password.length >= 14 && classCount >= 3) return 'strong'
  if (password.length >= 10 && classCount >= 2) return 'fair'
  if (password.length >= 8 && classCount >= 2) return 'fair'
  return 'weak'
}

/**
 * Scores every login and flags any password value reused across more than
 * one entry. Operates entirely on values already in the main process — the
 * caller passes plaintext in, but only the derived {strength, reused} labels
 * are ever sent back across IPC to the renderer.
 */
export function analyzeLogins(
  logins: Array<{ id: string; password: string; updatedAt: number }>
): PasswordAnalysis[] {
  const countByPassword = new Map<string, number>()
  for (const l of logins) {
    countByPassword.set(l.password, (countByPassword.get(l.password) ?? 0) + 1)
  }
  const now = Date.now()
  return logins.map((l) => {
    const ageMs = now - l.updatedAt
    return {
      id: l.id,
      strength: scorePassword(l.password),
      reused: (countByPassword.get(l.password) ?? 0) > 1,
      ageDays: Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000))),
      stale: ageMs >= STALE_AFTER_MS
    }
  })
}

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I/O to avoid visual ambiguity
const LOWER = 'abcdefghijkmnpqrstuvwxyz' // no l
const DIGITS = '23456789' // no 0/1
const SYMBOLS = '!@#$%^&*-_=+?'
const ALPHABET = UPPER + LOWER + DIGITS + SYMBOLS

/** Cryptographically random password generation — no AI involved, by design. */
export function generateStrongPassword(length = 20): string {
  const pools = [UPPER, LOWER, DIGITS, SYMBOLS]
  const chars: string[] = pools.map((pool) => pool[randomInt(pool.length)])
  while (chars.length < length) {
    chars.push(ALPHABET[randomInt(ALPHABET.length)])
  }
  // Fisher-Yates shuffle so the guaranteed-one-of-each-class chars aren't always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
