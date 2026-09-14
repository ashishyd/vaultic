import { useEffect, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'

interface RecoveryCodesFormModalProps {
  /** When set, edits this existing entry instead of creating a new one. */
  id?: string
  onClose: () => void
}

export function RecoveryCodesFormModal({ id, onClose }: RecoveryCodesFormModalProps): JSX.Element {
  const { recoveryCodes, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)

  const [service, setService] = useState('')
  const [codesText, setCodesText] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!id)
  const [unavailable, setUnavailable] = useState(false)
  const [importingFile, setImportingFile] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load(): Promise<void> {
      const entry = recoveryCodes.find((r) => r.id === id)
      if (entry) {
        setService(entry.service)
        setNotes(entry.notes ?? '')
      }
      const codes = await window.vaultAPI.revealRecoveryCodes(id!)
      if (cancelled) return
      if (codes === null) {
        setUnavailable(true)
      } else {
        setCodesText(codes.join('\n'))
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleImportFile(): Promise<void> {
    const filePath = await window.vaultAPI.pickRecoveryCodesFile()
    if (!filePath) return
    setImportingFile(true)
    setError(null)
    try {
      const result = await window.vaultAPI.parseRecoveryCodesFile(filePath)
      if (!result.success) {
        setError(result.error)
        return
      }
      if (result.codes.length === 0) {
        setError('No recovery codes were found in that file — check it and paste them in manually.')
      }
      if (!service.trim()) setService(result.service)
      setCodesText((prev) => (prev ? `${prev}\n${result.codes.join('\n')}` : result.codes.join('\n')))
    } finally {
      setImportingFile(false)
    }
  }

  async function handleSave(): Promise<void> {
    setError(null)
    const codes = codesText
      .split('\n')
      .map((c) => c.trim())
      .filter(Boolean)

    if (!service.trim() || codes.length === 0) {
      setError('A service name and at least one code are required.')
      return
    }

    setSaving(true)
    try {
      if (id) {
        const result = await window.vaultAPI.updateRecoveryCode(id, {
          service: service.trim(),
          codes,
          notes: notes.trim() || undefined
        })
        if (!result) {
          setError('Could not save — Touch ID was declined.')
          return
        }
      } else {
        await window.vaultAPI.addRecoveryCode({
          service: service.trim(),
          codes,
          notes: notes.trim() || undefined
        })
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
        <h2 className="mb-1 text-sm font-semibold">{id ? 'Edit Recovery Codes' : 'Add Recovery Codes'}</h2>
        <p className="mb-4 text-xs text-vt-muted">
          One-time backup codes for a service&apos;s 2FA/account recovery — one code per line.
        </p>

        {loading ? (
          <p className="text-xs text-vt-muted">Waiting for Touch ID…</p>
        ) : unavailable ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-vt-danger">
              Could not unlock the current codes — Touch ID was declined or cancelled.
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
              <label className="mb-1 block text-xs font-medium text-vt-muted">Service</label>
              <input
                type="text"
                value={service}
                onChange={(e) => setService(e.target.value)}
                placeholder="e.g. GitHub"
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
              />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs font-medium text-vt-muted">Codes</label>
                {!id && (
                  <button
                    type="button"
                    onClick={handleImportFile}
                    disabled={importingFile}
                    className="text-xs text-vt-teal hover:underline disabled:opacity-50"
                  >
                    {importingFile ? 'Reading…' : 'Import from file…'}
                  </button>
                )}
              </div>
              <textarea
                value={codesText}
                onChange={(e) => setCodesText(e.target.value)}
                rows={8}
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 font-mono text-xs outline-none focus:border-vt-teal"
                placeholder={'a1b2-c3d4\ne5f6-g7h8\n…'}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vt-muted">Notes (optional)</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
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
