import { useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { ConfirmDialog } from './ConfirmDialog'
import { PageHeader } from './PageHeader'
import { IconButton } from './IconButton'
import { EyeIcon, CopyIcon, PencilIcon, TrashIcon, PlusIcon, FolderIcon } from './icons'

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return recoveryCodes
      .filter((r) => !q || r.service.toLowerCase().includes(q))
      .sort((a, b) => a.service.localeCompare(b.service))
  }, [recoveryCodes, search])

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

  async function handleCopyCode(code: string): Promise<void> {
    const ok = await window.vaultAPI.copyRecoveryCode(code)
    push(ok ? 'Copied to clipboard' : 'Touch ID failed or was cancelled', ok ? 'success' : 'error')
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

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {recoveryCodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-vt-muted">
            <p className="text-sm">No recovery codes yet.</p>
            <p className="text-xs">Add them manually or scan for exported backup-code files.</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-vt-muted">No services match your search.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {filtered.map((entry) => {
              const codes = revealed.get(entry.id)
              return (
                <div key={entry.id} className="rounded-xl border border-vt-border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FolderIcon size={14} className="text-vt-muted" />
                      <h3 className="text-sm font-semibold">{entry.service}</h3>
                      <span className="text-xs text-vt-muted/70">
                        {entry.codeCount} code{entry.codeCount === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="inline-flex gap-0.5">
                      <IconButton onClick={() => toggleReveal(entry.id)} title={codes ? 'Hide' : 'Show'}>
                        <EyeIcon size={14} />
                      </IconButton>
                      <IconButton onClick={() => onEdit(entry.id)} title="Edit">
                        <PencilIcon size={14} />
                      </IconButton>
                      <IconButton
                        onClick={() => setPendingDelete({ id: entry.id, service: entry.service })}
                        title="Delete"
                        tone="danger"
                      >
                        <TrashIcon size={14} />
                      </IconButton>
                    </div>
                  </div>

                  {entry.notes && <p className="mb-3 text-xs text-vt-muted">{entry.notes}</p>}

                  {codes ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {codes.map((code, i) => (
                        <button
                          key={i}
                          onClick={() => handleCopyCode(code)}
                          title="Copy code"
                          className="flex items-center justify-between gap-2 rounded-lg border border-vt-border bg-vt-surface2 px-2.5 py-1.5 text-left font-mono text-xs hover:border-vt-teal"
                        >
                          {code}
                          <CopyIcon size={12} className="shrink-0 text-vt-muted" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="font-mono text-xs text-vt-muted">
                      {'•••• '.repeat(Math.min(entry.codeCount, 6)).trim()}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
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
