import { ipcMain, clipboard, dialog, BrowserWindow, app, shell } from 'electron'
import { unlink, writeFile } from 'fs/promises'
import { resolve as resolvePath, join } from 'path'
import { randomUUID } from 'crypto'
import { vaultStore, type TrashKind } from './vault-store'
import { cacheKey, readCachedKey, clearCachedKey, hasCachedKey } from './keychain'
import { scanForEnvFiles, scanForRecoveryCodes, parseRecoveryCodesFile } from './scanner'
import { isBiometricsAvailable, promptBiometrics, biometricGate } from './biometric'
import { parseLoginsCsvFile, loginsToCsv } from './csv'
import { analyzeLogins, generateStrongPassword } from './password-strength'
import { suggestLabelsWithAi, detectAvailableCli } from './ai-cli'
import { readSettings, writeSettings, type AppSettings } from './settings'
import { getFrontmostChromeTabUrl, getFrontmostBrowserTabUrl } from './chrome'
import { getBridgeInfo } from './browser-bridge'
import { installNativeMessagingHost, getNativeHostInstallInfo } from './native-host-install'

const CLIPBOARD_CLEAR_MS = 30_000
const MASTER_PASSWORD_PROMPT_TIMEOUT_MS = 5 * 60 * 1000

/** Paths returned by the CSV picker that the renderer may later ask to delete. */
const deletableImportPaths = new Set<string>()

type PendingMasterPassword = {
  resolve: (ok: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingMasterPassword = new Map<string, PendingMasterPassword>()

function copyWithAutoClear(value: string): void {
  clipboard.writeText(value)
  setTimeout(() => {
    if (clipboard.readText() === value) clipboard.writeText('')
  }, CLIPBOARD_CLEAR_MS)
}

function finishMasterPasswordRequest(requestId: string, ok: boolean): void {
  const pending = pendingMasterPassword.get(requestId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingMasterPassword.delete(requestId)
  pending.resolve(ok)
}

/**
 * Ask the focused renderer window for the master password, then verify it
 * against the currently unlocked vault key.
 */
function promptMasterPassword(reason: string): Promise<boolean> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return Promise.resolve(false)

  const requestId = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      finishMasterPasswordRequest(requestId, false)
    }, MASTER_PASSWORD_PROMPT_TIMEOUT_MS)

    pendingMasterPassword.set(requestId, { resolve, timer })
    win.webContents.send('vault:needMasterPassword', { requestId, reason })
  })
}

/** Touch ID when available; otherwise re-prompt for the master password. */
function requireAuth(reason: string): Promise<boolean> {
  return biometricGate(reason, () => promptMasterPassword(reason))
}

function allowDeleteOfPickedFile(filePath: string): void {
  deletableImportPaths.add(resolvePath(filePath))
}

function takeDeletableImportPath(filePath: string): string | null {
  const resolved = resolvePath(filePath)
  if (deletableImportPaths.has(resolved)) {
    deletableImportPaths.delete(resolved)
    return resolved
  }
  return null
}

