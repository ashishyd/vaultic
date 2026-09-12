import { useEffect, useState } from 'react'
import { useToastStore } from '../stores/toast-store'
import { ConfirmDialog } from './ConfirmDialog'

interface RecoveryModalProps {
  onClose: () => void
}

export function RecoveryModal({ onClose }: RecoveryModalProps): JSX.Element {
  const push = useToastStore((s) => s.push)
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [kitText, setKitText] = useState<string | null>(null)
  const [confirmingDisable, setConfirmingDisable] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.vaultAPI.hasRecovery().then((has) => {
      if (!cancelled) {
        setEnabled(has)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSetup(): Promise<void> {
    setError(null)
    if (passphrase.length < 10) {
      setError('Use at least 10 characters — this is a second master password.')
      return
    }
    if (passphrase !== confirmPassphrase) {
      setError('Passphrases do not match.')
      return
    }
    setSaving(true)
    try {
      const ok = await window.vaultAPI.setupRecovery(passphrase)
      if (ok) {
        setEnabled(true)
        setPassphrase('')
        setConfirmPassphrase('')
        push('Recovery access enabled', 'success')
      } else {
        setError('Could not enable — Touch ID was declined.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleViewKit(): Promise<void> {
    const kit = await window.vaultAPI.exportRecoveryKit()
    if (kit) setKitText(kit)
    else push('Touch ID failed or was cancelled', 'error')
  }

  async function handleDisable(): Promise<void> {
    setConfirmingDisable(false)
    const ok = await window.vaultAPI.clearRecovery()
    if (ok) {
      setEnabled(false)
      setKitText(null)
      push('Recovery access disabled', 'success')
    } else {
      push('Touch ID failed or was cancelled', 'error')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold">Emergency Recovery Access</h2>
        <p className="mb-4 text-xs text-vt-muted">
          A second, independent passphrase that can unlock this vault if you ever forget your master password.
          It doesn't replace or weaken your master password — it's a separate keyslot, like a spare key.
        </p>

        {loading ? (
          <p className="text-xs text-vt-muted">Loading…</p>
        ) : !enabled ? (
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-vt-muted">Recovery passphrase</label>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-vt-muted">Confirm passphrase</label>
              <input
                type="password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
              />
            </div>
            {error && <p className="text-xs text-vt-danger">{error}</p>}
            <button
              onClick={handleSetup}
              disabled={saving}
              className="rounded-lg bg-vt-teal px-3 py-2 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
            >
              {saving ? 'Enabling…' : 'Enable recovery access'}
            </button>
            <p className="text-[11px] text-vt-muted">
              Choose something memorable but not written elsewhere — anyone with this passphrase and a copy of
              your recovery kit can unlock the vault.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-vt-teal">Recovery access is enabled.</p>

            {kitText ? (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-vt-muted">
                  Recovery kit — save this somewhere safe (e.g. printed, in a password-protected note). You'll also
                  need your recovery passphrase to use it.
                </label>
                <textarea
                  readOnly
                  value={kitText}
                  rows={5}
                  className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 font-mono text-[11px] text-vt-teal outline-none"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(kitText)
                    push('Copied to clipboard', 'success')
                  }}
                  className="self-start rounded-md border border-vt-border px-2 py-1 text-xs hover:bg-vt-surface2"
                >
                  Copy
                </button>
              </div>
            ) : (
              <button
                onClick={handleViewKit}
                className="self-start rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2"
              >
                View / export recovery kit
              </button>
            )}

            <button
              onClick={() => setConfirmingDisable(true)}
              className="self-start rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-danger hover:bg-vt-surface2"
            >
              Disable recovery access
            </button>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2">
            Close
          </button>
        </div>
      </div>

      {confirmingDisable && (
        <ConfirmDialog
          title="Disable recovery access?"
          message="You will no longer be able to unlock Vaultic with the recovery passphrase — only your master password will work."
          confirmLabel="Disable"
          onConfirm={handleDisable}
          onCancel={() => setConfirmingDisable(false)}
        />
      )}
    </div>
  )
}
