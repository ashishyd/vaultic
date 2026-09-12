import { useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { ConfirmDialog } from './ConfirmDialog'

interface ApiKeyListProps {
  onEdit: (id: string) => void
}

const GROUP_PAGE_SIZE = 25

export function ApiKeyList({ onEdit }: ApiKeyListProps): JSX.Element {
  const { apiKeys, search, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map())
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = apiKeys.filter(
      (k) =>
        !q ||
        k.project.toLowerCase().includes(q) ||
        k.name.toLowerCase().includes(q)
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

  function toggleExpanded(project: string): void {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(project)) next.delete(project)
      else next.add(project)
      return next
    })
  }

  if (apiKeys.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-vt-muted">
        <p className="text-sm">No API keys yet.</p>
        <p className="text-xs">Add one manually or scan a project folder.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {grouped.map(([project, keys]) => {
        const expanded = expandedGroups.has(project)
        const visibleKeys = expanded ? keys : keys.slice(0, GROUP_PAGE_SIZE)
        const remaining = keys.length - visibleKeys.length

        return (
          <div key={project}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-vt-muted">
              {project} <span className="normal-case text-vt-muted/70">({keys.length})</span>
            </h3>
            <div className="flex flex-col gap-2">
              {visibleKeys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between rounded-lg border border-vt-border bg-vt-surface px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{key.name}</p>
                    <p className="truncate font-mono text-xs text-vt-muted">
                      {revealed.get(key.id) ?? '•'.repeat(24)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => toggleReveal(key.id)}
                      className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-text"
                    >
                      {revealed.has(key.id) ? 'Hide' : 'Show'}
                    </button>
                    <button
                      onClick={() => handleCopy(key.id)}
                      className="rounded-md px-2 py-1 text-xs text-vt-teal hover:bg-vt-surface2"
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => onEdit(key.id)}
                      className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-text"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setPendingDelete({ id: key.id, name: key.name })}
                      className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-danger"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
              {remaining > 0 && (
                <button
                  onClick={() => toggleExpanded(project)}
                  className="self-start rounded-md px-2 py-1 text-xs text-vt-teal hover:bg-vt-surface2"
                >
                  Show {remaining} more…
                </button>
              )}
            </div>
          </div>
        )
      })}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete API key"
          message={`Delete "${pendingDelete.name}"? You'll have a few seconds to undo.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
