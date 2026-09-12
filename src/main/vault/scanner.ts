import { readdir, readFile, stat } from 'fs/promises'
import { join, basename } from 'path'

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

function isEnvFile(filename: string): boolean {
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
