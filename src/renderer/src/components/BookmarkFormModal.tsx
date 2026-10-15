import { useEffect, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { useEscapeKey } from '../lib/use-escape-key'

interface BookmarkFormModalProps {
  /** When set, edits this existing bookmark instead of creating a new one. */
  id?: string
  onClose: () => void
}

export function BookmarkFormModal({ id, onClose }: BookmarkFormModalProps): JSX.Element {
  useEscapeKey(onClose)
  const { refresh, bookmarks } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const existing = id ? bookmarks.find((b) => b.id === id) : undefined

  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [folder, setFolder] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!id)
  const [unavailable, setUnavailable] = useState(false)
  const [fetchingPreview, setFetchingPreview] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    window.vaultAPI.revealBookmarkUrl(id).then((b) => {
      if (cancelled) return
      if (!b) {
        setUnavailable(true)
      } else {
        setTitle(b.title)
        setUrl(b.url)
        setFolder(b.folder ?? '')
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [id])

  async function handleSave(): Promise<void> {
    setError(null)
    const lines = url
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) {
      setError('A link is required.')
      return
    }
    setSaving(true)
    try {
      if (id) {
        const result = await window.vaultAPI.updateBookmark(id, { title, url: lines[0], folder })
        if (!result) {
          setError('Could not save — check the link, or Touch ID was declined.')
          return
        }
        await refresh()
        push('Saved', 'success')
      } else if (lines.length === 1) {
        await window.vaultAPI.addBookmark({ title, url: lines[0], folder })
        await refresh()
        push('Saved', 'success')
      } else {
        const { added, skipped } = await window.vaultAPI.importBookmarks(
          lines.map((u) => ({ title: '', url: u, folder: folder || undefined }))
        )
        await refresh()
        push(`Added ${added} bookmark${added === 1 ? '' : 's'}${skipped ? ` (${skipped} duplicates skipped)` : ''}`, 'success')
      }
      onClose()
    } catch {
      setError('That does not look like a valid http(s) link.')
    } finally {
      setSaving(false)
    }
  }

  async function handleFetchPreview(): Promise<void> {
    if (!id) return
    setFetchingPreview(true)
    try {
      const result = await window.vaultAPI.fetchBookmarkPreview(id)
      if (result) {
        await refresh()
        push('Preview updated', 'success')
      } else {
        push('Could not fetch a preview for this link', 'error')
      }
    } finally {
      setFetchingPreview(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold">{id ? 'Edit Bookmark' : 'Add Bookmark'}</h2>
        <p className="mb-4 text-xs text-vt-muted">Private links, encrypted in your vault and opened with Touch ID.</p>

        {loading ? (
          <p className="text-xs text-vt-muted">Waiting for Touch ID…</p>
        ) : unavailable ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-vt-danger">Could not unlock this bookmark — Touch ID was declined or cancelled.</p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void handleSave()
            }}
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-vt-muted">
                {id ? 'Link' : 'Link(s)'}
              </label>
              {id ? (
                <input
                  autoFocus
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/page"
                  className={inputCls}
                />
              ) : (
                <textarea
                  autoFocus
                  rows={3}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={'https://example.com/page\nPaste one or more links, one per line'}
                  className={`${inputCls} resize-none`}
                />
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vt-muted">Title (optional)</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vt-muted">Folder (optional)</label>
              <input
                type="text"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="e.g. Reading list"
                className={inputCls}
              />
            </div>

            {id && (
              <div className="border-t border-vt-border pt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-medium text-vt-muted">Page preview</label>
                  <button
                    type="button"
                    onClick={() => void handleFetchPreview()}
                    disabled={fetchingPreview}
                    className="text-xs text-vt-teal hover:underline disabled:opacity-50"
                  >
                    {fetchingPreview
                      ? 'Fetching…'
                      : existing?.previewFetchedAt
                        ? 'Refresh preview'
                        : 'Fetch preview'}
                  </button>
                </div>
                {existing?.previewTitle || existing?.previewDescription || existing?.previewImage ? (
                  <div className="flex gap-2 rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-xs">
                    {existing.previewImage && (
                      <img
                        src={existing.previewImage}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-md border border-vt-border object-cover"
                      />
                    )}
                    <div className="min-w-0">
                      {existing.previewTitle && <p className="font-medium">{existing.previewTitle}</p>}
                      {existing.previewDescription && (
                        <p className="mt-0.5 text-vt-muted">{existing.previewDescription}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-vt-muted">
                    No preview fetched yet — pulls the page's title, description and thumbnail image.
                  </p>
                )}
              </div>
            )}

            {error && <p className="text-xs text-vt-danger">{error}</p>}

            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
