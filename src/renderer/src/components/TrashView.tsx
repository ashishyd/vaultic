import { useCallback, useEffect, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { PageHeader } from './PageHeader'
import { ConfirmDialog } from './ConfirmDialog'
import type { TrashItem } from '../../../preload/api-types'

function daysLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
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
    push(`Restored "${item.title}"`, 'success')
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
    await load()
    push(removed === 0 ? 'Trash was already empty' : `Permanently deleted ${removed} item${removed === 1 ? '' : 's'}`, 'success')
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Recently Deleted"
        actions={
          items.length > 0 ? (
            <button
              onClick={() => setConfirmEmpty(true)}
              className="rounded-lg border border-vt-danger/40 px-3.5 py-2 text-sm text-vt-danger hover:bg-vt-danger/10"
            >
              Empty Trash
            </button>
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

            <div className="flex flex-col overflow-hidden rounded-xl border border-vt-border">
              {visible.map((item) => {
                const left = daysLeft(item.expiresAt)
                return (
                  <div
                    key={`${item.kind}-${item.id}`}
                    className="flex items-center gap-4 border-b border-vt-border bg-vt-surface px-4 py-3 last:border-b-0"
                  >
                    <span className="w-20 shrink-0 text-[11px] uppercase tracking-wider text-vt-muted">{kindLabel(item.kind)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="truncate text-xs text-vt-muted">{item.subtitle}</p>
                    </div>
                    <span className={`w-24 shrink-0 text-right text-xs ${left <= 3 ? 'text-vt-danger' : 'text-vt-muted'}`}>
                      {left} day{left === 1 ? '' : 's'} left
                    </span>
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
