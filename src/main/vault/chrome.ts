import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

type BrowserName = 'Google Chrome' | 'Safari' | 'Microsoft Edge'

async function frontmostBrowser(): Promise<BrowserName | null> {
  const script =
    'tell application "System Events" to get name of first application process whose frontmost is true'
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 5000 })
    const name = stdout.trim()
    if (name === 'Google Chrome' || name === 'Chrome') return 'Google Chrome'
    if (name === 'Safari') return 'Safari'
    if (name === 'Microsoft Edge' || name === 'Edge') return 'Microsoft Edge'
    return null
  } catch {
    return null
  }
}

async function urlFromChromeLike(appName: 'Google Chrome' | 'Microsoft Edge'): Promise<string | null> {
  const script =
    `tell application "${appName}"\n` +
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

async function urlFromSafari(): Promise<string | null> {
  const script =
    'tell application "Safari"\n' +
    '  if (count of windows) = 0 then return ""\n' +
    '  return URL of current tab of front window\n' +
    'end tell'
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 5000 })
    const url = stdout.trim()
    return url || null
  } catch {
    return null
  }
}

/**
 * Reads the URL of the frontmost supported browser tab (Chrome, Safari, or Edge)
 * via AppleScript. macOS may prompt once to allow automation.
 */
export async function getFrontmostBrowserTabUrl(): Promise<{ url: string; browser: string } | null> {
  if (process.platform !== 'darwin') return null

  const front = await frontmostBrowser()
  const order: BrowserName[] = front
    ? [front, ...(['Google Chrome', 'Safari', 'Microsoft Edge'] as BrowserName[]).filter((b) => b !== front)]
    : ['Google Chrome', 'Safari', 'Microsoft Edge']

  for (const browser of order) {
    const url =
      browser === 'Safari' ? await urlFromSafari() : await urlFromChromeLike(browser)
    if (url) return { url, browser }
  }
  return null
}

/** @deprecated Prefer getFrontmostBrowserTabUrl — kept for older call sites. */
export async function getFrontmostChromeTabUrl(): Promise<string | null> {
  const result = await getFrontmostBrowserTabUrl()
  return result?.url ?? null
}
