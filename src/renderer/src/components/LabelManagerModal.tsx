import { useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { ConfirmDialog } from './ConfirmDialog'

interface LabelManagerModalProps {
  onClose: () => void
}

const COLOR_PALETTE = [
  '#2DD4BF',
  '#F59E0B',
  '#F87171',
  '#A78BFA',
  '#60A5FA',
  '#34D399',
  '#F472B6',
  '#FBBF24',
  '#818CF8',
  '#FB923C'
]

export function LabelManagerModal({ onClose }: LabelManagerModalProps): JSX.Element {
  const { labels, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLOR_PALETTE[0])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleAdd(): Promise<void> {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await window.vaultAPI.addLabel(newName.trim(), newColor)
      setNewName('')
      await refresh()
      push('Label created', 'success')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(label: { id: string; name: string; color: string }): void {
    setEditingId(label.id)
    setEditName(label.name)
    setEditColor(label.color)
  }

  async function handleSaveEdit(): Promise<void> {
    if (!editingId || !editName.trim()) return
    await window.vaultAPI.updateLabel(editingId, { name: editName.trim(), color: editColor })
    setEditingId(null)
    await refresh()
    push('Label updated', 'success')
  }

  async function handleConfirmDelete(): Promise<void> {
    if (!pendingDelete) return
    await window.vaultAPI.deleteLabel(pendingDelete.id)
    setPendingDelete(null)
    await refresh()
    push('Label deleted', 'success')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold">Manage Labels</h2>

        <div className="mb-4 flex-1 overflow-y-auto">
          {labels.length === 0 && <p className="text-xs text-vt-muted">No labels yet — create one below.</p>}
          <div className="flex flex-col gap-2">
            {labels.map((label) =>
              editingId === label.id ? (
                <div key={label.id} className="flex flex-col gap-2 rounded-lg border border-vt-border p-2">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="rounded-md border border-vt-border bg-vt-surface2 px-2 py-1 text-sm outline-none focus:border-vt-teal"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {COLOR_PALETTE.map((c) => (
                      <button
                        key={c}
                        onClick={() => setEditColor(c)}
                        style={{ backgroundColor: c }}
                        className={`h-6 w-6 rounded-full ${editColor === c ? 'ring-2 ring-vt-text ring-offset-2 ring-offset-vt-surface' : ''}`}
                      />
                    ))}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-md border border-vt-border px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      className="rounded-md bg-vt-teal px-2 py-1 text-xs font-medium text-vt-bg hover:brightness-110"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  key={label.id}
                  className="flex items-center justify-between rounded-lg border border-vt-border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: label.color }} />
                    <span className="text-sm">{label.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startEdit(label)}
                      className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-text"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setPendingDelete({ id: label.id, name: label.name })}
                      className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-danger"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        <div className="border-t border-vt-border pt-4">
          <label className="mb-1 block text-xs font-medium text-vt-muted">New label</label>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder="e.g. Work"
              className="flex-1 rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
            />
            <button
              onClick={handleAdd}
              disabled={saving || !newName.trim()}
              className="rounded-lg bg-vt-teal px-3 py-2 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
            >
              Add
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                style={{ backgroundColor: c }}
                className={`h-6 w-6 rounded-full ${newColor === c ? 'ring-2 ring-vt-text ring-offset-2 ring-offset-vt-surface' : ''}`}
              />
            ))}
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2">
            Close
          </button>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete label"
          message={`Delete "${pendingDelete.name}"? It will be removed from every login it's assigned to.`}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
