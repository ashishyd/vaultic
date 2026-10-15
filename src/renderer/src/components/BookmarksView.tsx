import { useEffect, useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { ConfirmDialog } from './ConfirmDialog'
import { ImageLightbox } from './ImageLightbox'
import { PageHeader } from './PageHeader'
import { IconButton } from './IconButton'
import {
  CopyIcon,
  PencilIcon,
  TrashIcon,
  PlusIcon,
  ExternalLinkIcon,
  GlassesIcon,
  RefreshIcon,
  EyeIcon,
  AlertTriangleIcon
} from './icons'

function formatLastVisited(ts: number): string {
  const diffMs = Date.now() - ts
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

interface BookmarksViewProps {
  onEdit: (id: string) => void
  onAdd: () => void
  onImport: () => void
}

export function BookmarksView({ onEdit, onAdd, onImport }: BookmarksViewProps): JSX.Element {
  const { bookmarks, search, refresh, bookmarkPreviewBackfillTriggered, setBookmarkPreviewBackfillTriggered } =
    useVaultStore()
  const push = useToastStore((s) => s.push)
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [refetching, setRefetching] = useState(false)
  const [checkingDead, setCheckingDead] = useState(false)
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set())
  const [showDeadOnly, setShowDeadOnly] = useState(false)

  useEffect(() => {
    if (bookmarkPreviewBackfillTriggered || bookmarks.length === 0) return
    if (!bookmarks.some((b) => !b.previewFetchedAt)) return
    setBookmarkPreviewBackfillTriggered(true)
    void window.vaultAPI.fetchMissingBookmarkPreviews().then((result) => {
      if (result.success && result.queued) {
        push(`Fetching previews for ${result.queued} bookmark${result.queued === 1 ? '' : 's'}…`, 'info')
      }
    })
  }, [bookmarks, bookmarkPreviewBackfillTriggered, setBookmarkPreviewBackfillTriggered, push])

  const deadCount = useMemo(() => bookmarks.filter((b) => b.linkStatus === 'dead').length, [bookmarks])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return bookmarks
      .filter(
        (b) =>
          (!showDeadOnly || b.linkStatus === 'dead') &&
          (!q ||
            b.title.toLowerCase().includes(q) ||
            b.host.toLowerCase().includes(q) ||
            (b.folder ?? '').toLowerCase().includes(q))
      )
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [bookmarks, search, showDeadOnly])

  async function handleOpen(id: string): Promise<void> {
    const ok = await window.vaultAPI.openBookmark(id)
    if (!ok) push('Touch ID failed or was cancelled', 'error')
    else await refresh()
  }

  async function handleOpenIncognito(id: string): Promise<void> {
    const { ok, reason } = await window.vaultAPI.openBookmarkIncognito(id)
    if (ok) {
      await refresh()
      return
    }
    push(
      reason === 'no-browser'
        ? 'No private-browsing capable browser found (Chrome, Brave, Edge or Firefox)'
        : 'Touch ID failed or was cancelled',
      'error'
    )
  }

  async function handleCopy(id: string): Promise<void> {
    const ok = await window.vaultAPI.copyBookmarkUrl(id)
    push(ok ? 'Link copied' : 'Touch ID failed or was cancelled', ok ? 'success' : 'error')
  }

  async function handleRefetchAll(): Promise<void> {
    setRefetching(true)
    try {
      const result = await window.vaultAPI.refetchAllBookmarkPreviews()
      if (result.success) {
        push(
          result.queued
            ? `Refetching previews for ${result.queued} bookmark${result.queued === 1 ? '' : 's'}…`
            : 'Every bookmark already has a preview',
          'info'
        )
      } else {
        push(result.error ?? 'Touch ID failed or was cancelled', 'error')
      }
    } finally {
      setRefetching(false)
    }
  }

  async function handleCheckDeadLinks(): Promise<void> {
    setCheckingDead(true)
    try {
      const result = await window.vaultAPI.checkDeadLinks()
      if (result.success) {
        push(
          result.queued
            ? `Checking ${result.queued} bookmark${result.queued === 1 ? '' : 's'} for dead links…`
            : 'No bookmarks to check',
          'info'
        )
      } else {
        push(result.error ?? 'Touch ID failed or was cancelled', 'error')
      }
    } finally {
      setCheckingDead(false)
    }
  }

  function revealThumbnail(id: string): void {
    setRevealedIds((prev) => new Set(prev).add(id))
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return
    const { id, title } = pendingDelete
    await window.vaultAPI.deleteBookmark(id)
    await refresh()
    setPendingDelete(null)
    push(`Deleted "${title}"`, 'success', {
      durationMs: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          await window.vaultAPI.restoreBookmark(id)
          await refresh()
          push('Restored', 'success')
        }
      }
    })
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Bookmarks"
        searchPlaceholder="Search bookmarks…"
        actions={
          <>
            <IconButton onClick={() => void handleRefetchAll()} title="Refetch all missing previews">
              <RefreshIcon size={16} className={refetching ? 'animate-spin' : undefined} />
            </IconButton>
            <IconButton onClick={() => void handleCheckDeadLinks()} title="Check all bookmarks for dead links">
              <AlertTriangleIcon size={16} className={checkingDead ? 'animate-pulse' : undefined} />
            </IconButton>
            {deadCount > 0 && (
              <button
                onClick={() => setShowDeadOnly((v) => !v)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                  showDeadOnly
                    ? 'border-vt-danger bg-vt-danger/10 text-vt-danger'
                    : 'border-vt-border text-vt-danger hover:bg-vt-surface2'
                }`}
              >
                {showDeadOnly ? 'Showing dead links' : `${deadCount} dead link${deadCount === 1 ? '' : 's'}`}
              </button>
            )}
            <button
              onClick={onImport}
              className="rounded-lg border border-vt-border px-3.5 py-2 text-sm hover:bg-vt-surface2"
            >
              Import from Chrome
            </button>
            <button
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-vt-teal px-3.5 py-2 text-sm font-medium text-vt-bg hover:brightness-110"
            >
              Add link
              <PlusIcon size={14} />
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {bookmarks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-vt-muted">
            <p className="text-sm">No private bookmarks yet.</p>
            <p className="text-xs">Add a link manually, or pick some from Chrome.</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-vt-muted">No bookmarks match your search.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((b) => (
              <div
                key={b.id}
                className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                  b.linkStatus === 'dead' ? 'border-vt-danger/50 bg-vt-danger/5' : 'border-vt-border'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  {b.previewImage && b.sensitive && !revealedIds.has(b.id) ? (
                    <button
                      type="button"
                      onClick={() => revealThumbnail(b.id)}
                      className="relative shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-vt-teal"
                      title="Sensitive — click to reveal"
                    >
                      <img
                        src={b.previewImage}
                        alt=""
                        className="h-10 w-10 rounded-lg border border-vt-border object-cover blur-md"
                      />
                      <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/20">
                        <EyeIcon size={14} className="text-white" />
                      </span>
                    </button>
                  ) : b.previewImage ? (
                    <button
                      type="button"
                      onClick={() => setLightboxImage(b.previewImage!)}
                      className="shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-vt-teal"
                      title="View full image"
                    >
                      <img
                        src={b.previewImage}
                        alt=""
                        className="h-10 w-10 rounded-lg border border-vt-border object-cover transition hover:brightness-110"
                      />
                    </button>
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-vt-border bg-vt-surface2 text-xs font-medium text-vt-muted">
                      {b.host.replace(/^www\./, '').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{b.title}</p>
                    <p className="truncate text-xs text-vt-muted">
                      {b.host}
                      {b.folder && <span className="text-vt-muted/70"> · {b.folder}</span>}
                    </p>
                    {b.previewDescription && (
                      <p className="mt-0.5 truncate text-xs text-vt-muted/70" title={b.previewDescription}>
                        {b.previewDescription}
                      </p>
                    )}
                    {b.linkStatus === 'dead' ? (
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-vt-danger">
                        <AlertTriangleIcon size={11} />
                        Link appears dead — edit or delete
                      </p>
                    ) : (
                      <p className="mt-0.5 text-[11px] text-vt-muted/60">
                        {b.visitCount > 0 && b.lastVisitedAt
                          ? `Visited ${b.visitCount}× · last ${formatLastVisited(b.lastVisitedAt)}`
                          : 'Not visited yet'}
                      </p>
                    )}
                  </div>
                </div>
                <div className="inline-flex shrink-0 gap-0.5">
                  <IconButton onClick={() => handleOpen(b.id)} title="Open (Touch ID)" tone="teal">
                    <ExternalLinkIcon size={14} />
                  </IconButton>
                  <IconButton onClick={() => handleOpenIncognito(b.id)} title="Open in incognito/private window (Touch ID)">
                    <GlassesIcon size={14} />
                  </IconButton>
                  <IconButton onClick={() => handleCopy(b.id)} title="Copy link">
                    <CopyIcon size={14} />
                  </IconButton>
                  <IconButton onClick={() => onEdit(b.id)} title="Edit">
                    <PencilIcon size={14} />
                  </IconButton>
                  <IconButton
                    onClick={() => setPendingDelete({ id: b.id, title: b.title })}
                    title="Delete"
                    tone="danger"
                  >
                    <TrashIcon size={14} />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete bookmark"
          message={`Delete "${pendingDelete.title}"? You'll have a few seconds to undo.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {lightboxImage && <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />}
    </div>
  )
}
