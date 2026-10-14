import { useEffect, useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { useEscapeKey } from '../lib/use-escape-key'
import type { BrowserBookmark } from '../../../preload/api-types'

interface ImportBookmarksModalProps {
  onClose: () => void
}

export function ImportBookmarksModal({ onClose }: ImportBookmarksModalProps): JSX.Element {
  useEscapeKey(onClose)
  const { refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)

  const [items, setItems] = useState<BrowserBookmark[]>([])
  const [loading, setLoading] = useState(true)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    window.vaultAPI
      .scanBrowserBookmarks()
      .then(({ bookmarks, permissionDenied }) => {
        setItems(bookmarks)
        setPermissionDenied(permissionDenied)
      })
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter(
      (b) =>
        !q ||
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.folder.toLowerCase().includes(q)
    )
  }, [items, query])

  // Group by browser/profile → folder so a folder's worth can be ticked at once.
  const groups = useMemo(() => {
    const map = new Map<string, BrowserBookmark[]>()
    for (const b of visible) {
      const k = `${b.browser} · ${b.profile} / ${b.folder || '(root)'}`
      map.set(k, [...(map.get(k) ?? []), b])
    }
    return [...map.entries()]
  }, [visible])

  function toggle(key: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function setMany(list: BrowserBookmark[], on: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const b of list) {
        if (b.alreadyAdded) continue
        if (on) next.add(b.key)
        else next.delete(b.key)
      }
      return next
    })
  }

  async function handleImport(): Promise<void> {
    const picked = items.filter((b) => selected.has(b.key))
    if (picked.length === 0) return
    setImporting(true)
    try {
      const { added, skipped } = await window.vaultAPI.importBookmarks(
        picked.map((b) => ({ title: b.title, url: b.url, folder: b.folder || undefined }))
      )
      await refresh()
      push(`Imported ${added} bookmark${added === 1 ? '' : 's'}${skipped ? ` (${skipped} duplicates skipped)` : ''}`, 'success')
      onClose()
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold">Import from Chrome</h2>
        <p className="mb-4 text-xs text-vt-muted">
          Read-only. Pick the bookmarks to move into Vaultic — your browser's bookmarks are left untouched, and nothing
          is saved until you confirm.
        </p>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title, URL or folder…"
          className="mb-3 w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
        />

        {permissionDenied && (
          <p className="mb-3 text-xs text-vt-danger">
            macOS blocked access to one or more browsers' bookmarks. Grant Vaultic access under System Settings →
            Privacy &amp; Security → Full Disk Access, then reopen this dialog.
          </p>
        )}

        {loading ? (
          <p className="text-xs text-vt-muted">Reading browser bookmarks…</p>
        ) : items.length === 0 ? (
          !permissionDenied && <p className="text-xs text-vt-muted">No Chrome, Brave or Edge bookmarks found.</p>
        ) : (
          <div className="flex-1 overflow-y-auto rounded-lg border border-vt-border">
            {groups.map(([group, list]) => {
              const selectable = list.filter((b) => !b.alreadyAdded)
              const allOn = selectable.length > 0 && selectable.every((b) => selected.has(b.key))
              return (
                <div key={group} className="border-b border-vt-border p-3 last:border-b-0">
                  <label className="mb-2 flex items-center gap-2 text-xs font-semibold text-vt-teal">
                    <input
                      type="checkbox"
                      checked={allOn}
                      disabled={selectable.length === 0}
                      onChange={(e) => setMany(list, e.target.checked)}
                    />
                    <span className="truncate">{group}</span>
                    <span className="ml-auto font-normal text-vt-muted">{list.length}</span>
                  </label>
                  <div className="flex flex-col gap-1">
                    {list.map((b) => (
                      <label
                        key={b.key}
                        className={`flex items-center gap-2 text-xs ${b.alreadyAdded ? 'opacity-50' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(b.key)}
                          disabled={b.alreadyAdded}
                          onChange={() => toggle(b.key)}
                        />
                        <span className="min-w-0 flex-1 truncate">{b.title}</span>
                        <span className="max-w-[40%] truncate text-vt-muted">
                          {b.alreadyAdded ? 'already added' : b.url}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-vt-muted">{selected.size} selected</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={selected.size === 0 || importing}
              className="rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
            >
              {importing ? 'Importing…' : `Import ${selected.size || ''}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
