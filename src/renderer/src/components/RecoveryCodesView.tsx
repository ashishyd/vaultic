import { useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { ConfirmDialog } from './ConfirmDialog'
import { PageHeader } from './PageHeader'
import { EyeIcon, CopyIcon, PlusIcon } from './icons'

interface RecoveryCodesViewProps {
  onEdit: (id: string) => void
  onAdd: () => void
  onScan: () => void
}

export function RecoveryCodesView({ onEdit, onAdd, onScan }: RecoveryCodesViewProps): JSX.Element {
  const { recoveryCodes, search, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [revealed, setRevealed] = useState<Map<string, string[]>>(new Map())
  const [pendingDelete, setPendingDelete] = useState<{ id: string; service: string } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return recoveryCodes
      .filter((r) => !q || r.service.toLowerCase().includes(q))
      .sort((a, b) => a.service.localeCompare(b.service))
  }, [recoveryCodes, search])

  // Falls back to the first service so the detail pane is never empty while the list has items.
  const sel = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null

  function selectEntry(id: string): void {
    if (id === sel?.id) return
    // Revealed codes must not outlive leaving their service.
    setRevealed(new Map())
    setSelectedId(id)
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
    const codes = await window.vaultAPI.revealRecoveryCodes(id)
    if (codes !== null) {
      setRevealed((prev) => new Map(prev).set(id, codes))
    } else {
      push('Touch ID failed or was cancelled', 'error')
    }
  }

  async function handleCopyCode(entryId: string, index: number): Promise<void> {
    const ok = await window.vaultAPI.copyRecoveryCode(entryId, index)
    push(ok ? 'Copied to clipboard' : 'Authentication failed or was cancelled', ok ? 'success' : 'error')
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return
    const { id, service } = pendingDelete
    await window.vaultAPI.deleteRecoveryCode(id)
    await refresh()
    setPendingDelete(null)
    push(`Deleted "${service}"`, 'success', {
      durationMs: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          await window.vaultAPI.restoreRecoveryCode(id)
          await refresh()
          push('Restored', 'success')
        }
      }
    })
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Recovery Codes"
        searchPlaceholder="Search services…"
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
              Add codes
              <PlusIcon size={14} />
            </button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className={`w-[360px] shrink-0 overflow-y-auto border-r border-vt-border p-2 ${recoveryCodes.length === 0 ? 'hidden' : ''}`}>
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center text-vt-muted">
              <p className="text-sm">No services match your search.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((entry) => {
                const active = entry.id === sel?.id
                return (
                  <button
                    key={entry.id}
                    onClick={() => selectEntry(entry.id)}
                    aria-pressed={active}
                    className={`flex items-center gap-3 rounded-lg border-none px-2.5 py-2 text-left ${
                      active ? 'bg-vt-surface2 ring-1 ring-inset ring-vt-border' : 'bg-transparent hover:bg-vt-surface2/60'
                    }`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-vt-surface2 text-sm font-semibold">
                      {entry.service.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{entry.service}</span>
                      <span className="text-xs text-vt-muted">
                        {entry.codeCount} code{entry.codeCount === 1 ? '' : 's'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
          {!sel ? (
            recoveryCodes.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-vt-muted">
                <p className="text-sm">No recovery codes yet.</p>
                <p className="text-xs">Add them manually or scan for exported backup-code files.</p>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-vt-muted">Select a service to see its codes.</div>
            )
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-vt-surface2 text-xl font-semibold">
                  {sel.service.charAt(0).toUpperCase()}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 className="truncate text-xl font-semibold">{sel.service}</h2>
                  <span className="text-sm text-vt-muted">
                    {sel.codeCount} recovery code{sel.codeCount === 1 ? '' : 's'}
                  </span>
                </div>
                <button
                  onClick={() => onEdit(sel.id)}
                  className="ml-auto shrink-0 rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
                >
                  Edit
                </button>
              </div>

              <div className="flex flex-col gap-3 rounded-xl border border-vt-border bg-vt-surface p-4">
                {revealed.get(sel.id) ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-vt-muted">Click a code to copy it. The clipboard clears after 30 seconds.</span>
                      <button
                        onClick={() => toggleReveal(sel.id)}
                        className="ml-auto rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
                      >
                        Hide
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {(revealed.get(sel.id) ?? []).map((code, i) => (
                        <button
                          key={i}
                          onClick={() => handleCopyCode(sel.id, i)}
                          title="Copy code"
                          className="flex items-center justify-between gap-2 rounded-lg border border-vt-border bg-vt-surface2 px-2.5 py-1.5 text-left font-mono text-xs hover:border-vt-teal"
                        >
                          {code}
                          <CopyIcon size={12} className="shrink-0 text-vt-muted" />
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="min-w-0 truncate font-mono text-xs text-vt-muted">
                      {'•••• '.repeat(Math.min(sel.codeCount, 6)).trim()}
                    </span>
                    <button
                      onClick={() => toggleReveal(sel.id)}
                      className="ml-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
                    >
                      <EyeIcon size={14} />
                      Reveal with Touch ID
                    </button>
                  </div>
                )}
              </div>

              {sel.notes && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-vt-muted">Notes</span>
                  <p className="whitespace-pre-wrap text-sm">{sel.notes}</p>
                </div>
              )}

              <div className="flex items-center gap-3 border-t border-vt-border pt-4 text-xs text-vt-muted">
                <span>
                  Modified {new Date(sel.updatedAt).toLocaleDateString()} · Created {new Date(sel.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => setPendingDelete({ id: sel.id, service: sel.service })}
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
          title="Delete recovery codes"
          message={`Delete "${pendingDelete.service}"? You'll have a few seconds to undo.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
