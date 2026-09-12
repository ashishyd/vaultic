import { useEffect, useState } from 'react'
import { useToastStore } from '../stores/toast-store'
import { RecoveryModal } from './RecoveryModal'

interface SettingsModalProps {
  onClose: () => void
}

const AUTO_LOCK_OPTIONS: Array<{ label: string; minutes: number }> = [
  { label: 'Never', minutes: 0 },
  { label: '1 minute', minutes: 1 },
  { label: '5 minutes', minutes: 5 },
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 }
]

export function SettingsModal({ onClose }: SettingsModalProps): JSX.Element {
  const push = useToastStore((s) => s.push)
  const [autoLockMinutes, setAutoLockMinutes] = useState(5)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.vaultAPI.getSettings().then((settings) => {
      if (!cancelled) {
        setAutoLockMinutes(settings.autoLockMinutes)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleChange(minutes: number): Promise<void> {
    setAutoLockMinutes(minutes)
    setSaving(true)
    try {
      await window.vaultAPI.setSettings({ autoLockMinutes: minutes })
      push('Settings saved', 'success')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold">Settings</h2>

        {loading ? (
          <p className="text-xs text-vt-muted">Loading…</p>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-vt-muted">Auto-lock after inactivity</label>
            <select
              value={autoLockMinutes}
              disabled={saving}
              onChange={(e) => handleChange(Number(e.target.value))}
              className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal disabled:opacity-50"
            >
              {AUTO_LOCK_OPTIONS.map((opt) => (
                <option key={opt.minutes} value={opt.minutes}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-vt-muted">
              Locks the vault automatically after this much system-wide inactivity, even while Vaultic is open.
            </p>

            <div className="mt-4 border-t border-vt-border pt-4">
              <button
                onClick={() => setShowRecovery(true)}
                className="w-full rounded-lg border border-vt-border px-3 py-2 text-sm hover:bg-vt-surface2"
              >
                Emergency Recovery Access…
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2">
            Close
          </button>
        </div>
      </div>

      {showRecovery && <RecoveryModal onClose={() => setShowRecovery(false)} />}
    </div>
  )
}
