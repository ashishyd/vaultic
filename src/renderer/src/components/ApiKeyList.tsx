import { useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { ConfirmDialog } from './ConfirmDialog'
import { PageHeader } from './PageHeader'
import { IconButton } from './IconButton'
import type { ApiKeySummary } from '../../../preload/api-types'
import { EyeIcon, CopyIcon, PencilIcon, TrashIcon, FolderIcon, PlusIcon, ChevronRightIcon } from './icons'

interface ApiKeyListProps {
  onEdit: (id: string) => void
  onAdd: () => void
  onScan: () => void
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

export function ApiKeyList({ onEdit, onAdd, onScan }: ApiKeyListProps): JSX.Element {
  const { apiKeys, search, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map())
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<{ project: string; count: number } | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [collapsedSubgroups, setCollapsedSubgroups] = useState<Set<string>>(new Set())

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = apiKeys.filter(
      (k) => !q || k.project.toLowerCase().includes(q) || k.name.toLowerCase().includes(q)
    )
    const groups = new Map<string, typeof filtered>()
    for (const key of filtered) {
      const list = groups.get(key.project) ?? []
      list.push(key)
      groups.set(key.project, list)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [apiKeys, search])

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

  function renderKeyTable(keys: ApiKeySummary[], paginationKey: string): JSX.Element {
    const expanded = expandedGroups.has(paginationKey)
    const visibleKeys = expanded ? keys : keys.slice(0, GROUP_PAGE_SIZE)
    const remaining = keys.length - visibleKeys.length

    return (
      <>
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              <th
                className="border-b border-vt-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-vt-muted"
                style={{ width: '32%' }}
              >
                Key name
              </th>
              <th className="border-b border-vt-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-vt-muted">
                Value
              </th>
              <th
                className="border-b border-vt-border px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-vt-muted"
                style={{ width: 150 }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleKeys.map((key) => (
              <tr key={key.id} className="group">
                <td className="truncate border-b border-vt-border/60 px-3 py-3 font-medium">{key.name}</td>
                <td className="truncate border-b border-vt-border/60 px-3 py-3 font-mono text-xs text-vt-muted">
                  {revealed.get(key.id) ?? '••••••••••••••••••••••••'}
                </td>
                <td className="border-b border-vt-border/60 px-3 py-3 text-right">
                  <div className="inline-flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <IconButton onClick={() => toggleReveal(key.id)} title={revealed.has(key.id) ? 'Hide' : 'Show'}>
                      <EyeIcon size={14} />
                    </IconButton>
                    <IconButton onClick={() => handleCopy(key.id)} title="Copy" tone="teal">
                      <CopyIcon size={14} />
                    </IconButton>
                    <IconButton onClick={() => onEdit(key.id)} title="Edit">
                      <PencilIcon size={14} />
                    </IconButton>
                    <IconButton onClick={() => setPendingDelete({ id: key.id, name: key.name })} title="Delete" tone="danger">
                      <TrashIcon size={14} />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {remaining > 0 && (
          <button
            onClick={() => toggleExpanded(paginationKey)}
            className="mt-2 rounded-md px-2 py-1 text-xs text-vt-teal hover:bg-vt-surface2"
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

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {apiKeys.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-vt-muted">
            <p className="text-sm">No API keys yet.</p>
            <p className="text-xs">Add one manually or scan a project folder.</p>
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
              <div key={project} className="mb-6">
                <div className="mb-2 flex items-center gap-1">
                  <button
                    onClick={() => toggleCollapsed(project)}
                    className="flex flex-1 items-baseline gap-2 rounded-md py-1 text-left hover:bg-vt-surface2"
                  >
                    <ChevronRightIcon
                      size={12}
                      className={`self-center text-vt-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
                    />
                    <FolderIcon size={14} className="text-vt-muted" />
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-vt-muted">{project}</h3>
                    <span className="text-xs text-vt-muted/70">{keys.length}</span>
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
                      const compositeKey = `${project} ${subKey}`
                      const subCollapsed = collapsedSubgroups.has(compositeKey)
                      return (
                        <div key={subKey} className="mb-4 ml-5">
                          <button
                            onClick={() => toggleSubgroupCollapsed(compositeKey)}
                            className="mb-1.5 flex items-center gap-1.5 rounded-md py-1 text-left hover:bg-vt-surface2"
                          >
                            <ChevronRightIcon
                              size={11}
                              className={`text-vt-muted transition-transform ${subCollapsed ? '' : 'rotate-90'}`}
                            />
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-vt-muted">
                              {envFileLabel(subKey === MANUAL_ENV_KEY ? undefined : subKey)}
                            </span>
                            <span className="text-[11px] text-vt-muted/70">{subKeys.length}</span>
                          </button>
                          {!subCollapsed && renderKeyTable(subKeys, compositeKey)}
                        </div>
                      )
                    })
                  ) : (
                    renderKeyTable(keys, project)
                  ))}
              </div>
            )
          })
        )}
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
