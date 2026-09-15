import { readdir, readFile, stat } from 'fs/promises'
import { join, basename, extname } from 'path'
import pdfParse from 'pdf-parse'

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '.vscode',
  '.idea'
])

const MAX_DEPTH = 6

const ENV_TEMPLATE_RE = /\.(example|sample|template|dist)$/i

function isEnvFile(filename: string): boolean {
  if (ENV_TEMPLATE_RE.test(filename)) return false
  return filename === '.env' || filename.startsWith('.env.') || filename.endsWith('.env')
}

/** Parses simple KEY=VALUE lines, ignoring comments/blank lines. Handles quoted values. */
export function parseEnvContent(content: string): Array<{ name: string; value: string }> {
  const results: Array<{ name: string; value: string }> = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const name = line.slice(0, eq).trim().replace(/^export\s+/, '')
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!value) continue
    results.push({ name, value })
  }
  return results
}

export interface ScannedFile {
  project: string
  filePath: string
  keys: Array<{ name: string; value: string }>
}

/** Read-only recursive scan for .env* files. Never writes anything. */
export async function scanForEnvFiles(rootDir: string): Promise<ScannedFile[]> {
  const results: ScannedFile[] = []

  async function walk(dir: string, depth: number, projectHint: string): Promise<void> {
    if (depth > MAX_DEPTH) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.git')) continue
        const childPath = join(dir, entry.name)
        // Project name = first-level subdirectory name under the scanned root
        const nextProjectHint = depth === 0 ? entry.name : projectHint
        await walk(childPath, depth + 1, nextProjectHint)
      } else if (entry.isFile() && isEnvFile(entry.name)) {
        const filePath = join(dir, entry.name)
        try {
          const stats = await stat(filePath)
          if (stats.size > 1_000_000) continue // skip anything absurdly large
          const content = await readFile(filePath, 'utf8')
          const keys = parseEnvContent(content)
          if (keys.length > 0) {
            results.push({
              project: projectHint || basename(dir),
              filePath,
              keys
            })
          }
        } catch {
          // unreadable file, skip
        }
      }
    }
  }

  await walk(rootDir, 0, '')
  return results
}

const RECOVERY_FILE_EXTENSIONS_RE = /\.(txt|csv|md|pdf)$/i
const RECOVERY_FILENAME_RE = /(recovery|backup).{0,20}codes?/i
const RECOVERY_CONTENT_HINT_RE = /(recovery|backup)[\s_-]*codes?/i

// Recovery/backup codes are typically short opaque tokens mixing letters and
// digits — e.g. "KKT3QYLY" (Nord), "bd6341a5-4664ca6a" (hyphenated hex
// pairs), or "a1b2-c3d4". Requiring at least one digit rules out ordinary
// words/headers ("Backup codes", "Used at") that would otherwise match the
// same alphanumeric shape.
const CODE_LINE_RE = /^[a-z0-9]{4,16}(?:[-\s][a-z0-9]{4,16})?$/i
const HAS_DIGIT_RE = /\d/

// Strips a leading list marker ("1.", "2)", "1\t", "-", "•") but only when
// it's followed by a separator — otherwise a code that itself starts with a
// digit (e.g. "676W2PF5" or "8107e73a-e67b6000") would get mangled.
const LIST_MARKER_RE = /^\s*(?:[-*•]\s+|\d{1,4}[.)]\s+|\d{1,4}\t+)/

function isRecoveryCodeCandidateFile(filename: string): boolean {
  return RECOVERY_FILE_EXTENSIONS_RE.test(filename)
}

/** Best-effort guess at which service a recovery-codes file belongs to, from its name. */
export function guessServiceName(filename: string): string {
  const stem = basename(filename).replace(RECOVERY_FILE_EXTENSIONS_RE, '')
  const cleaned = stem
    .replace(/[_-]?(recovery|backup)[_-]?codes?[_-]?/i, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'Recovery codes'
  return cleaned
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** Pulls out lines that look like standalone recovery codes, ignoring prose/headers. */
export function parseRecoveryCodesContent(content: string): string[] {
  const codes: string[] = []
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim().replace(LIST_MARKER_RE, '').trim()
    if (!line) continue
    if (CODE_LINE_RE.test(line) && HAS_DIGIT_RE.test(line)) codes.push(line)
  }
  return [...new Set(codes)]
}

const MAX_RECOVERY_FILE_SIZE = 5_000_000 // PDFs (with a logo/letterhead) run bigger than plain text exports

/** Reads a .txt/.csv/.md file as plain text, or extracts text from a .pdf. */
async function readRecoveryFileText(filePath: string): Promise<string> {
  if (extname(filePath).toLowerCase() === '.pdf') {
    const buffer = await readFile(filePath)
    const data = await pdfParse(buffer)
    return data.text
  }
  return readFile(filePath, 'utf8')
}

export interface ScannedRecoveryCodes {
  service: string
  filePath: string
  codes: string[]
}

/**
 * Read-only recursive scan for files that look like exported 2FA/account
 * recovery (backup) code lists — .txt/.csv/.md/.pdf files, confirmed by
 * either a recovery/backup-codes hint (in the filename or the content) or a
 * handful of code-shaped lines. Never writes anything.
 */
export async function scanForRecoveryCodes(rootDir: string): Promise<ScannedRecoveryCodes[]> {
  const results: ScannedRecoveryCodes[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || entry.name.startsWith('.git')) continue
        await walk(join(dir, entry.name), depth + 1)
      } else if (entry.isFile() && isRecoveryCodeCandidateFile(entry.name)) {
        const filePath = join(dir, entry.name)
        try {
          const stats = await stat(filePath)
          if (stats.size > MAX_RECOVERY_FILE_SIZE) continue
          const content = await readRecoveryFileText(filePath)
          const codes = parseRecoveryCodesContent(content)
          const looksLikeRecoveryFile =
            RECOVERY_FILENAME_RE.test(entry.name) || RECOVERY_CONTENT_HINT_RE.test(content) || codes.length >= 4
          if (codes.length > 0 && looksLikeRecoveryFile) {
            results.push({ service: guessServiceName(entry.name), filePath, codes })
          }
        } catch {
          // unreadable/unparseable file, skip
        }
      }
    }
  }

  await walk(rootDir, 0)
  return results
}

export interface ParsedRecoveryCodesFile {
  service: string
  codes: string[]
}

/**
 * Reads a single, user-picked .txt/.csv/.md/.pdf file and extracts recovery
 * codes from it. Unlike scanForRecoveryCodes, this trusts the user's
 * explicit file choice and doesn't gate on the filename looking like
 * "recovery codes".
 */
export async function parseRecoveryCodesFile(filePath: string): Promise<ParsedRecoveryCodesFile> {
  const stats = await stat(filePath)
  if (stats.size > MAX_RECOVERY_FILE_SIZE) throw new Error('File is too large to be a recovery-codes export.')
  const content = await readRecoveryFileText(filePath)
  const codes = parseRecoveryCodesContent(content)
  return { service: guessServiceName(basename(filePath)), codes }
}
