import { useCallback, useEffect, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { PageHeader } from './PageHeader'
import { ConfirmDialog } from './ConfirmDialog'
import type { TrashItem } from '../../../preload/api-types'

function daysLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
}

/** Buckets by how long ago the item was deleted; input order (newest first from main) is kept. */
function groupByDay(items: TrashItem[]): Array<{ label: string; items: TrashItem[] }> {
  const dayMs = 24 * 60 * 60 * 1000
  const groups = new Map<string, TrashItem[]>()
  for (const item of [...items].sort((a, b) => b.deletedAt - a.deletedAt)) {
    const age = Math.floor((Date.now() - item.deletedAt) / dayMs)
    const label = age < 1 ? 'Today' : age < 7 ? 'This week' : age < 14 ? 'Last week' : 'Last month'
    groups.set(label, [...(groups.get(label) ?? []), item])
  }
  return [...groups].map(([label, list]) => ({ label, items: list }))
}

function kindLabel(kind: TrashItem['kind']): string {
  switch (kind) {
    case 'key':
      return 'API key'
    case 'login':
      return 'Login'
    case 'recovery':
      return 'Recovery'
    case 'note':
      return 'Note'
    case 'bookmark':
      return 'Bookmark'
  }
}

export function TrashView(): JSX.Element {
  const refresh = useVaultStore((s) => s.refresh)
  const push = useToastStore((s) => s.push)
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [confirmRestoreAll, setConfirmRestoreAll] = useState(false)
  const [pendingPermanent, setPendingPermanent] = useState<TrashItem | null>(null)
  const [kindFilter, setKindFilter] = useState<TrashItem['kind'] | 'all'>('all')

  const kindCounts = items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] ?? 0) + 1 }), {})
  // Falls back to All when the last item of the chosen kind was restored or deleted.
  const activeKind = kindFilter !== 'all' && kindCounts[kindFilter] ? kindFilter : 'all'
  const visible = activeKind === 'all' ? items : items.filter((i) => i.kind === activeKind)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setItems(await window.vaultAPI.listTrash())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleRestore(item: TrashItem): Promise<void> {
    await window.vaultAPI.restoreTrashItem(item.kind, item.id)
    await refresh()
    await load()
    push(`Restored “${item.title}”`, 'success', {
      durationMs: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          await softDelete(item)
          await refresh()
          await load()
        }
      }
    })
  }

  async function softDelete(item: TrashItem): Promise<void> {
    const api = window.vaultAPI
    switch (item.kind) {
      case 'key':
        return api.deleteApiKey(item.id)
      case 'login':
        return api.deleteLogin(item.id)
      case 'recovery':
        return api.deleteRecoveryCode(item.id)
      case 'note':
        return api.deleteSecureNote(item.id)
      case 'bookmark':
        return api.deleteBookmark(item.id)
    }
  }

  async function handleRestoreAll(): Promise<void> {
    setConfirmRestoreAll(false)
    // Honours the kind filter so "Restore all" restores what the user is looking at.
    const all = visible
    let restored = 0
    try {
      for (const item of all) {
        await window.vaultAPI.restoreTrashItem(item.kind, item.id)
        restored += 1
      }
      push(`Restored ${restored} item${restored === 1 ? '' : 's'}`, 'success')
    } catch {
      push(`Restored ${restored} of ${all.length} items before an error`, 'error')
    } finally {
      await refresh()
      await load()
    }
  }

  async function handlePermanent(): Promise<void> {
    if (!pendingPermanent) return
    const item = pendingPermanent
    setPendingPermanent(null)
    const ok = await window.vaultAPI.permanentlyDeleteTrashItem(item.kind, item.id)
    if (!ok) {
      push('Authentication cancelled', 'error')
      return
    }
    await refresh()
    await load()
    push(`Permanently deleted "${item.title}"`, 'success')
  }

  async function handleEmpty(): Promise<void> {
    setConfirmEmpty(false)
    const removed = await window.vaultAPI.emptyTrash()
    if (removed < 0) {
      push('Authentication cancelled', 'error')
      return
    }
    await refresh()
    await load()
    push(removed === 0 ? 'Trash was already empty' : `Permanently deleted ${removed} item${removed === 1 ? '' : 's'}`, 'success')
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Recently Deleted"
        actions={
          items.length > 0 ? (
            <div className="flex gap-2">
              <button
                onClick={() => (items.length > 10 ? setConfirmRestoreAll(true) : void handleRestoreAll())}
                className="rounded-lg border border-vt-border px-3.5 py-2 text-sm text-vt-muted hover:bg-vt-surface2"
              >
                Restore all
              </button>
              <button
                onClick={() => setConfirmEmpty(true)}
                className="rounded-lg border border-vt-danger/40 px-3.5 py-2 text-sm text-vt-danger hover:bg-vt-danger/10"
              >
                Empty now…
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto px-7 py-6">
        <p className="mb-4 text-xs text-vt-muted">
          Soft-deleted items stay encrypted in your vault for 30 days, then are purged automatically on unlock.
        </p>

        {loading ? (
          <p className="text-xs text-vt-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-vt-muted">Trash is empty.</p>
        ) : (
          <>
            <div role="tablist" aria-label="Kinds" className="mb-4 flex flex-wrap gap-1.5">
              {(['all', ...Object.keys(kindCounts)] as Array<TrashItem['kind'] | 'all'>).map((k) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={activeKind === k}
                  onClick={() => setKindFilter(k)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    activeKind === k ? 'bg-vt-text font-medium text-vt-bg' : 'border border-vt-border text-vt-muted hover:bg-vt-surface2'
                  }`}
                >
                  {k === 'all' ? `All · ${items.length}` : `${kindLabel(k)} · ${kindCounts[k]}`}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-5">
              {groupByDay(visible).map((group) => (
                <section key={group.label} className="flex flex-col gap-2">
                  <h2 className="text-xs font-medium text-vt-muted">{group.label}</h2>
                  {group.items.map((item) => {
                    const left = daysLeft(item.expiresAt)
                    return (
                      <div
                        key={`${item.kind}-${item.id}`}
                        className="flex items-center gap-4 rounded-xl border border-vt-border bg-vt-surface px-4 py-3"
                      >
                        <span className="w-20 shrink-0 rounded-full border border-vt-border px-2 py-0.5 text-center text-[11px] text-vt-muted">
                          {kindLabel(item.kind)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{item.title}</p>
                          <p className="truncate text-xs text-vt-muted">{item.subtitle}</p>
                        </div>
                        <div className="flex w-32 shrink-0 flex-col gap-1">
                          <span className={`text-[11px] ${left <= 3 ? 'text-vt-danger' : 'text-vt-muted'}`}>
                            {left} day{left === 1 ? '' : 's'} left
                          </span>
                          <span className="h-1 overflow-hidden rounded-full bg-vt-surface2">
                            <span
                              className={`block h-1 rounded-full ${left <= 3 ? 'bg-vt-danger' : 'bg-vt-teal'}`}
                              style={{ width: `${Math.min(100, Math.round((left / 30) * 100))}%` }}
                            />
                          </span>
                        </div>
                        <button
                          onClick={() => void handleRestore(item)}
                          className="rounded-lg border border-vt-border px-3 py-1.5 text-xs hover:bg-vt-surface2"
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => setPendingPermanent(item)}
                          className="rounded-lg px-2.5 py-1.5 text-xs text-vt-danger hover:bg-vt-surface2"
                        >
                          Delete forever
                        </button>
                      </div>
                    )
                  })}
                </section>
              ))}
            </div>
          </>
        )}
      </div>

      {confirmEmpty && (
        <ConfirmDialog
          title="Empty trash?"
          message="Permanently delete every item in Recently Deleted? This cannot be undone."
          confirmLabel="Empty Trash"
          onConfirm={() => void handleEmpty()}
          onCancel={() => setConfirmEmpty(false)}
        />
      )}
      {confirmRestoreAll && (
        <ConfirmDialog
          title="Restore all?"
          message={`Restore all ${items.length} items from Recently Deleted?`}
          confirmLabel="Restore all"
          tone="neutral"
          onConfirm={() => void handleRestoreAll()}
          onCancel={() => setConfirmRestoreAll(false)}
        />
      )}
      {pendingPermanent && (
        <ConfirmDialog
          title="Delete forever?"
          message={`Permanently delete "${pendingPermanent.title}"? This cannot be undone.`}
          confirmLabel="Delete forever"
          onConfirm={() => void handlePermanent()}
          onCancel={() => setPendingPermanent(null)}
        />
      )}
    </div>
  )
}
