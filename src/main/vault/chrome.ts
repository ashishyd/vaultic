import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * Reads the URL of Chrome's frontmost tab via AppleScript. macOS will prompt
 * the user once to allow Vaultic to control/automate Google Chrome — that's
 * expected system behavior for cross-app AppleScript, not a bug.
 */
export async function getFrontmostChromeTabUrl(): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  const script =
    'tell application "Google Chrome"\n' +
    '  if (count of windows) = 0 then return ""\n' +
    '  return URL of active tab of front window\n' +
    'end tell'
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 5000 })
    const url = stdout.trim()
    return url || null
  } catch {
    return null
  }
}
