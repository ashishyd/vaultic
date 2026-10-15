import { useEffect, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { useEscapeKey } from '../lib/use-escape-key'
import { ImageLightbox } from './ImageLightbox'
import { ModalBackdrop } from './ModalBackdrop'
import { AlertTriangleIcon } from './icons'

interface BookmarkFormModalProps {
  /** When set, edits this existing bookmark instead of creating a new one. */
  id?: string
  onClose: () => void
}

export function BookmarkFormModal({ id, onClose }: BookmarkFormModalProps): JSX.Element {
  useEscapeKey(onClose)
  const { refresh, bookmarks, sensitiveFolders } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const existing = id ? bookmarks.find((b) => b.id === id) : undefined
  const existingFolders = [...new Set(bookmarks.map((b) => b.folder).filter((f): f is string => !!f))].sort(
    (a, b) => a.localeCompare(b)
  )

  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [folder, setFolder] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!id)
  const [unavailable, setUnavailable] = useState(false)
  const [fetchingPreview, setFetchingPreview] = useState(false)
  const [capturingPreview, setCapturingPreview] = useState(false)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [revealPreviewImage, setRevealPreviewImage] = useState(false)

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
      if (!result) {
        push('Touch ID failed or was cancelled', 'error')
      } else if (result.previewTitle || result.previewDescription || result.previewImage) {
        await refresh()
        push('Preview updated', 'success')
      } else {
        await refresh()
        push('No preview info found for this link', 'info')
      }
    } finally {
      setFetchingPreview(false)
    }
  }

  async function handleCaptureInteractive(): Promise<void> {
    if (!id) return
    setCapturingPreview(true)
    try {
      const result = await window.vaultAPI.captureBookmarkPreviewInteractive(id)
      if (!result) {
        push('Touch ID failed or was cancelled', 'error')
      } else if (result.cancelled) {
        push('Capture cancelled', 'info')
      } else {
        await refresh()
        push(
          result.bookmark?.previewTitle || result.bookmark?.previewDescription || result.bookmark?.previewImage
            ? 'Preview captured'
            : 'No preview info found on the page',
          'success'
        )
      }
    } finally {
      setCapturingPreview(false)
    }
  }

  async function handleToggleBookmarkSensitive(): Promise<void> {
    if (!id) return
    const next = !(existing?.sensitive ?? false)
    await window.vaultAPI.setBookmarkSensitive(id, next)
    await refresh()
  }

  async function handleToggleFolderSensitive(): Promise<void> {
    const trimmed = folder.trim()
    if (!trimmed) return
    await window.vaultAPI.setFolderSensitive(trimmed, !sensitiveFolders.includes(trimmed))
    await refresh()
  }

  const inputCls =
    'w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal'

  return (
    <>
      <ModalBackdrop onClose={onClose}>
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
              {existing?.linkStatus === 'dead' && (
                <p className="mt-1 flex items-center gap-1 text-xs text-vt-danger">
                  <AlertTriangleIcon size={12} />
                  This link appears dead — update it above, or delete the bookmark.
                </p>
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
                list="bookmark-folder-options"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                placeholder="e.g. Reading list"
                className={inputCls}
              />
              {existingFolders.length > 0 && (
                <datalist id="bookmark-folder-options">
                  {existingFolders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              )}
            </div>

            {id && (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-2 text-xs text-vt-muted">
                  <input
                    type="checkbox"
                    checked={existing?.sensitive ?? false}
                    onChange={() => void handleToggleBookmarkSensitive()}
                    className="h-3.5 w-3.5 accent-vt-teal"
                  />
                  Sensitive — blur the thumbnail until clicked
                </label>
                {folder.trim() && (
                  <label className="flex items-center gap-2 text-xs text-vt-muted">
                    <input
                      type="checkbox"
                      checked={sensitiveFolders.includes(folder.trim())}
                      onChange={() => void handleToggleFolderSensitive()}
                      className="h-3.5 w-3.5 accent-vt-teal"
                    />
                    Mark every link in &quot;{folder.trim()}&quot; as sensitive
                  </label>
                )}
              </div>
            )}

            {id && (
              <div className="border-t border-vt-border pt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-medium text-vt-muted">Page preview</label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleFetchPreview()}
                      disabled={fetchingPreview || capturingPreview}
                      className="text-xs text-vt-teal hover:underline disabled:opacity-50"
                    >
                      {fetchingPreview
                        ? 'Fetching…'
                        : existing?.previewFetchedAt
                          ? 'Refresh preview'
                          : 'Fetch preview'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCaptureInteractive()}
                      disabled={fetchingPreview || capturingPreview}
                      title="Opens a real browser window so you can solve a CAPTCHA by hand, then captures the preview"
                      className="text-xs text-vt-muted hover:text-vt-teal hover:underline disabled:opacity-50"
                    >
                      {capturingPreview ? 'Opening…' : 'Blocked? Open browser'}
                    </button>
                  </div>
                </div>
                {existing?.previewTitle || existing?.previewDescription || existing?.previewImage ? (
                  <div className="flex gap-2 rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-xs">
                    {existing.previewImage && existing.sensitive && !revealPreviewImage ? (
                      <button
                        type="button"
                        onClick={() => setRevealPreviewImage(true)}
                        className="relative shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-vt-teal"
                        title="Sensitive — click to reveal"
                      >
                        <img
                          src={existing.previewImage}
                          alt=""
                          className="h-12 w-12 rounded-md border border-vt-border object-cover blur-md"
                        />
                      </button>
                    ) : (
                      existing.previewImage && (
                        <button
                          type="button"
                          onClick={() => setLightboxImage(existing.previewImage!)}
                          className="shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-vt-teal"
                          title="View full image"
                        >
                          <img
                            src={existing.previewImage}
                            alt=""
                            className="h-12 w-12 rounded-md border border-vt-border object-cover transition hover:brightness-110"
                          />
                        </button>
                      )
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
    </ModalBackdrop>
      {lightboxImage && <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />}
    </>
  )
}
