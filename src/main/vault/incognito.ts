import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'

const execFileAsync = promisify(execFile)

// Checked in priority order; the first installed app wins.
const CHROMIUM_CANDIDATES: Array<{ app: string; flag: string }> = [
  { app: 'Google Chrome', flag: '--incognito' },
  { app: 'Brave Browser', flag: '--incognito' },
  { app: 'Microsoft Edge', flag: '--inprivate' }
]

function isInstalled(app: string): boolean {
  return existsSync(`/Applications/${app}.app`)
}

/**
 * Opens `url` in a private/incognito window of whichever supported browser is
 * installed. Returns false (never throws) when nothing supported is found, so
 * callers can fall back to a normal open or show an error.
 */
export async function openUrlIncognito(url: string): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  if (!/^https?:\/\//i.test(url)) return false

  for (const { app, flag } of CHROMIUM_CANDIDATES) {
    if (!isInstalled(app)) continue
    try {
      await execFileAsync('open', ['-na', app, '--args', flag, url])
      return true
    } catch {
      // try the next candidate
    }
  }

  if (isInstalled('Firefox')) {
    try {
      await execFileAsync('open', ['-na', 'Firefox', '--args', '-private-window', url])
      return true
    } catch {
      // fall through
    }
  }

  return false
}