export function registerVaultIpcHandlers(): void {
  ipcMain.handle('vault:hasVault', () => vaultStore.hasVault())

  ipcMain.handle('vault:isUnlocked', () => vaultStore.isUnlocked)

  ipcMain.handle('vault:create', async (_e, masterPassword: string) => {
    await vaultStore.createVault(masterPassword)
    const key = vaultStore.getRawKey()
    if (key) await cacheKey(key)
    return true
  })

  ipcMain.handle('vault:unlock', async (_e, masterPassword: string) => {
    await vaultStore.unlock(masterPassword)
    const key = vaultStore.getRawKey()
    if (key) await cacheKey(key)
    return true
  })

  ipcMain.handle('vault:canUseBiometrics', () => isBiometricsAvailable())

  ipcMain.handle('vault:hasCachedKey', () => hasCachedKey())

  /** Clears the Keychain-cached vault key so Touch ID unlock requires a master-password unlock first. */
  ipcMain.handle('vault:clearCachedKey', async () => {
    await clearCachedKey()
    return true
  })

  /**
   * Completes a master-password re-prompt started by requireAuth. Wrong passwords
   * keep the prompt open (ok: false); cancel/success settles the pending gate.
   */
  ipcMain.handle(
    'vault:confirmMasterPassword',
    async (_e, requestId: string, password: string | null) => {
      const pending = pendingMasterPassword.get(requestId)
      if (!pending) return { ok: false as const, error: 'This confirmation request expired.' }

      if (password === null) {
        finishMasterPasswordRequest(requestId, false)
        return { ok: true as const }
      }

      const valid = await vaultStore.verifyMasterPassword(password)
      if (!valid) return { ok: false as const, error: 'Wrong master password.' }

      finishMasterPasswordRequest(requestId, true)
      return { ok: true as const }
    }
  )

  /** Prompts Touch ID, then unlocks using the OS keychain-cached key. Used on app launch. */
  ipcMain.handle('vault:unlockWithBiometrics', async () => {
    if (!vaultStore.hasVault()) return false
    const cachedKey = await readCachedKey()
    if (!cachedKey) return false
    if (!isBiometricsAvailable()) return false
    const ok = await promptBiometrics('unlock Vaultic')
    if (!ok) return false
    try {
      await vaultStore.unlockWithKey(cachedKey)
      return true
    } catch {
      return false
    }
  })

  // Only clears the in-memory decrypted vault, requiring re-auth (password or
  // Touch ID) to unlock again. The Keychain-cached key is kept so Touch ID
  // keeps working across locks — clearing it would strand Touch ID until the
  // master password was typed once more, defeating the point of caching it.
  ipcMain.handle('vault:lock', async () => {
    vaultStore.lock()
    return true
  })

  ipcMain.handle('vault:listApiKeys', () => vaultStore.listApiKeys())
  ipcMain.handle('vault:listLogins', () => vaultStore.listLogins())
  ipcMain.handle('vault:listRecoveryCodes', () => vaultStore.listRecoveryCodes())
  ipcMain.handle('vault:listSecureNotes', () => vaultStore.listSecureNotes())

  ipcMain.handle(
    'vault:addApiKey',
    (_e, entry: { project: string; name: string; value: string; notes?: string; envFile?: string }) =>
      vaultStore.addApiKey(entry)
  )

  ipcMain.handle(
    'vault:addApiKeys',
    (_e, entries: Array<{ project: string; name: string; value: string; notes?: string; envFile?: string }>) =>
      vaultStore.addApiKeys(entries)
  )

  ipcMain.handle(
    'vault:addLogin',
    (_e, entry: { service: string; username: string; password: string; url?: string; notes?: string }) =>
      vaultStore.addLogin(entry)
  )

  ipcMain.handle(
    'vault:addLogins',
    (_e, entries: Array<{ service: string; username: string; password: string; url?: string; notes?: string }>) =>
      vaultStore.addLogins(entries)
  )

  ipcMain.handle(
    'vault:addRecoveryCode',
    (_e, entry: { service: string; codes: string[]; notes?: string }) => vaultStore.addRecoveryCode(entry)
  )

  ipcMain.handle(
    'vault:addRecoveryCodesBatch',
    (_e, entries: Array<{ service: string; codes: string[]; notes?: string }>) =>
      vaultStore.addRecoveryCodesBatch(entries)
  )

  ipcMain.handle('vault:addSecureNote', (_e, entry: { title: string; content: string }) =>
    vaultStore.addSecureNote(entry)
  )

  // Soft-delete — supports the Undo action shown in the toast after a delete.
  ipcMain.handle('vault:deleteApiKey', (_e, id: string) => vaultStore.deleteApiKey(id))
  ipcMain.handle('vault:deleteApiKeysByProject', (_e, project: string) =>
    vaultStore.deleteApiKeysByProject(project)
  )
  ipcMain.handle('vault:deleteLogin', (_e, id: string) => vaultStore.deleteLogin(id))
  ipcMain.handle('vault:deleteRecoveryCode', (_e, id: string) => vaultStore.deleteRecoveryCode(id))
  ipcMain.handle('vault:deleteSecureNote', (_e, id: string) => vaultStore.deleteSecureNote(id))
  ipcMain.handle('vault:restoreApiKey', (_e, id: string) => vaultStore.restoreApiKey(id))
  ipcMain.handle('vault:restoreApiKeys', (_e, ids: string[]) => vaultStore.restoreApiKeys(ids))
  ipcMain.handle('vault:restoreLogin', (_e, id: string) => vaultStore.restoreLogin(id))
  ipcMain.handle('vault:restoreRecoveryCode', (_e, id: string) => vaultStore.restoreRecoveryCode(id))
  ipcMain.handle('vault:restoreSecureNote', (_e, id: string) => vaultStore.restoreSecureNote(id))

  ipcMain.handle('vault:revealApiKeyValue', async (_e, id: string) => {
    const ok = await requireAuth('view this API key value')
    if (!ok) return null
    return vaultStore.getApiKeyValue(id)
  })

  ipcMain.handle('vault:revealLoginPassword', async (_e, id: string) => {
    const ok = await requireAuth('view this password')
    if (!ok) return null
    return vaultStore.getLoginPassword(id)
  })

  ipcMain.handle('vault:copyApiKeyValue', async (_e, id: string) => {
    const ok = await requireAuth('copy this API key value')
    if (!ok) return false
    const value = vaultStore.getApiKeyValue(id)
    if (!value) return false
    copyWithAutoClear(value)
    return true
  })

  ipcMain.handle('vault:copyLoginPassword', async (_e, id: string) => {
    const ok = await requireAuth('copy this password')
    if (!ok) return false
    const password = vaultStore.getLoginPassword(id)
    if (!password) return false
    copyWithAutoClear(password)
    return true
  })

  ipcMain.handle('vault:revealRecoveryCodes', async (_e, id: string) => {
    const ok = await requireAuth('view these recovery codes')
    if (!ok) return null
    return vaultStore.getRecoveryCodes(id)
  })

  ipcMain.handle('vault:copyRecoveryCode', async (_e, id: string, index: number) => {
    const ok = await requireAuth('copy this recovery code')
    if (!ok) return false
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return false
    const codes = vaultStore.getRecoveryCodes(id)
    if (!codes || index >= codes.length) return false
    copyWithAutoClear(codes[index])
    return true
  })

  ipcMain.handle('vault:revealSecureNoteContent', async (_e, id: string) => {
    const ok = await requireAuth('view this note')
    if (!ok) return null
    return vaultStore.getSecureNoteContent(id)
  })

  ipcMain.handle('vault:copySecureNoteContent', async (_e, id: string) => {
    const ok = await requireAuth('copy this note')
    if (!ok) return false
    const content = vaultStore.getSecureNoteContent(id)
    if (content === null) return false
    copyWithAutoClear(content)
    return true
  })

  ipcMain.handle('vault:copyToClipboard', (_e, value: string) => {
    copyWithAutoClear(value)
    return true
  })

  ipcMain.handle('vault:pickFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Choose a folder to scan for .env files'
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('vault:scanFolder', async (_e, folderPath: string) => scanForEnvFiles(folderPath))
  ipcMain.handle('vault:scanFolderForRecoveryCodes', async (_e, folderPath: string) =>
    scanForRecoveryCodes(folderPath)
  )

  ipcMain.handle('vault:pickRecoveryCodesFile', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [
        { name: 'Text/CSV/PDF', extensions: ['txt', 'csv', 'md', 'pdf'] },
        { name: 'All files', extensions: ['*'] }
      ],
      title: 'Choose a recovery/backup codes file'
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('vault:parseRecoveryCodesFile', async (_e, filePath: string) => {
    try {
      const parsed = await parseRecoveryCodesFile(filePath)
      return { success: true as const, ...parsed }
    } catch (err) {
      return {
        success: false as const,
        error: err instanceof Error ? err.message : 'Could not read that file.'
      }
    }
  })

  ipcMain.handle('vault:pickCsvFile', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }],
      title: 'Choose an exported passwords CSV file'
    }
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const picked = result.filePaths[0]
    allowDeleteOfPickedFile(picked)
    return picked
  })

  ipcMain.handle('vault:parseLoginsCsv', async (_e, filePath: string) => parseLoginsCsvFile(filePath))

  // Only files previously returned by pickCsvFile may be deleted (one-shot allowlist).
  ipcMain.handle('vault:deleteFile', async (_e, filePath: string) => {
    if (typeof filePath !== 'string' || filePath.length === 0) return false
    const allowed = takeDeletableImportPath(filePath)
    if (!allowed) return false
    try {
      await unlink(allowed)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('vault:exportLoginsCsv', async (_e, ids: string[]) => {
    const ok = await requireAuth('export these passwords')
    if (!ok) return { success: false as const }

    const logins = vaultStore.getLoginsByIds(ids)
    if (logins.length === 0) return { success: false as const }

    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.SaveDialogOptions = {
      title: 'Save exported passwords',
      defaultPath: 'Vaultic Passwords.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { success: false as const }

    await writeFile(result.filePath, loginsToCsv(logins), 'utf8')
    return { success: true as const, filePath: result.filePath }
  })

  // Local-only: computes strength/reuse from plaintext passwords in this
  // process, but only ever returns the derived labels — never the passwords.
  ipcMain.handle('vault:analyzePasswords', () => analyzeLogins(vaultStore.getLoginsForLocalAnalysis()))

  // Local-only: cryptographically random, no AI involved.
  ipcMain.handle('vault:generateStrongPassword', (_e, length?: number) => generateStrongPassword(length))

  ipcMain.handle('vault:checkAiCliAvailable', () => detectAvailableCli())

  // Sends ONLY {id, service, url} to the local CLI — never usernames, passwords, or notes.
  ipcMain.handle('vault:suggestLabelsWithAi', async () => {
    const items = vaultStore.getLoginsMetadata()
    if (items.length === 0) return { success: false as const, error: 'No logins to suggest labels for.' }
    try {
      const existingLabelNames = vaultStore.listLabels().map((l) => l.name)
      const { suggestions, cli, failedCount } = await suggestLabelsWithAi(items, existingLabelNames)
      // Persist immediately (creating any new labels needed) so suggestions survive without recomputation.
      await vaultStore.applySuggestedLabels(
        Object.entries(suggestions).map(([loginId, labelNames]) => ({ loginId, labelNames }))
      )
      return { success: true as const, suggestions, cli, failedCount }
    } catch (err) {
      return { success: false as const, error: err instanceof Error ? err.message : 'AI label suggestion failed.' }
    }
  })

  ipcMain.handle('vault:setLoginFavorite', (_e, id: string, favorite: boolean) =>
    vaultStore.setLoginFavorite(id, favorite)
  )

  ipcMain.handle('vault:listLabels', () => vaultStore.listLabels())
  ipcMain.handle('vault:addLabel', (_e, name: string, color?: string) => vaultStore.addLabel(name, color))
  ipcMain.handle('vault:updateLabel', (_e, id: string, patch: { name: string; color: string }) =>
    vaultStore.updateLabel(id, patch)
  )
  ipcMain.handle('vault:deleteLabel', (_e, id: string) => vaultStore.deleteLabel(id))
  ipcMain.handle('vault:toggleLoginLabel', (_e, loginId: string, labelId: string) =>
    vaultStore.toggleLoginLabel(loginId, labelId)
  )

  ipcMain.handle('vault:updateLoginPassword', async (_e, id: string, newPassword: string) => {
    const ok = await requireAuth('replace this password')
    if (!ok) return false
    await vaultStore.updateLoginPassword(id, newPassword)
    return true
  })

  ipcMain.handle(
    'vault:updateApiKey',
    async (_e, id: string, patch: { project: string; name: string; value: string; notes?: string }) => {
      const ok = await requireAuth('edit this API key')
      if (!ok) return null
      return vaultStore.updateApiKey(id, patch)
    }
  )

  ipcMain.handle(
    'vault:updateLogin',
    async (
      _e,
      id: string,
      patch: {
        service: string
        username: string
        password: string
        url?: string
        notes?: string
        totpSecret?: string | null
      }
    ) => {
      const ok = await requireAuth('edit this login')
      if (!ok) return null
      return vaultStore.updateLogin(id, patch)
    }
  )

  ipcMain.handle(
    'vault:updateRecoveryCode',
    async (_e, id: string, patch: { service: string; codes: string[]; notes?: string }) => {
      const ok = await requireAuth('edit these recovery codes')
      if (!ok) return null
      return vaultStore.updateRecoveryCode(id, patch)
    }
  )

  ipcMain.handle('vault:updateSecureNote', async (_e, id: string, patch: { title: string; content: string }) => {
    const ok = await requireAuth('edit this note')
    if (!ok) return null
    return vaultStore.updateSecureNote(id, patch)
  })

  ipcMain.handle('vault:getSettings', () => readSettings())
  ipcMain.handle('vault:setSettings', (_e, settings: AppSettings) => {
    writeSettings(settings)
    return true
  })

  // Emergency recovery access — a second, independent way to unlock the vault
  // (separate passphrase, separate keyslot) in case the master password is lost.
  ipcMain.handle('vault:hasRecovery', () => vaultStore.hasRecovery())

  ipcMain.handle('vault:setupRecovery', async (_e, passphrase: string) => {
    const ok = await requireAuth('set up emergency recovery access')
    if (!ok) return false
    await vaultStore.setupRecovery(passphrase)
    return true
  })

  ipcMain.handle('vault:clearRecovery', async () => {
    const ok = await requireAuth('turn off emergency recovery access')
    if (!ok) return false
    await vaultStore.clearRecovery()
    return true
  })

  ipcMain.handle('vault:exportRecoveryKit', async () => {
    const ok = await requireAuth('view your recovery kit')
    if (!ok) return null
    return vaultStore.exportRecoveryKit()
  })

  ipcMain.handle('vault:unlockWithRecovery', async (_e, passphrase: string) => {
    try {
      await vaultStore.unlockWithRecovery(passphrase)
      const key = vaultStore.getRawKey()
      if (key) await cacheKey(key)
      return true
    } catch {
      return false
    }
  })

  // Best-effort local automation, not a secret — never gated.
  ipcMain.handle('vault:getFrontmostChromeTabUrl', () => getFrontmostChromeTabUrl())
  ipcMain.handle('vault:getFrontmostBrowserTabUrl', () => getFrontmostBrowserTabUrl())

  ipcMain.handle('vault:getTotpCode', async (_e, id: string) => {
    const ok = await requireAuth('view this one-time code')
    if (!ok) return null
    try {
      return vaultStore.getTotpCode(id)
    } catch {
      return null
    }
  })

  ipcMain.handle('vault:copyTotpCode', async (_e, id: string) => {
    const ok = await requireAuth('copy this one-time code')
    if (!ok) return false
    try {
      const result = vaultStore.getTotpCode(id)
      if (!result) return false
      copyWithAutoClear(result.code)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('vault:revealTotpSecret', async (_e, id: string) => {
    const ok = await requireAuth('view this authenticator secret')
    if (!ok) return null
    return vaultStore.getTotpSecret(id)
  })

  ipcMain.handle('vault:listTrash', () => vaultStore.listTrash())
  ipcMain.handle('vault:restoreTrashItem', (_e, kind: TrashKind, id: string) =>
    vaultStore.restoreTrashItem(kind, id)
  )
  ipcMain.handle('vault:permanentlyDeleteTrashItem', async (_e, kind: TrashKind, id: string) => {
    const ok = await requireAuth('permanently delete this item')
    if (!ok) return false
    await vaultStore.permanentlyDeleteTrashItem(kind, id)
    return true
  })
  ipcMain.handle('vault:emptyTrash', async () => {
    const ok = await requireAuth('empty the trash')
    if (!ok) return -1
    return vaultStore.emptyTrash()
  })

  ipcMain.handle('vault:getStorageInfo', () => vaultStore.getStorageInfo())

  ipcMain.handle('vault:backupVault', async () => {
    const ok = await requireAuth('back up your vault')
    if (!ok) return { success: false as const, error: 'Authentication cancelled' }

    const win = BrowserWindow.getFocusedWindow()
    const stamp = new Date().toISOString().slice(0, 10)
    const options: Electron.SaveDialogOptions = {
      title: 'Back up Vaultic vault',
      defaultPath: `Vaultic-backup-${stamp}.enc`,
      filters: [{ name: 'Vaultic vault', extensions: ['enc'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { success: false as const, error: 'Cancelled' }

    try {
      const paths = await vaultStore.backupVault(result.filePath)
      return { success: true as const, ...paths }
    } catch (err) {
      return { success: false as const, error: err instanceof Error ? err.message : 'Backup failed' }
    }
  })

  ipcMain.handle('vault:pickVaultBackup', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a Vaultic backup',
      properties: ['openFile'],
      filters: [{ name: 'Vaultic vault', extensions: ['enc'] }]
    }
    const pick = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (pick.canceled || pick.filePaths.length === 0) return null
    return pick.filePaths[0]
  })

  ipcMain.handle('vault:restoreVault', async (_e, sourcePath: string, masterPassword: string) => {
    const ok = await requireAuth('restore a vault backup')
    if (!ok) return { success: false as const, error: 'Authentication cancelled' }
    if (typeof sourcePath !== 'string' || typeof masterPassword !== 'string') {
      return { success: false as const, error: 'Invalid restore request' }
    }

    try {
      await vaultStore.restoreVaultFromBackup(sourcePath, masterPassword)
      await clearCachedKey()
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send('vault:autoLocked')
      }
      return { success: true as const }
    } catch (err) {
      return {
        success: false as const,
        error: err instanceof Error ? err.message : 'Restore failed — wrong password or corrupt file'
      }
    }
  })

  ipcMain.handle(
    'vault:changeMasterPassword',
    async (_e, currentPassword: string, newPassword: string, recoveryPassphrase?: string | null) => {
      const ok = await requireAuth('change your master password')
      if (!ok) return { success: false as const, error: 'Authentication cancelled' }
      try {
        const result = await vaultStore.changeMasterPassword(
          currentPassword,
          newPassword,
          recoveryPassphrase
        )
        const key = vaultStore.getRawKey()
        if (key) await cacheKey(key)
        return { success: true as const, recoveryCleared: result.recoveryCleared }
      } catch (err) {
        return {
          success: false as const,
          error: err instanceof Error ? err.message : 'Could not change password'
        }
      }
    }
  )

  ipcMain.handle('vault:getAppInfo', () => ({
    name: app.getName(),
    version: app.getVersion()
  }))

  ipcMain.handle('vault:checkForUpdates', () => {
    const version = app.getVersion()
    return {
      status: 'manual' as const,
      version,
      message: `You're running Vaultic ${version}. Updates are installed manually via a new build — no auto-updater is configured yet.`
    }
  })

  ipcMain.handle('vault:getBridgeInfo', () => getBridgeInfo())
  ipcMain.handle('vault:getNativeHostInfo', () => getNativeHostInstallInfo())
  ipcMain.handle('vault:installNativeHost', () => installNativeMessagingHost())
  ipcMain.handle('vault:openExtensionFolder', async () => {
    const candidates = [
      join(app.getAppPath(), 'extension'),
      join(process.resourcesPath, 'extension'),
      join(__dirname, '../../../extension')
    ]
    const { existsSync } = await import('fs')
    const folder = candidates.find((c) => existsSync(c))
    if (!folder) return { ok: false as const, error: 'Extension folder not found' }
    shell.showItemInFolder(folder)
    return { ok: true as const, path: folder }
  })
}
