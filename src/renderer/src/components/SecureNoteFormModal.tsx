import { useEffect, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'

interface SecureNoteFormModalProps {
  /** When set, edits this existing note instead of creating a new one. */
  id?: string
  onClose: () => void
}

export function SecureNoteFormModal({ id, onClose }: SecureNoteFormModalProps): JSX.Element {
  const { secureNotes, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!id)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load(): Promise<void> {
      const entry = secureNotes.find((n) => n.id === id)
      if (entry) setTitle(entry.title)
      const revealed = await window.vaultAPI.revealSecureNoteContent(id!)
      if (cancelled) return
      if (revealed === null) {
        setUnavailable(true)
      } else {
        setContent(revealed)
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleSave(): Promise<void> {
    setError(null)
    if (!title.trim() || !content.trim()) {
      setError('A title and some content are required.')
      return
    }

    setSaving(true)
    try {
      if (id) {
        const result = await window.vaultAPI.updateSecureNote(id, { title: title.trim(), content })
        if (!result) {
          setError('Could not save — Touch ID was declined.')
          return
        }
      } else {
        await window.vaultAPI.addSecureNote({ title: title.trim(), content })
      }
      await refresh()
      push('Saved', 'success')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold">{id ? 'Edit Secure Note' : 'Add Secure Note'}</h2>
        <p className="mb-4 text-xs text-vt-muted">
          Free-form encrypted text — Wi-Fi passwords, license keys, PGP/SSH keys, anything else.
        </p>

        {loading ? (
          <p className="text-xs text-vt-muted">Waiting for Touch ID…</p>
        ) : unavailable ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-vt-danger">
              Could not unlock the current content — Touch ID was declined or cancelled.
            </p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-vt-muted">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Home Wi-Fi"
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vt-muted">Content</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 font-mono text-xs outline-none focus:border-vt-teal"
                placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…'}
              />
            </div>

            {error && <p className="text-xs text-vt-danger">{error}</p>}

            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
