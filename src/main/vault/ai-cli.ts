import { execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'

const execFileAsync = promisify(execFile)

export type AiCli = 'claude' | 'cursor-agent'

// A GUI app launched from Finder/Dock (as opposed to a shell) inherits a
// minimal PATH from launchd that excludes things like ~/.local/bin, so
// `claude`/`cursor-agent` installed via common installers can't be found
// even though they work fine from Terminal. Resolve the user's real PATH by
// asking their login shell once, and reuse it for every spawn below.
let resolvedPath: string | null | undefined

async function getResolvedPath(): Promise<string | null> {
  if (resolvedPath !== undefined) return resolvedPath
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const { stdout } = await execFileAsync(shell, ['-lic', 'echo -n "$PATH"'], { timeout: 8000 })
    resolvedPath = stdout.trim() || null
  } catch {
    resolvedPath = null
  }
  return resolvedPath
}

async function spawnEnv(): Promise<NodeJS.ProcessEnv> {
  const path = await getResolvedPath()
  return path ? { ...process.env, PATH: path } : process.env
}

const CATEGORIES = [
  'Social',
  'Finance',
  'Work',
  'Shopping',
  'Entertainment',
  'Developer',
  'Email',
  'Utilities',
  'Other'
] as const

/** Checks which supported local CLI is installed, without invoking it. */
export async function detectAvailableCli(): Promise<AiCli | null> {
  const env = await spawnEnv()
  for (const bin of ['claude', 'cursor-agent'] as const) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 5000, env })
      return bin
    } catch {
      // not installed / not on PATH — try the next one
    }
  }
  return null
}

export interface CategorizableLogin {
  id: string
  service: string
  url?: string
}

// Keep each CLI call small: avoids the process timing out or hitting the
// model's context/output limits on a vault with hundreds of logins, and keeps
// a single slow/failing batch from taking down the whole categorization run.
const BATCH_SIZE = 40
const BATCH_TIMEOUT_MS = 45_000

function buildPrompt(items: CategorizableLogin[]): string {
  const list = items.map((i) => ({ id: i.id, service: i.service, url: i.url }))
  return [
    'You are a strict JSON API, not a chat assistant. Do not use any tools.',
    `Categorize each website/service below into exactly one of: ${CATEGORIES.join(', ')}.`,
    'Respond with ONLY a single-line JSON object mapping id to category, e.g. {"1":"Finance","2":"Social"}.',
    'No markdown fences, no explanation, no other text.',
    `Input: ${JSON.stringify(list)}`
  ].join('\n')
}

function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error('No JSON object found in the AI response.')
  return raw.slice(start, end + 1)
}

/**
 * execFile errors carry the full command (including our prompt) in `.message`
 * — never show that to the user. Prefer the process's actual stderr, capped
 * to a sane length, with a generic fallback if there's no stderr at all.
 */
function cleanErrorMessage(err: unknown, cli: AiCli): string {
  if (err && typeof err === 'object') {
    const anyErr = err as { stderr?: string; killed?: boolean; signal?: string }
    const stderr = anyErr.stderr?.trim()
    if (stderr) return stderr.slice(0, 400)
    if (anyErr.killed || anyErr.signal === 'SIGTERM') return `${cli} timed out.`
  }
  return `${cli} exited with an error and no output.`
}

async function runBatch(
  cli: AiCli,
  items: CategorizableLogin[],
  env: NodeJS.ProcessEnv
): Promise<Record<string, string>> {
  const prompt = buildPrompt(items)
  const cwd = os.tmpdir() // avoid picking up this project's CLAUDE.md/agentic context

  let stdout: string
  try {
    if (cli === 'claude') {
      const result = await execFileAsync(
        'claude',
        ['-p', prompt, '--output-format', 'json', '--model', 'haiku', '--strict-mcp-config'],
        { cwd, env, timeout: BATCH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
      )
      const envelope = JSON.parse(result.stdout)
      stdout = envelope.result ?? result.stdout
    } else {
      // cursor-agent's -p mode has tool access by default (per its own --help);
      // constrain it as tightly as its flags allow for this text-only task.
      const result = await execFileAsync(
        'cursor-agent',
        ['-p', prompt, '--output-format', 'text', '--sandbox', 'enabled', '--workspace', cwd],
        { cwd, env, timeout: BATCH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
      )
      stdout = result.stdout
    }
  } catch (err) {
    throw new Error(cleanErrorMessage(err, cli))
  }

  const jsonText = extractJsonObject(stdout)
  const parsed = JSON.parse(jsonText) as Record<string, unknown>

  const categories: Record<string, string> = {}
  for (const [id, category] of Object.entries(parsed)) {
    categories[id] = typeof category === 'string' && (CATEGORIES as readonly string[]).includes(category)
      ? category
      : 'Other'
  }
  return categories
}

/**
 * Sends ONLY {id, service, url} to the local CLI — never usernames, passwords,
 * or notes. Uses whichever supported CLI is installed (claude, then cursor-agent).
 * Runs in small batches so a large vault doesn't hit a single call's time or
 * size limits; if some batches fail, the successful ones are still returned.
 */
export async function categorizeWithAi(
  items: CategorizableLogin[]
): Promise<{ categories: Record<string, string>; cli: AiCli; failedCount: number }> {
  const cli = await detectAvailableCli()
  if (!cli) {
    throw new Error('No supported AI CLI (claude or cursor-agent) found on this Mac.')
  }

  const env = await spawnEnv()
  const categories: Record<string, string> = {}
  let failedCount = 0
  let lastError: string | null = null

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    try {
      Object.assign(categories, await runBatch(cli, batch, env))
    } catch (err) {
      failedCount += batch.length
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  if (Object.keys(categories).length === 0 && lastError) {
    throw new Error(lastError)
  }

  return { categories, cli, failedCount }
}
