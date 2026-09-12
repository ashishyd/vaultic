import { useEffect, useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { copyWithAutoClear } from '../lib/clipboard'
import { ConfirmDialog } from './ConfirmDialog'

interface LoginListProps {
  onAnalyze: () => void
  onEdit: (id: string) => void
}

const PAGE_SIZE = 50

export function LoginList({ onAnalyze, onEdit }: LoginListProps): JSX.Element {
  const { logins, search, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map())
  const [pendingDelete, setPendingDelete] = useState<{ id: string; service: string } | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const l of logins) if (l.category) set.add(l.category)
    return [...set].sort()
  }, [logins])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logins
      .filter((l) => !q || l.service.toLowerCase().includes(q) || l.username.toLowerCase().includes(q))
      .filter((l) => categoryFilter === 'all' || l.category === categoryFilter)
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
        return a.service.localeCompare(b.service)
      })
  }, [logins, search, categoryFilter])

  // Reset pagination whenever the effective filter/search changes so a new,
  // narrower result set isn't hidden behind a stale "Load more" cutoff.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [search, categoryFilter])

  const visible = filtered.slice(0, visibleCount)
  const remaining = filtered.length - visible.length

  async function toggleReveal(id: string): Promise<void> {
    if (revealed.has(id)) {
      setRevealed((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
      return
    }
    const password = await window.vaultAPI.revealLoginPassword(id)
    if (password !== null) {
      setRevealed((prev) => new Map(prev).set(id, password))
    } else {
      push('Touch ID failed or was cancelled', 'error')
    }
  }

  async function handleCopyPassword(id: string): Promise<void> {
    const ok = await window.vaultAPI.copyLoginPassword(id)
    push(ok ? 'Copied to clipboard' : 'Touch ID failed or was cancelled', ok ? 'success' : 'error')
  }

  function handleCopyUsername(username: string): void {
    copyWithAutoClear(username)
    push('Copied to clipboard', 'success')
  }

  async function handleToggleFavorite(id: string, favorite: boolean): Promise<void> {
    await window.vaultAPI.setLoginFavorite(id, !favorite)
    await refresh()
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return
    const { id, service } = pendingDelete
    await window.vaultAPI.deleteLogin(id)
    await refresh()
    setPendingDelete(null)
    push(`Deleted "${service}"`, 'success', {
      durationMs: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          await window.vaultAPI.restoreLogin(id)
          await refresh()
          push('Restored', 'success')
        }
      }
    })
  }

  function toggleSelected(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectMode(): void {
    setSelectMode((prev) => !prev)
    setSelected(new Set())
    setExportStatus(null)
  }

  async function handleExport(): Promise<void> {
    setExporting(true)
    setExportStatus(null)
    try {
      const result = await window.vaultAPI.exportLoginsCsv([...selected])
      if (result.success) {
        setExportStatus(`Saved to ${result.filePath}. Import it into Chrome at chrome://password-manager/passwords → ⋮ → Import, then delete the file.`)
        setSelected(new Set())
      } else {
        setExportStatus('Export cancelled or failed.')
      }
    } finally {
      setExporting(false)
    }
  }

  if (logins.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-vt-muted">
        <p className="text-sm">No logins saved yet.</p>
        <p className="text-xs">Add a site or account to get started.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={toggleSelectMode}
            className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-text"
          >
            {selectMode ? 'Cancel' : 'Select to export…'}
          </button>
          {!selectMode && (
            <button
              onClick={onAnalyze}
              className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-text"
            >
              Analyze passwords…
            </button>
          )}
          {!selectMode && categories.length > 0 && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border border-vt-border bg-vt-surface2 px-2 py-1 text-xs text-vt-text outline-none focus:border-vt-teal"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
        {selectMode && (
          <button
            onClick={handleExport}
            disabled={exporting || selected.size === 0}
            className="rounded-md bg-vt-teal px-3 py-1 text-xs font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : `Export ${selected.size} selected`}
          </button>
        )}
      </div>

      {exportStatus && <p className="text-xs text-vt-muted">{exportStatus}</p>}

      <div className="flex flex-col gap-2">
        {visible.map((login) => (
          <div
            key={login.id}
            className="flex items-center justify-between rounded-lg border border-vt-border bg-vt-surface px-4 py-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              {selectMode && (
                <input
                  type="checkbox"
                  checked={selected.has(login.id)}
                  onChange={() => toggleSelected(login.id)}
                />
              )}
              {!selectMode && (
                <button
                  onClick={() => handleToggleFavorite(login.id, login.favorite)}
                  className={`shrink-0 text-base ${login.favorite ? 'text-yellow-400' : 'text-vt-muted hover:text-vt-text'}`}
                  title={login.favorite ? 'Unfavorite' : 'Favorite'}
                >
                  {login.favorite ? '★' : '☆'}
                </button>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{login.service}</p>
                  {login.category && (
                    <span className="shrink-0 rounded-full bg-vt-surface2 px-2 py-0.5 text-[10px] text-vt-muted">
                      {login.category}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-vt-muted">{login.username}</p>
                {login.url && <p className="truncate text-[11px] text-vt-muted">{login.url}</p>}
                {revealed.has(login.id) && (
                  <p className="truncate font-mono text-xs text-vt-teal">{revealed.get(login.id)}</p>
                )}
              </div>
            </div>
            {!selectMode && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => handleCopyUsername(login.username)}
                  className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-text"
                >
                  Copy user
                </button>
                <button
                  onClick={() => handleCopyPassword(login.id)}
                  className="rounded-md px-2 py-1 text-xs text-vt-teal hover:bg-vt-surface2"
                >
                  Copy pass
                </button>
                <button
                  onClick={() => toggleReveal(login.id)}
                  className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-text"
                >
                  {revealed.has(login.id) ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={() => onEdit(login.id)}
                  className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-text"
                >
                  Edit
                </button>
                <button
                  onClick={() => setPendingDelete({ id: login.id, service: login.service })}
                  className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-danger"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}

        {remaining > 0 && (
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="self-start rounded-md px-2 py-1 text-xs text-vt-teal hover:bg-vt-surface2"
          >
            Load {Math.min(remaining, PAGE_SIZE)} more…
          </button>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete login"
          message={`Delete "${pendingDelete.service}"? You'll have a few seconds to undo.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
