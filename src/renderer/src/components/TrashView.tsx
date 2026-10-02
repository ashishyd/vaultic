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
  }
}

export function TrashView(): JSX.Element {
  const refresh = useVaultStore((s) => s.refresh)
  const push = useToastStore((s) => s.push)
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [pendingPermanent, setPendingPermanent] = useState<TrashItem | null>(null)

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
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <div
                key={`${item.kind}-${item.id}`}
                className="flex items-center gap-3 rounded-xl border border-vt-border px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <span className="shrink-0 rounded-full bg-vt-surface2 px-2 py-0.5 text-[10px] text-vt-muted">
                      {kindLabel(item.kind)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-vt-muted">
                    {item.subtitle} · {daysLeft(item.expiresAt)}d left
                  </p>
                </div>
                <button
                  onClick={() => void handleRestore(item)}
                  className="rounded-lg border border-vt-border px-2.5 py-1.5 text-xs hover:bg-vt-surface2"
                >
                  Restore
                </button>
                <button
                  onClick={() => setPendingPermanent(item)}
                  className="rounded-lg border border-vt-border px-2.5 py-1.5 text-xs text-vt-danger hover:bg-vt-surface2"
                >
                  Delete forever
                </button>
              </div>
            ))}
          </div>
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
