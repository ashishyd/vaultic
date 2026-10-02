import { useEffect, useState } from 'react'
import { useToastStore } from '../stores/toast-store'
import { RecoveryModal } from './RecoveryModal'
import { ConfirmDialog } from './ConfirmDialog'
import { useEscapeKey } from '../lib/use-escape-key'
import type { StorageInfo } from '../../../preload/api-types'

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function SettingsModal({ onClose }: SettingsModalProps): JSX.Element {
  const push = useToastStore((s) => s.push)
  const [autoLockMinutes, setAutoLockMinutes] = useState(5)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [hasCachedKey, setHasCachedKey] = useState(false)
  const [confirmForgetTouchId, setConfirmForgetTouchId] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [busy, setBusy] = useState(false)

  const [showChangePassword, setShowChangePassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [recoveryPassphrase, setRecoveryPassphrase] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const [showRestore, setShowRestore] = useState(false)
  const [restorePath, setRestorePath] = useState<string | null>(null)
  const [restorePassword, setRestorePassword] = useState('')
  const [restoreError, setRestoreError] = useState<string | null>(null)

  useEscapeKey(onClose, !showRecovery && !confirmForgetTouchId && !showChangePassword && !showRestore)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.vaultAPI.getSettings(),
      window.vaultAPI.hasCachedKey(),
      window.vaultAPI.getStorageInfo(),
      window.vaultAPI.getAppInfo()
    ]).then(([settings, cached, info, appInfo]) => {
      if (!cancelled) {
        setAutoLockMinutes(settings.autoLockMinutes)
        setHasCachedKey(cached)
        setStorage(info)
        setAppVersion(appInfo.version)
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

  async function handleForgetTouchId(): Promise<void> {
    setForgetting(true)
    try {
      await window.vaultAPI.clearCachedKey()
      setHasCachedKey(false)
      setConfirmForgetTouchId(false)
      push('Touch ID unlock cleared — next unlock needs your master password', 'success')
    } catch {
      push('Could not clear the Keychain-cached key', 'error')
    } finally {
      setForgetting(false)
    }
  }

  async function handleBackup(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.vaultAPI.backupVault()
      if (result.success) {
        push(
          result.recoveryPath
            ? `Backup saved (${result.vaultPath}) + recovery companion`
            : `Backup saved to ${result.vaultPath}`,
          'success'
        )
      } else if (result.error !== 'Cancelled') {
        push(result.error ?? 'Backup failed', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handlePickRestore(): Promise<void> {
    const path = await window.vaultAPI.pickVaultBackup()
    if (!path) return
    setRestorePath(path)
    setRestorePassword('')
    setRestoreError(null)
    setShowRestore(true)
  }

  async function handleRestore(): Promise<void> {
    if (!restorePath || !restorePassword) return
    setBusy(true)
    setRestoreError(null)
    try {
      const result = await window.vaultAPI.restoreVault(restorePath, restorePassword)
      if (result.success) {
        setShowRestore(false)
        onClose()
        push('Vault restored — unlock with the backup master password', 'success')
      } else {
        setRestoreError(result.error ?? 'Restore failed')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleChangePassword(): Promise<void> {
    setPasswordError(null)
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.')
      return
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const result = await window.vaultAPI.changeMasterPassword(
        currentPassword,
        newPassword,
        storage?.recoveryEnabled ? recoveryPassphrase || null : null
      )
      if (result.success) {
        setShowChangePassword(false)
        setCurrentPassword('')
        setNewPassword('')
        setConfirmNewPassword('')
        setRecoveryPassphrase('')
        if (result.recoveryCleared) {
          push('Master password changed. Recovery access was cleared — set it up again if needed.', 'info')
        } else {
          push('Master password changed', 'success')
        }
        const info = await window.vaultAPI.getStorageInfo()
        setStorage(info)
      } else {
        setPasswordError(result.error ?? 'Could not change password')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleCheckUpdates(): Promise<void> {
    const result = await window.vaultAPI.checkForUpdates()
    push(result.message, 'info')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold">Settings</h2>

        {loading ? (
          <p className="text-xs text-vt-muted">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-vt-muted">Auto-lock after inactivity</label>
              <select
                value={autoLockMinutes}
                disabled={saving}
                onChange={(e) => void handleChange(Number(e.target.value))}
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal disabled:opacity-50"
              >
                {AUTO_LOCK_OPTIONS.map((opt) => (
                  <option key={opt.minutes} value={opt.minutes}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="border-t border-vt-border pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-vt-muted">Storage</h3>
              {storage && (
                <div className="mb-3 space-y-1 text-xs text-vt-muted">
                  <p>
                    Vault size: <span className="text-vt-text">{formatBytes(storage.vaultBytes)}</span>
                  </p>
                  <p className="truncate" title={storage.vaultPath}>
                    Path: <span className="text-vt-text">{storage.vaultPath}</span>
                  </p>
                  <p>
                    Items: {storage.counts.apiKeys} keys · {storage.counts.logins} logins ·{' '}
                    {storage.counts.recoveryCodes} recovery · {storage.counts.secureNotes} notes
                  </p>
                  <p>
                    Trash: {storage.trashCount} item{storage.trashCount === 1 ? '' : 's'} (kept{' '}
                    {storage.retentionDays} days)
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => void handleBackup()}
                  disabled={busy}
                  className="w-full rounded-lg border border-vt-border px-3 py-2 text-sm hover:bg-vt-surface2 disabled:opacity-50"
                >
                  Back up vault…
                </button>
                <button
                  onClick={() => void handlePickRestore()}
                  disabled={busy}
                  className="w-full rounded-lg border border-vt-border px-3 py-2 text-sm hover:bg-vt-surface2 disabled:opacity-50"
                >
                  Restore from backup…
                </button>
                <button
                  onClick={() => {
                    setPasswordError(null)
                    setShowChangePassword(true)
                  }}
                  className="w-full rounded-lg border border-vt-border px-3 py-2 text-sm hover:bg-vt-surface2"
                >
                  Change master password…
                </button>
              </div>
            </div>

            <div className="border-t border-vt-border pt-4">
              <button
                onClick={() => setShowRecovery(true)}
                className="w-full rounded-lg border border-vt-border px-3 py-2 text-sm hover:bg-vt-surface2"
              >
                Emergency Recovery Access…
              </button>
              {hasCachedKey && (
                <button
                  onClick={() => setConfirmForgetTouchId(true)}
                  disabled={forgetting}
                  className="mt-2 w-full rounded-lg border border-vt-border px-3 py-2 text-sm hover:bg-vt-surface2 disabled:opacity-50"
                >
                  Forget Touch ID unlock…
                </button>
              )}
            </div>

            <div className="border-t border-vt-border pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-vt-muted">About</h3>
              <p className="mb-2 text-xs text-vt-muted">
                Vaultic {appVersion} · local-first · ⌘⇧V shows window from tray
              </p>
              <button
                onClick={() => void handleCheckUpdates()}
                className="w-full rounded-lg border border-vt-border px-3 py-2 text-sm hover:bg-vt-surface2"
              >
                Check for updates
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
          >
            Close
          </button>
        </div>
      </div>

      {showRecovery && <RecoveryModal onClose={() => setShowRecovery(false)} />}
      {confirmForgetTouchId && (
        <ConfirmDialog
          title="Forget Touch ID unlock?"
          message="Vaultic will remove the cached vault key from Keychain. Touch ID unlock won't work until you unlock once with your master password."
          confirmLabel={forgetting ? 'Clearing…' : 'Forget Touch ID'}
          tone="danger"
          onConfirm={() => void handleForgetTouchId()}
          onCancel={() => setConfirmForgetTouchId(false)}
        />
      )}

      {showChangePassword && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-2xl border border-vt-border bg-vt-surface p-6">
            <h3 className="mb-3 text-sm font-semibold">Change master password</h3>
            <div className="flex flex-col gap-2">
              <input
                type="password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
              />
              <input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
              />
              {storage?.recoveryEnabled && (
                <>
                  <input
                    type="password"
                    placeholder="Recovery passphrase (to keep recovery)"
                    value={recoveryPassphrase}
                    onChange={(e) => setRecoveryPassphrase(e.target.value)}
                    className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
                  />
                  <p className="text-[11px] text-vt-muted">
                    Leave blank to clear emergency recovery (you can set it up again afterward).
                  </p>
                </>
              )}
              {passwordError && <p className="text-xs text-vt-danger">{passwordError}</p>}
              <div className="mt-2 flex justify-end gap-2">
                <button
                  onClick={() => setShowChangePassword(false)}
                  className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleChangePassword()}
                  disabled={busy}
                  className="rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Change password'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRestore && restorePath && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-2xl border border-vt-border bg-vt-surface p-6">
            <h3 className="mb-1 text-sm font-semibold">Restore vault backup</h3>
            <p className="mb-3 truncate text-[11px] text-vt-muted" title={restorePath}>
              {restorePath}
            </p>
            <p className="mb-3 text-xs text-vt-muted">
              This replaces your current vault. You&apos;ll be locked out and must unlock with the backup&apos;s
              master password.
            </p>
            <input
              type="password"
              placeholder="Backup master password"
              value={restorePassword}
              onChange={(e) => setRestorePassword(e.target.value)}
              className="mb-2 w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
            />
            {restoreError && <p className="mb-2 text-xs text-vt-danger">{restoreError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowRestore(false)}
                className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleRestore()}
                disabled={busy || !restorePassword}
                className="rounded-lg bg-vt-danger px-3 py-1.5 text-sm font-medium text-vt-bg disabled:opacity-50"
              >
                {busy ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
