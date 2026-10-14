import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

export interface BrowserBookmark {
  /** Stable within one scan: `${profileDir}:${chrome node id}`. */
  key: string
  title: string
  url: string
  /** Folder path inside the browser, e.g. "Bookmarks bar / Work / Docs". */
  folder: string
  browser: string
  profile: string
}

const BROWSER_DIRS: Array<{ name: string; dir: string }> = [
  { name: 'Chrome', dir: 'Google/Chrome' },
  { name: 'Brave', dir: 'BraveSoftware/Brave-Browser' },
  { name: 'Edge', dir: 'Microsoft Edge' }
]

interface ChromeNode {
  id?: string
  name?: string
  type?: 'url' | 'folder'
  url?: string
  children?: ChromeNode[]
}

function walk(
  node: ChromeNode,
  path: string[],
  out: Array<{ id: string; title: string; url: string; folder: string }>
): void {
  if (node.type === 'url' && node.url) {
    out.push({ id: node.id ?? node.url, title: node.name || node.url, url: node.url, folder: path.join(' / ') })
    return
  }
  const next = node.name ? [...path, node.name] : path
  for (const child of node.children ?? []) walk(child, next, out)
}

/** Thrown internally to signal macOS denied access (vs. the file simply not existing). */
class PermissionDeniedError extends Error {}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'EPERM' || (err as NodeJS.ErrnoException)?.code === 'EACCES') {
      throw new PermissionDeniedError(path)
    }
    return null
  }
}

export interface BrowserBookmarkScan {
  bookmarks: BrowserBookmark[]
  /** True when macOS blocked reading a browser profile (needs Full Disk Access for Vaultic). */
  permissionDenied: boolean
}

/**
 * Read-only scan of installed Chromium browsers' bookmark files. Never writes
 * to the browser profile; results are staged in the UI for the user to pick from.
 */
export async function scanBrowserBookmarks(): Promise<BrowserBookmarkScan> {
  if (process.platform !== 'darwin') return { bookmarks: [], permissionDenied: false }
  const root = join(homedir(), 'Library', 'Application Support')
  const results: BrowserBookmark[] = []
  let permissionDenied = false

  for (const { name, dir } of BROWSER_DIRS) {
    const base = join(root, dir)
    try {
      const localState = await readJson<{
        profile?: { info_cache?: Record<string, { name?: string }> }
      }>(join(base, 'Local State'))
      let profiles: Record<string, { name?: string }> = localState?.profile?.info_cache ?? {}
      if (Object.keys(profiles).length === 0 && (await readJson(join(base, 'Default', 'Bookmarks')))) {
        profiles = { Default: {} }
      }

      for (const [profileDir, info] of Object.entries(profiles)) {
        const file = await readJson<{ roots?: Record<string, ChromeNode> }>(join(base, profileDir, 'Bookmarks'))
        if (!file?.roots) continue
        const profileName = info.name || profileDir
        for (const rootNode of Object.values(file.roots)) {
          if (!rootNode || typeof rootNode !== 'object') continue
          const flat: Array<{ id: string; title: string; url: string; folder: string }> = []
          walk(rootNode, [], flat)
          for (const b of flat) {
            results.push({
              key: `${name}:${profileDir}:${b.id}`,
              title: b.title,
              url: b.url,
              folder: b.folder,
              browser: name,
              profile: profileName
            })
          }
        }
      }
    } catch (err) {
      if (err instanceof PermissionDeniedError) {
        permissionDenied = true
        continue
      }
      throw err
    }
  }
  return { bookmarks: results, permissionDenied }
}
