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
// a single slow/failing batch from taking down the whole suggestion run.
const BATCH_SIZE = 40
const BATCH_TIMEOUT_MS = 45_000

function buildLabelPrompt(items: CategorizableLogin[], existingLabelNames: string[]): string {
  const list = items.map((i) => ({ id: i.id, service: i.service, url: i.url }))
  const lines = [
    'You are a strict JSON API, not a chat assistant. Do not use any tools.',
    'For each website/service below, suggest 1-2 short organizational labels for it (e.g. "Finance", "Work", "Dev Tools", "Shopping").'
  ]
  if (existingLabelNames.length > 0) {
    lines.push(`Prefer reusing one of these existing labels when it fits: ${existingLabelNames.join(', ')}.`)
    lines.push('Only invent a new label name if none of the existing ones fit well.')
  }
  lines.push(
    'Respond with ONLY a single-line JSON object mapping id to an array of label strings, e.g. {"1":["Finance"],"2":["Social","Entertainment"]}.',
    'No markdown fences, no explanation, no other text.',
    `Input: ${JSON.stringify(list)}`
  )
  return lines.join('\n')
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

async function runCli(cli: AiCli, prompt: string, env: NodeJS.ProcessEnv): Promise<string> {
  const cwd = os.tmpdir() // avoid picking up this project's CLAUDE.md/agentic context
  try {
    if (cli === 'claude') {
      const result = await execFileAsync(
        'claude',
        ['-p', prompt, '--output-format', 'json', '--model', 'haiku', '--strict-mcp-config'],
        { cwd, env, timeout: BATCH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
      )
      const envelope = JSON.parse(result.stdout)
      return envelope.result ?? result.stdout
    }
    // cursor-agent's -p mode has tool access by default (per its own --help);
    // constrain it as tightly as its flags allow for this text-only task.
    const result = await execFileAsync(
      'cursor-agent',
      ['-p', prompt, '--output-format', 'text', '--sandbox', 'enabled', '--workspace', cwd],
      { cwd, env, timeout: BATCH_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
    )
    return result.stdout
  } catch (err) {
    throw new Error(cleanErrorMessage(err, cli))
  }
}

async function runLabelBatch(
  cli: AiCli,
  items: CategorizableLogin[],
  existingLabelNames: string[],
  env: NodeJS.ProcessEnv
): Promise<Record<string, string[]>> {
  const stdout = await runCli(cli, buildLabelPrompt(items, existingLabelNames), env)
  const parsed = JSON.parse(extractJsonObject(stdout)) as Record<string, unknown>

  const suggestions: Record<string, string[]> = {}
  for (const [id, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) {
      const names = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 2)
      if (names.length > 0) suggestions[id] = names
    } else if (typeof value === 'string' && value.trim()) {
      suggestions[id] = [value]
    }
  }
  return suggestions
}

/**
 * Sends ONLY {id, service, url} to the local CLI — never usernames, passwords,
 * or notes — and asks it to suggest 1-2 short organizational labels per login,
 * preferring labels that already exist. Runs in small batches so a large vault
 * doesn't hit a single call's time or size limits; if some batches fail, the
 * successful ones are still returned.
 */
export async function suggestLabelsWithAi(
  items: CategorizableLogin[],
  existingLabelNames: string[]
): Promise<{ suggestions: Record<string, string[]>; cli: AiCli; failedCount: number }> {
  const cli = await detectAvailableCli()
  if (!cli) {
    throw new Error('No supported AI CLI (claude or cursor-agent) found on this Mac.')
  }

  const env = await spawnEnv()
  const suggestions: Record<string, string[]> = {}
  let failedCount = 0
  let lastError: string | null = null

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE)
    try {
      Object.assign(suggestions, await runLabelBatch(cli, batch, existingLabelNames, env))
    } catch (err) {
      failedCount += batch.length
      lastError = err instanceof Error ? err.message : String(err)
    }
  }

  if (Object.keys(suggestions).length === 0 && lastError) {
    throw new Error(lastError)
  }

  return { suggestions, cli, failedCount }
}
