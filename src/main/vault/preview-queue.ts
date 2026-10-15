import { BrowserWindow } from 'electron'
import { fetchLinkPreview } from './link-preview'
import { vaultStore } from './vault-store'

const CONCURRENCY = 3
const BROADCAST_DEBOUNCE_MS = 400

interface QueueItem {
  id: string
  url: string
  /** The bookmark's current title — used only as a last-resort same-site search query. */
  title?: string
}

let active = 0
const queue: QueueItem[] = []
let broadcastTimer: ReturnType<typeof setTimeout> | null = null

/** Tells open windows to re-list bookmarks; coalesced so a big backfill doesn't spam IPC. */
function scheduleBroadcast(): void {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('vault:bookmarksUpdated')
    }
  }, BROADCAST_DEBOUNCE_MS)
}

async function runOne(item: QueueItem): Promise<void> {
  active++
  try {
    const { preview, status } = await fetchLinkPreview(item.url, item.title)
    // Always record the attempt (even an empty one) so a page with no metadata
    // (no og:image/description/title) isn't re-fetched forever on every session.
    await vaultStore.saveBookmarkPreview(item.id, preview ?? {}, status)
    scheduleBroadcast()
  } catch {
    // best-effort background enrichment — never surfaces an error to the user
  } finally {
    active--
    pump()
  }
}

function pump(): void {
  while (active < CONCURRENCY && queue.length > 0) {
    const item = queue.shift()
    if (item) void runOne(item)
  }
}

export function queuePreviewFetch(id: string, url: string, title?: string): void {
  if (!/^https?:\/\//i.test(url)) return
  queue.push({ id, url, title })
  pump()
}

export function queuePreviewFetches(items: Array<{ id: string; url: string; title?: string }>): void {
  for (const item of items) queuePreviewFetch(item.id, item.url, item.title)
}
