import { useEffect, useState, type ReactNode } from 'react'
import { useToastStore } from '../stores/toast-store'
import { RecoveryModal } from './RecoveryModal'
import { ConfirmDialog } from './ConfirmDialog'
import { useVaultStore } from '../stores/vault-store'
import { PageHeader } from './PageHeader'
import type { StorageInfo } from '../../../preload/api-types'

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

const SECTION_TITLES: string[] = ['Security', 'Browser extension', 'Backup and sync', 'Storage and about']

function sectionId(title: string): string {
  return title.toLowerCase().replace(/ /g, '-')
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section id={sectionId(title)} className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-vt-muted">{title}</h3>
      <div className="flex flex-col rounded-xl border border-vt-border">{children}</div>
    </section>
  )
}

function SettingRow({
  title,
  description,
  mono,
  children
}: {
  title: string
  description: string
  mono?: boolean
  children: ReactNode
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-vt-border px-4 py-3 last:border-b-0">
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className={`break-all text-xs text-vt-muted ${mono ? 'font-mono text-vt-teal' : ''}`}>{description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

export function SettingsView(): JSX.Element {
  const push = useToastStore((s) => s.push)
  const setSection = useVaultStore((s) => s.setSection)
  // A restore replaces the vault, so leave the page like the old modal's close did.
  const onClose = (): void => setSection('logins')
  const [autoLockMinutes, setAutoLockMinutes] = useState(5)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState(SECTION_TITLES[0])
  const [saving, setSaving] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  const [hasCachedKey, setHasCachedKey] = useState(false)
  const [confirmForgetTouchId, setConfirmForgetTouchId] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const [bridgeToken, setBridgeToken] = useState('')
  const [extensionId, setExtensionId] = useState('')
  const [launchAtLogin, setLaunchAtLogin] = useState(false)

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

  const [cloudConfigured, setCloudConfigured] = useState(false)
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState<number | null>(null)
  const [cloudSyncing, setCloudSyncing] = useState(false)
  const [showCloudRestore, setShowCloudRestore] = useState(false)
  const [cloudRestorePassword, setCloudRestorePassword] = useState('')
  const [cloudRestoreError, setCloudRestoreError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.vaultAPI.getSettings(),
      window.vaultAPI.hasCachedKey(),
      window.vaultAPI.getStorageInfo(),
      window.vaultAPI.getAppInfo(),
      window.vaultAPI.getBridgeInfo(),
      window.vaultAPI.cloudSyncStatus(),
      window.vaultAPI.getLaunchAtLogin()
    ]).then(([settings, cached, info, appInfo, bridge, cloud, launch]) => {
      if (!cancelled) {
        setAutoLockMinutes(settings.autoLockMinutes)
        setHasCachedKey(cached)
        setStorage(info)
        setAppVersion(appInfo.version)
        setBridgeToken(bridge.token)
        setExtensionId(bridge.extensionId)
        setCloudConfigured(cloud.configured)
        setCloudUpdatedAt(cloud.updatedAt)
        setLaunchAtLogin(launch)
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

  async function handleCloudPush(): Promise<void> {
    setCloudSyncing(true)
    try {
      const result = await window.vaultAPI.cloudSyncPush()
      if (result.success) {
        const status = await window.vaultAPI.cloudSyncStatus()
        setCloudUpdatedAt(status.updatedAt)
        push('Vault synced to the cloud', 'success')
      } else {
        push(result.error ?? 'Cloud sync failed', 'error')
      }
    } finally {
      setCloudSyncing(false)
    }
  }

  function handleOpenCloudRestore(): void {
    setCloudRestorePassword('')
    setCloudRestoreError(null)
    setShowCloudRestore(true)
  }

  async function handleCloudRestore(): Promise<void> {
    if (!cloudRestorePassword) return
    setCloudSyncing(true)
    setCloudRestoreError(null)
    try {
      const result = await window.vaultAPI.cloudSyncPull(cloudRestorePassword)
      if (result.success) {
        setShowCloudRestore(false)
        onClose()
        push('Vault restored from the cloud — unlock with that master password', 'success')
      } else {
        setCloudRestoreError(result.error ?? 'Restore failed')
      }
    } finally {
      setCloudSyncing(false)
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

  async function handleCopyToken(): Promise<void> {
    if (!bridgeToken) return
    await window.vaultAPI.copyToClipboard(bridgeToken)
    push('Bridge token copied (clears in 30s)', 'success')
  }

  async function handleInstallNativeHost(): Promise<void> {
    setBusy(true)
    try {
      const result = await window.vaultAPI.installNativeHost()
      if (result.ok) push('Browser bridge installed for Chrome Native Messaging', 'success')
      else push(result.error ?? 'Install failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleOpenExtension(): Promise<void> {
    const result = await window.vaultAPI.openExtensionFolder()
    if (!result.ok) push(result.error ?? 'Could not open extension folder', 'error')
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <div className="flex-1 overflow-y-auto px-7 py-6">
       <div className="flex gap-8">
        {!loading && (
          <nav className="sticky top-0 flex w-44 shrink-0 flex-col gap-0.5 self-start">
            {SECTION_TITLES.map((title) => (
              <button
                key={title}
                onClick={() => {
                  setActiveSection(title)
                  document.getElementById(sectionId(title))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
                className={`rounded-lg px-3 py-1.5 text-left text-sm ${
                  activeSection === title ? 'bg-vt-surface2 text-vt-text' : 'text-vt-muted hover:bg-vt-surface2'
                }`}
              >
                {title}
              </button>
            ))}
          </nav>
        )}
       <div className="min-w-0 max-w-2xl flex-1">

        {loading ? (
          <p className="text-xs text-vt-muted">Loading…</p>
        ) : (
          <div className="flex flex-col gap-6">
            <SettingGroup title="Security">
              <SettingRow title="Auto-lock after inactivity" description="Clears the key from memory. Touch ID still works after.">
                <select
                  value={autoLockMinutes}
                  disabled={saving}
                  onChange={(e) => void handleChange(Number(e.target.value))}
                  className="rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal disabled:opacity-50"
                >
                  {AUTO_LOCK_OPTIONS.map((opt) => (
                    <option key={opt.minutes} value={opt.minutes}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </SettingRow>
              <SettingRow
                title="Touch ID unlock"
                description={
                  hasCachedKey ? 'On. The vault key is cached in your macOS Keychain.' : 'Off. The next unlock needs your master password.'
                }
              >
                {hasCachedKey && (
                  <button
                    onClick={() => setConfirmForgetTouchId(true)}
                    disabled={forgetting}
                    className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-danger hover:bg-vt-surface2 disabled:opacity-50"
                  >
                    Forget Touch ID…
                  </button>
                )}
              </SettingRow>
              <SettingRow title="Master password" description="Re-encrypts the vault with a new password.">
                <button
                  onClick={() => {
                    setPasswordError(null)
                    setShowChangePassword(true)
                  }}
                  className="rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2"
                >
                  Change…
                </button>
              </SettingRow>
              <SettingRow title="Emergency recovery access" description="A second way in if you forget the master password.">
                <button
                  onClick={() => setShowRecovery(true)}
                  className="rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2"
                >
                  Manage…
                </button>
              </SettingRow>
            </SettingGroup>

            <SettingGroup title="Browser extension">
              <SettingRow
                title="Launch Vaultic at login"
                description="So the extension always works, with no need to open the app."
              >
                <input
                  type="checkbox"
                  aria-label="Launch Vaultic at login"
                  checked={launchAtLogin}
                  onChange={async (e) => {
                    const next = e.target.checked
                    setLaunchAtLogin(next)
                    setLaunchAtLogin(await window.vaultAPI.setLaunchAtLogin(next))
                  }}
                />
              </SettingRow>
              <SettingRow title="Bridge token" description={bridgeToken || '…'} mono>
                <button
                  onClick={() => void handleCopyToken()}
                  className="rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2"
                >
                  Copy
                </button>
              </SettingRow>
              <SettingRow title="Browser bridge" description="Native Messaging host for Chrome.">
                <button
                  onClick={() => void handleInstallNativeHost()}
                  disabled={busy}
                  className="rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2 disabled:opacity-50"
                >
                  Install
                </button>
              </SettingRow>
              <SettingRow
                title="Extension folder"
                description={`Chrome → Extensions → Load unpacked. Extension ID: ${extensionId || '…'}`}
              >
                <button
                  onClick={() => void handleOpenExtension()}
                  className="rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2"
                >
                  Reveal…
                </button>
              </SettingRow>
            </SettingGroup>

            <SettingGroup title="Backup and sync">
              {cloudConfigured ? (
                <SettingRow
                  title="Cloud sync"
                  description={`${cloudUpdatedAt ? `Last synced ${new Date(cloudUpdatedAt).toLocaleString()}. ` : 'Not synced yet. '}Only the encrypted file is stored.`}
                >
                  <button
                    onClick={() => void handleCloudPush()}
                    disabled={cloudSyncing}
                    className="rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2 disabled:opacity-50"
                  >
                    {cloudSyncing ? 'Syncing…' : 'Sync…'}
                  </button>
                  <button
                    onClick={handleOpenCloudRestore}
                    disabled={cloudSyncing}
                    className="rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2 disabled:opacity-50"
                  >
                    Restore…
                  </button>
                </SettingRow>
              ) : (
                <SettingRow
                  title="Cloud sync"
                  description="Not configured (no DATABASE_URL). Run the Neon setup for this app to enable it."
                >
                  {null}
                </SettingRow>
              )}
              <SettingRow title="Local backup file" description="Save or restore an encrypted copy of the vault.">
                <button
                  onClick={() => void handleBackup()}
                  disabled={busy}
                  className="rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2 disabled:opacity-50"
                >
                  Back up…
                </button>
                <button
                  onClick={() => void handlePickRestore()}
                  disabled={busy}
                  className="rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2 disabled:opacity-50"
                >
                  Restore…
                </button>
              </SettingRow>
            </SettingGroup>

            <SettingGroup title="Storage and about">
              {storage && (
                <SettingRow
                  title={`Vault size ${formatBytes(storage.vaultBytes)}`}
                  description={`${storage.counts.apiKeys} keys · ${storage.counts.logins} logins · ${storage.counts.recoveryCodes} recovery · ${storage.counts.secureNotes} notes · ${storage.counts.bookmarks} bookmarks. Trash: ${storage.trashCount} item${storage.trashCount === 1 ? '' : 's'}, kept ${storage.retentionDays} days.`}
                >
                  {null}
                </SettingRow>
              )}
              <SettingRow title={`Vaultic ${appVersion}`} description="Local-first · ⌘⇧V shows the window from the tray">
                <button
                  onClick={() => void handleCheckUpdates()}
                  className="rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2"
                >
                  Check for updates
                </button>
              </SettingRow>
            </SettingGroup>
          </div>
        )}

       </div>
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

      {showCloudRestore && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-2xl border border-vt-border bg-vt-surface p-6">
            <h3 className="mb-1 text-sm font-semibold">Restore vault from cloud</h3>
            <p className="mb-3 text-xs text-vt-muted">
              This replaces your current vault with the last cloud sync. You&apos;ll be locked out and must unlock
              with that backup&apos;s master password.
            </p>
            <input
              type="password"
              placeholder="Cloud backup master password"
              value={cloudRestorePassword}
              onChange={(e) => setCloudRestorePassword(e.target.value)}
              className="mb-2 w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
            />
            {cloudRestoreError && <p className="mb-2 text-xs text-vt-danger">{cloudRestoreError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCloudRestore(false)}
                className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleCloudRestore()}
                disabled={cloudSyncing || !cloudRestorePassword}
                className="rounded-lg bg-vt-danger px-3 py-1.5 text-sm font-medium text-vt-bg disabled:opacity-50"
              >
                {cloudSyncing ? 'Restoring…' : 'Restore'}
              </button>
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
