import { useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { ConfirmDialog } from './ConfirmDialog'
import { PageHeader } from './PageHeader'
import { IconButton } from './IconButton'
import { EyeIcon, CopyIcon, PencilIcon, TrashIcon, PlusIcon } from './icons'

interface SecureNotesViewProps {
  onEdit: (id: string) => void
  onAdd: () => void
}

export function SecureNotesView({ onEdit, onAdd }: SecureNotesViewProps): JSX.Element {
  const { secureNotes, search, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map())
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return secureNotes
      .filter((n) => !q || n.title.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [secureNotes, search])

  async function toggleReveal(id: string): Promise<void> {
    if (revealed.has(id)) {
      setRevealed((prev) => {
        const next = new Map(prev)
        next.delete(id)
        return next
      })
      return
    }
    const content = await window.vaultAPI.revealSecureNoteContent(id)
    if (content !== null) {
      setRevealed((prev) => new Map(prev).set(id, content))
    } else {
      push('Touch ID failed or was cancelled', 'error')
    }
  }

  async function handleCopy(id: string): Promise<void> {
    const ok = await window.vaultAPI.copySecureNoteContent(id)
    push(ok ? 'Copied to clipboard' : 'Touch ID failed or was cancelled', ok ? 'success' : 'error')
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return
    const { id, title } = pendingDelete
    await window.vaultAPI.deleteSecureNote(id)
    await refresh()
    setPendingDelete(null)
    push(`Deleted "${title}"`, 'success', {
      durationMs: 6000,
      action: {
        label: 'Undo',
        onClick: async () => {
          await window.vaultAPI.restoreSecureNote(id)
          await refresh()
          push('Restored', 'success')
        }
      }
    })
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Secure Notes"
        searchPlaceholder="Search notes…"
        actions={
          <button
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 rounded-lg bg-vt-teal px-3.5 py-2 text-sm font-medium text-vt-bg hover:brightness-110"
          >
            Add note
            <PlusIcon size={14} />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {secureNotes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-vt-muted">
            <p className="text-sm">No secure notes yet.</p>
            <p className="text-xs">Wi-Fi passwords, license keys, SSH/PGP keys — anything free-form.</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-vt-muted">No notes match your search.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {filtered.map((note) => {
              const content = revealed.get(note.id)
              return (
                <div key={note.id} className="rounded-xl border border-vt-border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold">{note.title}</h3>
                      <span className="text-xs text-vt-muted/70">
                        {note.contentLength} char{note.contentLength === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="inline-flex gap-0.5">
                      <IconButton onClick={() => toggleReveal(note.id)} title={content ? 'Hide' : 'Show'}>
                        <EyeIcon size={14} />
                      </IconButton>
                      <IconButton onClick={() => handleCopy(note.id)} title="Copy" tone="teal">
                        <CopyIcon size={14} />
                      </IconButton>
                      <IconButton onClick={() => onEdit(note.id)} title="Edit">
                        <PencilIcon size={14} />
                      </IconButton>
                      <IconButton
                        onClick={() => setPendingDelete({ id: note.id, title: note.title })}
                        title="Delete"
                        tone="danger"
                      >
                        <TrashIcon size={14} />
                      </IconButton>
                    </div>
                  </div>

                  {content ? (
                    <pre className="whitespace-pre-wrap break-words rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 font-mono text-xs text-vt-text">
                      {content}
                    </pre>
                  ) : (
                    <p className="font-mono text-xs text-vt-muted">••••••••••••••••••••••••</p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete secure note"
          message={`Delete "${pendingDelete.title}"? You'll have a few seconds to undo.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
