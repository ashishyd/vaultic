import { Fragment, useEffect, useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { copyWithAutoClear } from '../lib/clipboard'
import { hostnameOf } from '../lib/url'
import { ConfirmDialog } from './ConfirmDialog'
import { PageHeader } from './PageHeader'
import { IconButton } from './IconButton'
import { UserIcon, CopyIcon, EyeIcon, PencilIcon, TrashIcon, StarIcon, PlusIcon } from './icons'

interface LoginListProps {
  onEdit: (id: string) => void
  onManageLabels: () => void
  onAdd: () => void
  onImportLogins: () => void
}

const PAGE_SIZE = 50

type LoginTab = 'accounts' | 'files'

/** File/archive passwords are saved with no username (see the bulk "Name: password" format). */
function isFilePassword(username: string): boolean {
  return !username.trim()
}

/** Picks readable black/white text for an arbitrary label background color. */
function textColorFor(hexColor: string): string {
  const hex = hexColor.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? '#0B1220' : '#FFFFFF'
}

export function LoginList({ onEdit, onManageLabels, onAdd, onImportLogins }: LoginListProps): JSX.Element {
  const { logins, labels, search, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map())
  const [pendingDelete, setPendingDelete] = useState<{ id: string; service: string } | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exportStatus, setExportStatus] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [copyingFromChrome, setCopyingFromChrome] = useState(false)
  const [activeLabelFilters, setActiveLabelFilters] = useState<Set<string>>(new Set())
  const [editingLabelsFor, setEditingLabelsFor] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [activeTab, setActiveTab] = useState<LoginTab>('accounts')

  const labelsById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels])

  const filePasswordCount = useMemo(() => logins.filter((l) => isFilePassword(l.username)).length, [logins])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logins
      .filter((l) => isFilePassword(l.username) === (activeTab === 'files'))
      .filter((l) => !q || l.service.toLowerCase().includes(q) || l.username.toLowerCase().includes(q))
      .filter((l) => activeLabelFilters.size === 0 || l.labelIds.some((id) => activeLabelFilters.has(id)))
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
        return a.service.localeCompare(b.service)
      })
  }, [logins, search, activeLabelFilters, activeTab])

  // Reset pagination whenever the effective filter/search changes so a new,
  // narrower result set isn't hidden behind a stale "Load more" cutoff.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [search, activeLabelFilters, activeTab])

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

  async function handleCopyForChromeTab(): Promise<void> {
    setCopyingFromChrome(true)
    try {
      const url = await window.vaultAPI.getFrontmostChromeTabUrl()
      const host = hostnameOf(url ?? undefined)
      if (!host) {
        push("Couldn't read Chrome's active tab — is Chrome open?", 'error')
        return
      }
      const match = logins.find((l) => hostnameOf(l.url) === host)
      if (!match) {
        push(`No saved login matches ${host}`, 'info')
        return
      }
      const ok = await window.vaultAPI.copyLoginPassword(match.id)
      push(
        ok ? `Copied password for "${match.service}"` : 'Touch ID failed or was cancelled',
        ok ? 'success' : 'error'
      )
    } finally {
      setCopyingFromChrome(false)
    }
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

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Logins"
        searchPlaceholder="Search logins…"
        actions={
          <>
            <button
              onClick={handleCopyForChromeTab}
              disabled={copyingFromChrome}
              className="rounded-lg border border-vt-border bg-transparent px-3.5 py-2 text-sm text-vt-text hover:bg-vt-surface2 disabled:opacity-50"
            >
              {copyingFromChrome ? 'Checking Chrome…' : 'Copy for current tab'}
            </button>
            <button
              onClick={onImportLogins}
              className="rounded-lg border border-vt-border bg-transparent px-3.5 py-2 text-sm text-vt-text hover:bg-vt-surface2"
            >
              Import from Chrome…
            </button>
            <button
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-vt-teal px-3.5 py-2 text-sm font-medium text-vt-bg hover:brightness-110"
            >
              Add login
              <PlusIcon size={14} />
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-7 py-6">
        <div className="mb-4 flex gap-1 rounded-lg bg-vt-surface2 p-1 text-xs" style={{ width: 'fit-content' }}>
          <button
            onClick={() => setActiveTab('accounts')}
            className={`rounded-md px-3 py-1.5 ${activeTab === 'accounts' ? 'bg-vt-teal text-vt-bg' : 'text-vt-muted'}`}
          >
            Logins
          </button>
          <button
            onClick={() => setActiveTab('files')}
            className={`rounded-md px-3 py-1.5 ${activeTab === 'files' ? 'bg-vt-teal text-vt-bg' : 'text-vt-muted'}`}
          >
            File Passwords{filePasswordCount > 0 ? ` (${filePasswordCount})` : ''}
          </button>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
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
          <button onClick={onManageLabels} className="rounded-lg px-2.5 py-1.5 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-text">
            Manage labels…
          </button>
          <button
            onClick={toggleSelectMode}
            className="ml-auto rounded-lg px-2.5 py-1.5 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-text"
          >
            {selectMode ? 'Cancel' : 'Select to export…'}
          </button>
          {selectMode && (
            <button
              onClick={handleExport}
              disabled={exporting || selected.size === 0}
              className="rounded-lg bg-vt-teal px-3 py-1.5 text-xs font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : `Export ${selected.size} selected`}
            </button>
          )}
        </div>

        {exportStatus && <p className="mb-3 text-xs text-vt-muted">{exportStatus}</p>}

        {logins.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-vt-muted">
            <p className="text-sm">No logins saved yet.</p>
            <p className="text-xs">Add a site or account to get started.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-vt-muted">
            {activeTab === 'files' ? (
              <>
                <p className="text-sm">No file passwords yet.</p>
                <p className="text-xs">
                  Add one with the "Name: password" bulk-paste format (no username) to see it here.
                </p>
              </>
            ) : (
              <p className="text-sm">No logins match your filters.</p>
            )}
          </div>
        ) : (
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className="border-b border-vt-border" style={{ width: 28 }}></th>
                <th className="border-b border-vt-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-vt-muted" style={{ width: '22%' }}>
                  Service
                </th>
                {activeTab === 'accounts' && (
                  <th className="border-b border-vt-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-vt-muted" style={{ width: '20%' }}>
                    Username
                  </th>
                )}
                <th className="border-b border-vt-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-vt-muted">
                  Password
                </th>
                <th className="border-b border-vt-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-vt-muted">
                  Labels
                </th>
                <th className="border-b border-vt-border px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-vt-muted" style={{ width: 150 }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((login) => (
                <Fragment key={login.id}>
                  <tr className="group">
                    <td className="border-b border-vt-border/60 py-3 pl-3">
                      {selectMode ? (
                        <input type="checkbox" checked={selected.has(login.id)} onChange={() => toggleSelected(login.id)} />
                      ) : (
                        <button onClick={() => handleToggleFavorite(login.id, login.favorite)} title={login.favorite ? 'Unfavorite' : 'Favorite'}>
                          <StarIcon size={14} filled={login.favorite} />
                        </button>
                      )}
                    </td>
                    <td className="truncate border-b border-vt-border/60 px-3 py-3 font-medium">{login.service}</td>
                    {activeTab === 'accounts' && (
                      <td className="truncate border-b border-vt-border/60 px-3 py-3 text-xs text-vt-muted">{login.username}</td>
                    )}
                    <td className="border-b border-vt-border/60 px-3 py-3">
                      <span className="font-mono text-xs text-vt-muted">
                        {revealed.get(login.id) ?? '••••••••••••'}
                      </span>
                    </td>
                    <td className="border-b border-vt-border/60 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1">
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
                        {!selectMode && (
                          <button
                            onClick={() => setEditingLabelsFor(editingLabelsFor === login.id ? null : login.id)}
                            className="rounded-full border border-vt-border px-2 py-0.5 text-[10px] text-vt-muted hover:bg-vt-surface2"
                          >
                            + Label
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="border-b border-vt-border/60 px-3 py-3 text-right">
                      {!selectMode && (
                        <div className="inline-flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          {activeTab === 'accounts' && (
                            <IconButton onClick={() => handleCopyUsername(login.username)} title="Copy username">
                              <UserIcon size={14} />
                            </IconButton>
                          )}
                          <IconButton onClick={() => handleCopyPassword(login.id)} title="Copy password" tone="teal">
                            <CopyIcon size={14} />
                          </IconButton>
                          <IconButton onClick={() => toggleReveal(login.id)} title={revealed.has(login.id) ? 'Hide' : 'Show'}>
                            <EyeIcon size={14} />
                          </IconButton>
                          <IconButton onClick={() => onEdit(login.id)} title="Edit">
                            <PencilIcon size={14} />
                          </IconButton>
                          <IconButton onClick={() => setPendingDelete({ id: login.id, service: login.service })} title="Delete" tone="danger">
                            <TrashIcon size={14} />
                          </IconButton>
                        </div>
                      )}
                    </td>
                  </tr>
                  {editingLabelsFor === login.id && (
                    <tr>
                      <td colSpan={activeTab === 'accounts' ? 6 : 5} className="border-b border-vt-border/60 bg-vt-surface2/40 px-3 py-2">
                        <div className="flex flex-wrap gap-1.5">
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
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}

        {remaining > 0 && (
          <button
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
            className="mt-2 rounded-md px-2 py-1 text-xs text-vt-teal hover:bg-vt-surface2"
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
