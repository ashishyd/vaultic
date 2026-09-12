import { useEffect, useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { copyWithAutoClear } from '../lib/clipboard'
import { ConfirmDialog } from './ConfirmDialog'

interface LoginListProps {
  onAnalyze: () => void
  onEdit: (id: string) => void
  onManageLabels: () => void
}

const PAGE_SIZE = 50

/** Picks readable black/white text for an arbitrary label background color. */
function textColorFor(hexColor: string): string {
  const hex = hexColor.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#0B1220' : '#FFFFFF'
}

export function LoginList({ onAnalyze, onEdit, onManageLabels }: LoginListProps): JSX.Element {
  const { logins, labels, search, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map())
  const [pendingDelete, setPendingDelete] = useState<{ id: string; service: string } | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [activeLabelFilters, setActiveLabelFilters] = useState<Set<string>>(new Set())
  const [editingLabelsFor, setEditingLabelsFor] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const labelsById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logins
      .filter((l) => !q || l.service.toLowerCase().includes(q) || l.username.toLowerCase().includes(q))
      .filter((l) => activeLabelFilters.size === 0 || l.labelIds.some((id) => activeLabelFilters.has(id)))
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
        return a.service.localeCompare(b.service)
      })
  }, [logins, search, activeLabelFilters])

  // Reset pagination whenever the effective filter/search changes so a new,
  // narrower result set isn't hidden behind a stale "Load more" cutoff.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [search, activeLabelFilters])

  const visible = filtered.slice(0, visibleCount)
  const remaining = filtered.length - visible.length

  function toggleLabelFilter(labelId: string): void {
    setActiveLabelFilters((prev) => {
      const next = new Set(prev)
      if (next.has(labelId)) next.delete(labelId)
      else next.add(labelId)
      return next
    })
  }

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

  async function handleToggleLoginLabel(loginId: string, labelId: string): Promise<void> {
    await window.vaultAPI.toggleLoginLabel(loginId, labelId)
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
          {!selectMode && (
            <button
              onClick={onManageLabels}
              className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-text"
            >
              Manage labels…
            </button>
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

      {!selectMode && labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {labels.map((label) => {
            const active = activeLabelFilters.has(label.id)
            return (
              <button
                key={label.id}
                onClick={() => toggleLabelFilter(label.id)}
                style={
                  active
                    ? { backgroundColor: label.color, color: textColorFor(label.color) }
                    : { borderColor: label.color, color: label.color }
                }
                className={`rounded-full px-2.5 py-1 text-xs ${active ? '' : 'border bg-transparent'}`}
              >
                {label.name}
              </button>
            )
          })}
        </div>
      )}

      {exportStatus && <p className="text-xs text-vt-muted">{exportStatus}</p>}

      <div className="flex flex-col gap-2">
        {visible.map((login) => (
          <div
            key={login.id}
            className="rounded-lg border border-vt-border bg-vt-surface px-4 py-3"
          >
            <div className="flex items-center justify-between">
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
                  <p className="truncate text-sm font-medium">{login.service}</p>
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

            {!selectMode && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {login.labelIds.map((id) => {
                  const label = labelsById.get(id)
                  if (!label) return null
                  return (
                    <span
                      key={id}
                      style={{ backgroundColor: label.color, color: textColorFor(label.color) }}
                      className="rounded-full px-2 py-0.5 text-[10px]"
                    >
                      {label.name}
                    </span>
                  )
                })}
                <button
                  onClick={() => setEditingLabelsFor(editingLabelsFor === login.id ? null : login.id)}
                  className="rounded-full border border-vt-border px-2 py-0.5 text-[10px] text-vt-muted hover:bg-vt-surface2"
                >
                  + Label
                </button>
              </div>
            )}

            {editingLabelsFor === login.id && (
              <div className="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-vt-border p-2">
                {labels.length === 0 ? (
                  <p className="text-[11px] text-vt-muted">
                    No labels yet —{' '}
                    <button onClick={onManageLabels} className="underline hover:text-vt-text">
                      create one
                    </button>
                    .
                  </p>
                ) : (
                  labels.map((label) => {
                    const assigned = login.labelIds.includes(label.id)
                    return (
                      <button
                        key={label.id}
                        onClick={() => handleToggleLoginLabel(login.id, label.id)}
                        style={
                          assigned
                            ? { backgroundColor: label.color, color: textColorFor(label.color) }
                            : { borderColor: label.color, color: label.color }
                        }
                        className={`rounded-full px-2.5 py-1 text-xs ${assigned ? '' : 'border bg-transparent'}`}
                      >
                        {label.name}
                      </button>
                    )
                  })
                )}
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
