import { useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { ConfirmDialog } from './ConfirmDialog'
import { PageHeader } from './PageHeader'
import { IconButton } from './IconButton'
import { CopyIcon, LockIcon, PlusIcon } from './icons'

interface SecureNotesViewProps {
  onEdit: (id: string) => void
  onAdd: () => void
}

export function SecureNotesView({ onEdit, onAdd }: SecureNotesViewProps): JSX.Element {
  const { secureNotes, search, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map())
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return secureNotes
      .filter((n) => !q || n.title.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [secureNotes, search])

  // Falls back to the first note so the detail pane is never empty while the list has items.
  const sel = filtered.find((n) => n.id === selectedId) ?? filtered[0] ?? null

  function selectNote(id: string): void {
    if (id === sel?.id) return
    // A revealed note must not outlive leaving it.
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

      <div className="flex min-h-0 flex-1">
        <div className={`w-[360px] shrink-0 overflow-y-auto border-r border-vt-border p-2 ${secureNotes.length === 0 ? 'hidden' : ''}`}>
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center text-vt-muted">
              <p className="text-sm">No notes match your search.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((note) => {
                const active = note.id === sel?.id
                return (
                  <button
                    key={note.id}
                    onClick={() => selectNote(note.id)}
                    aria-pressed={active}
                    className={`flex flex-col gap-1 rounded-lg border-none px-3 py-2.5 text-left ${
                      active ? 'bg-vt-surface2 ring-1 ring-inset ring-vt-border' : 'bg-transparent hover:bg-vt-surface2/60'
                    }`}
                  >
                    <span className="truncate text-sm font-medium">{note.title}</span>
                    <span className="text-xs text-vt-muted">
                      {note.contentLength} char{note.contentLength === 1 ? '' : 's'} · edited{' '}
                      {new Date(note.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto px-7 py-6">
          {!sel ? (
            secureNotes.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-vt-muted">
                <p className="text-sm">No secure notes yet.</p>
                <p className="text-xs">Wi-Fi passwords, license keys, SSH/PGP keys — anything free-form.</p>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-vt-muted">Select a note to see it.</div>
            )
          ) : (
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <h2 className="min-w-0 truncate text-xl font-semibold">{sel.title}</h2>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                  <IconButton onClick={() => handleCopy(sel.id)} title="Copy" tone="teal">
                    <CopyIcon size={14} />
                  </IconButton>
                  <button
                    onClick={() => onEdit(sel.id)}
                    className="rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
                  >
                    Edit
                  </button>
                </div>
              </div>

              {revealed.get(sel.id) !== undefined ? (
                <div className="flex flex-col gap-3">
                  <pre className="whitespace-pre-wrap break-words rounded-xl border border-vt-border bg-vt-surface px-4 py-3 font-mono text-xs text-vt-text">
                    {revealed.get(sel.id)}
                  </pre>
                  <button
                    onClick={() => toggleReveal(sel.id)}
                    className="self-start rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
                  >
                    Hide
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-vt-border bg-vt-surface px-6 py-12 text-center">
                  <LockIcon size={28} className="text-vt-teal" />
                  <p className="text-sm font-medium">This note is hidden</p>
                  <p className="max-w-xs text-xs text-vt-muted">
                    {sel.contentLength} character{sel.contentLength === 1 ? '' : 's'}. It hides again when you pick another note or
                    the vault locks.
                  </p>
                  <button
                    onClick={() => toggleReveal(sel.id)}
                    className="rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
                  >
                    Show with Touch ID
                  </button>
                </div>
              )}

              <div className="flex items-center gap-3 border-t border-vt-border pt-4 text-xs text-vt-muted">
                <span>
                  Modified {new Date(sel.updatedAt).toLocaleDateString()} · Created {new Date(sel.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => setPendingDelete({ id: sel.id, title: sel.title })}
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
          title="Delete secure note"
          message={`Delete "${pendingDelete.title}"? You'll have a few seconds to undo.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
