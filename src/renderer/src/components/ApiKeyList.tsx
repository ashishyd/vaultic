import { useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { ConfirmDialog } from './ConfirmDialog'
import { PageHeader } from './PageHeader'
import { IconButton } from './IconButton'
import type { ApiKeySummary } from '../../../preload/api-types'
import { EyeIcon, CopyIcon, TrashIcon, FolderIcon, PlusIcon, ChevronRightIcon } from './icons'

interface ApiKeyListProps {
  onEdit: (id: string) => void
  onAdd: () => void
  onScan: () => void
  onLeakScan: () => void
}

const GROUP_PAGE_SIZE = 25
const MANUAL_ENV_KEY = '__manual__'

/** Groups api keys by which .env file they came from, with a human label for each. */
function envFileLabel(envFile: string | undefined): string {
  if (!envFile) return 'Manually added'
  if (envFile === '.env') return 'Production (.env)'
  if (envFile.includes('local')) return `Local (${envFile})`
  return envFile
}

const DAY_MS = 86_400_000
const STALE_DAYS = 90
const EXPIRY_WARN_DAYS = 14

/** Why a key needs attention, or null. Expiry beats staleness. */
function attentionOf(k: ApiKeySummary): string | null {
  const now = Date.now()
  if (k.expiresAt !== undefined) {
    if (k.expiresAt < now) return 'Expired'
    if (k.expiresAt - now < EXPIRY_WARN_DAYS * DAY_MS) return 'Expires soon'
  }
  const lastTouched = k.lastUsedAt ?? k.createdAt
  return now - lastTouched > STALE_DAYS * DAY_MS ? 'Unused 90d+' : null
}

export function ApiKeyList({ onEdit, onAdd, onScan, onLeakScan }: ApiKeyListProps): JSX.Element {
  const { apiKeys, search, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map())
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<{ project: string; count: number } | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [collapsedSubgroups, setCollapsedSubgroups] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [attentionOnly, setAttentionOnly] = useState(false)

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = apiKeys.filter(
      (k) =>
        (!q || k.project.toLowerCase().includes(q) || k.name.toLowerCase().includes(q)) &&
        (!attentionOnly || attentionOf(k) !== null)
    )
    const groups = new Map<string, typeof filtered>()
    for (const key of filtered) {
      const list = groups.get(key.project) ?? []
      list.push(key)
      groups.set(key.project, list)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [apiKeys, search, attentionOnly])

  // Falls back to the first key so the detail pane is never empty while the list has items.
  const flat = useMemo(() => grouped.flatMap(([, keys]) => keys), [grouped])
  const sel = flat.find((k) => k.id === selectedId) ?? flat[0] ?? null

  async function toggleReveal(id: string): Promise<void> {
    if (revealed.has(id)) {
      setRevealed((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
      return
    }
    const value = await window.vaultAPI.revealApiKeyValue(id)
    if (value !== null) {
      setRevealed((prev) => new Map(prev).set(id, value))
    } else {
      push('Touch ID failed or was cancelled', 'error')
    }
  }

  async function handleCopy(id: string): Promise<void> {
    const ok = await window.vaultAPI.copyApiKeyValue(id)
    push(ok ? 'Copied to clipboard' : 'Touch ID failed or was cancelled', ok ? 'success' : 'error')
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return
    const { id, name } = pendingDelete
    await window.vaultAPI.deleteApiKey(id)
    await refresh()
    setPendingDelete(null)
    push(`Deleted "${name}"`, 'success', {
      durationMs: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          await window.vaultAPI.restoreApiKey(id)
          await refresh()
          push('Restored', 'success')
        }
      }
    })
  }

  async function handleConfirmDeleteFolder(): Promise<void> {
    if (!pendingDeleteFolder) return
    const { project } = pendingDeleteFolder
    const ids = await window.vaultAPI.deleteApiKeysByProject(project)
    await refresh()
    setPendingDeleteFolder(null)
    push(`Deleted "${project}" (${ids.length} key${ids.length === 1 ? '' : 's'})`, 'success', {
      durationMs: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          await window.vaultAPI.restoreApiKeys(ids)
          await refresh()
          push('Restored', 'success')
        }
      }
    })
  }

  function toggleExpanded(key: string): void {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleCollapsed(project: string): void {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(project)) next.delete(project)
      else next.add(project)
      return next
    })
  }

  function toggleSubgroupCollapsed(key: string): void {
    setCollapsedSubgroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectKey(id: string): void {
    if (id === sel?.id) return
    // A revealed value must not outlive leaving its key.
    setRevealed(new Map())
    setSelectedId(id)
  }

  function renderKeyRows(keys: ApiKeySummary[], paginationKey: string): JSX.Element {
    const expanded = expandedGroups.has(paginationKey)
    const visibleKeys = expanded ? keys : keys.slice(0, GROUP_PAGE_SIZE)
    const remaining = keys.length - visibleKeys.length

    return (
      <>
        {visibleKeys.map((key) => {
          const active = key.id === sel?.id
          return (
            <button
              key={key.id}
              onClick={() => selectKey(key.id)}
              aria-pressed={active}
              className={`flex w-full items-center gap-3 rounded-lg border-none px-2.5 py-2 text-left ${
                active ? 'bg-vt-surface2 ring-1 ring-inset ring-vt-border' : 'bg-transparent hover:bg-vt-surface2/60'
              }`}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{key.name}</span>
              {attentionOf(key) && (
                <span className="rounded-md border border-vt-danger px-1.5 text-[10px] text-vt-danger">{attentionOf(key)}</span>
              )}
              <span className="font-mono text-xs text-vt-muted">••••••</span>
            </button>
          )
        })}
        {remaining > 0 && (
          <button
            onClick={() => toggleExpanded(paginationKey)}
            className="mt-1 rounded-md px-2 py-1 text-xs text-vt-teal hover:bg-vt-surface2"
          >
            Show {remaining} more…
          </button>
        )}
      </>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="API Keys"
        searchPlaceholder="Search keys…"
        actions={
          <>
            <button
              onClick={() => setAttentionOnly((v) => !v)}
              aria-pressed={attentionOnly}
              className={`rounded-lg border px-3.5 py-2 text-sm hover:bg-vt-surface2 ${
                attentionOnly ? 'border-vt-teal text-vt-teal' : 'border-vt-border text-vt-text'
              }`}
            >
              Needs attention
            </button>
            <button
              onClick={onLeakScan}
              className="rounded-lg border border-vt-border bg-transparent px-3.5 py-2 text-sm text-vt-text hover:bg-vt-surface2"
            >
              Check for leaks…
            </button>
            <button
              onClick={onScan}
              className="rounded-lg border border-vt-border bg-transparent px-3.5 py-2 text-sm text-vt-text hover:bg-vt-surface2"
            >
              Scan a folder…
            </button>
            <button
              onClick={onAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-vt-teal px-3.5 py-2 text-sm font-medium text-vt-bg hover:brightness-110"
            >
              Add key
              <PlusIcon size={14} />
            </button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="w-[360px] shrink-0 overflow-y-auto border-r border-vt-border p-2">
          {apiKeys.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center text-vt-muted">
              <p className="text-sm">No API keys yet.</p>
              <p className="text-xs">Add one manually or scan a project folder.</p>
            </div>
          ) : grouped.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center text-vt-muted">
              <p className="text-sm">No keys match your search.</p>
            </div>
          ) : (
            grouped.map(([project, keys]) => {
              const collapsed = collapsedGroups.has(project)

              const subgroups = new Map<string, ApiKeySummary[]>()
              for (const key of keys) {
                const subKey = key.envFile ?? MANUAL_ENV_KEY
                const list = subgroups.get(subKey) ?? []
                list.push(key)
                subgroups.set(subKey, list)
              }
              const hasSubgroups = subgroups.size > 1

              return (
                <div key={project} className="mb-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleCollapsed(project)}
                      className="flex flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-vt-surface2"
                    >
                      <ChevronRightIcon
                        size={12}
                        className={`text-vt-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
                      />
                      <FolderIcon size={14} className="text-vt-muted" />
                      <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-vt-text">{project}</h3>
                      <span className="text-xs text-vt-muted">{keys.length}</span>
                    </button>
                    <IconButton
                      onClick={() => setPendingDeleteFolder({ project, count: keys.length })}
                      title="Delete folder"
                      tone="danger"
                    >
                      <TrashIcon size={14} />
                    </IconButton>
                  </div>
                  {!collapsed &&
                    (hasSubgroups ? (
                      [...subgroups.entries()].map(([subKey, subKeys]) => {
                        const compositeKey = `${project} ${subKey}`
                        const subCollapsed = collapsedSubgroups.has(compositeKey)
                        return (
                          <div key={subKey} className="mb-2 ml-3">
                            <button
                              onClick={() => toggleSubgroupCollapsed(compositeKey)}
                              className="mb-0.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-vt-surface2"
                            >
                              <ChevronRightIcon
                                size={11}
                                className={`text-vt-muted transition-transform ${subCollapsed ? '' : 'rotate-90'}`}
                              />
                              <span className="text-[11px] text-vt-muted">
                                {envFileLabel(subKey === MANUAL_ENV_KEY ? undefined : subKey)} · {subKeys.length}
                              </span>
                            </button>
                            {!subCollapsed && renderKeyRows(subKeys, compositeKey)}
                          </div>
                        )
                      })
                    ) : (
                      <div className="ml-3">{renderKeyRows(keys, project)}</div>
                    ))}
                </div>
              )
            })
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
          {!sel ? (
            <div className="flex h-full items-center justify-center text-sm text-vt-muted">Select a key to see its details.</div>
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex items-start gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-sm text-vt-muted">
                    {sel.project} › {envFileLabel(sel.envFile)}
                  </span>
                  <h2 className="break-all font-mono text-xl font-semibold">{sel.name}</h2>
                </div>
                <button
                  onClick={() => onEdit(sel.id)}
                  className="ml-auto shrink-0 rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
                >
                  Edit
                </button>
              </div>

              <div className="flex flex-col rounded-xl border border-vt-border bg-vt-surface">
                <div className="flex items-center gap-3 border-b border-vt-border px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-xs text-vt-muted">Value</span>
                    <span className="break-all font-mono text-xs">{revealed.get(sel.id) ?? '••••••••••••••••••••••••'}</span>
                  </div>
                  <IconButton onClick={() => toggleReveal(sel.id)} title={revealed.has(sel.id) ? 'Hide' : 'Show'}>
                    <EyeIcon size={14} />
                  </IconButton>
                  <IconButton onClick={() => handleCopy(sel.id)} title="Copy" tone="teal">
                    <CopyIcon size={14} />
                  </IconButton>
                </div>
                <div className="flex flex-col gap-1 border-b border-vt-border px-4 py-3">
                  <span className="text-xs text-vt-muted">Last used</span>
                  <span className="text-xs">{sel.lastUsedAt ? new Date(sel.lastUsedAt).toLocaleDateString() : 'Never'}</span>
                  {sel.expiresAt !== undefined && (
                    <span className={`text-xs ${attentionOf(sel) === 'Expired' ? 'text-vt-danger' : ''}`}>
                      Expires {new Date(sel.expiresAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1 px-4 py-3">
                  <span className="text-xs text-vt-muted">Imported from</span>
                  <span className="font-mono text-xs">
                    {sel.project}/{sel.envFile ?? 'added manually'}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs text-vt-muted">Notes</span>
                {sel.notes ? (
                  <p className="whitespace-pre-wrap text-sm">{sel.notes}</p>
                ) : (
                  <p className="text-sm text-vt-muted">No notes.</p>
                )}
              </div>

              <div className="flex items-center gap-3 border-t border-vt-border pt-4 text-xs text-vt-muted">
                <span>
                  Modified {new Date(sel.updatedAt).toLocaleDateString()} · Created {new Date(sel.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => setPendingDelete({ id: sel.id, name: sel.name })}
                  className="ml-auto text-sm text-vt-danger hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete API key"
          message={`Delete "${pendingDelete.name}"? You'll have a few seconds to undo.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingDeleteFolder && (
        <ConfirmDialog
          title="Delete folder"
          message={`Delete "${pendingDeleteFolder.project}" and its ${pendingDeleteFolder.count} key${pendingDeleteFolder.count === 1 ? '' : 's'}? You'll have a few seconds to undo.`}
          onConfirm={handleConfirmDeleteFolder}
          onCancel={() => setPendingDeleteFolder(null)}
        />
      )}
    </div>
  )
}
