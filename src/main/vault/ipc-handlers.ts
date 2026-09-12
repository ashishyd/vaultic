import { ipcMain, clipboard, dialog, BrowserWindow } from 'electron'
import { unlink, writeFile } from 'fs/promises'
import { vaultStore } from './vault-store'
import { cacheKey, readCachedKey } from './keychain'
import { scanForEnvFiles } from './scanner'
import { isBiometricsAvailable, biometricGate } from './biometric'
import { parseLoginsCsvFile, loginsToCsv } from './csv'
import { analyzeLogins, generateStrongPassword } from './password-strength'
import { suggestLabelsWithAi, detectAvailableCli } from './ai-cli'
import { readSettings, writeSettings, type AppSettings } from './settings'
import { getFrontmostChromeTabUrl } from './chrome'

const CLIPBOARD_CLEAR_MS = 30_000

function copyWithAutoClear(value: string): void {
  clipboard.writeText(value)
  setTimeout(() => {
    if (clipboard.readText() === value) clipboard.writeText('')
  }, CLIPBOARD_CLEAR_MS)
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

  /** Prompts Touch ID, then unlocks using the OS keychain-cached key. Used on app launch. */
  ipcMain.handle('vault:unlockWithBiometrics', async () => {
    if (!vaultStore.hasVault()) return false
    const cachedKey = await readCachedKey()
    if (!cachedKey) return false
    if (!isBiometricsAvailable()) return false
    const ok = await biometricGate('unlock Vaultic')
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

  ipcMain.handle(
    'vault:addApiKey',
    (_e, entry: { project: string; name: string; value: string; notes?: string }) =>
      vaultStore.addApiKey(entry)
  )

  ipcMain.handle(
    'vault:addApiKeys',
    (_e, entries: Array<{ project: string; name: string; value: string; notes?: string }>) =>
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

  // Soft-delete — supports the Undo action shown in the toast after a delete.
  ipcMain.handle('vault:deleteApiKey', (_e, id: string) => vaultStore.deleteApiKey(id))
  ipcMain.handle('vault:deleteLogin', (_e, id: string) => vaultStore.deleteLogin(id))
  ipcMain.handle('vault:restoreApiKey', (_e, id: string) => vaultStore.restoreApiKey(id))
  ipcMain.handle('vault:restoreLogin', (_e, id: string) => vaultStore.restoreLogin(id))

  ipcMain.handle('vault:revealApiKeyValue', async (_e, id: string) => {
    const ok = await biometricGate('view this API key value')
    if (!ok) return null
    return vaultStore.getApiKeyValue(id)
  })

  ipcMain.handle('vault:revealLoginPassword', async (_e, id: string) => {
    const ok = await biometricGate('view this password')
    if (!ok) return null
    return vaultStore.getLoginPassword(id)
  })

  ipcMain.handle('vault:copyApiKeyValue', async (_e, id: string) => {
    const ok = await biometricGate('copy this API key value')
    if (!ok) return false
    const value = vaultStore.getApiKeyValue(id)
    if (!value) return false
    copyWithAutoClear(value)
    return true
  })

  ipcMain.handle('vault:copyLoginPassword', async (_e, id: string) => {
    const ok = await biometricGate('copy this password')
    if (!ok) return false
    const password = vaultStore.getLoginPassword(id)
    if (!password) return false
    copyWithAutoClear(password)
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
    return result.filePaths[0]
  })

  ipcMain.handle('vault:parseLoginsCsv', async (_e, filePath: string) => parseLoginsCsvFile(filePath))

  ipcMain.handle('vault:deleteFile', async (_e, filePath: string) => {
    await unlink(filePath)
    return true
  })

  ipcMain.handle('vault:exportLoginsCsv', async (_e, ids: string[]) => {
    const ok = await biometricGate('export these passwords')
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
    const ok = await biometricGate('replace this password')
    if (!ok) return false
    await vaultStore.updateLoginPassword(id, newPassword)
    return true
  })

  ipcMain.handle(
    'vault:updateApiKey',
    async (_e, id: string, patch: { project: string; name: string; value: string; notes?: string }) => {
      const ok = await biometricGate('edit this API key')
      if (!ok) return null
      return vaultStore.updateApiKey(id, patch)
    }
  )

  ipcMain.handle(
    'vault:updateLogin',
    async (
      _e,
      id: string,
      patch: { service: string; username: string; password: string; url?: string; notes?: string }
    ) => {
      const ok = await biometricGate('edit this login')
      if (!ok) return null
      return vaultStore.updateLogin(id, patch)
    }
  )

  ipcMain.handle('vault:getSettings', () => readSettings())
  ipcMain.handle('vault:setSettings', (_e, settings: AppSettings) => {
    writeSettings(settings)
    return true
  })

  // Emergency recovery access — a second, independent way to unlock the vault
  // (separate passphrase, separate keyslot) in case the master password is lost.
  ipcMain.handle('vault:hasRecovery', () => vaultStore.hasRecovery())

  ipcMain.handle('vault:setupRecovery', async (_e, passphrase: string) => {
    const ok = await biometricGate('set up emergency recovery access')
    if (!ok) return false
    await vaultStore.setupRecovery(passphrase)
    return true
  })

  ipcMain.handle('vault:clearRecovery', async () => {
    const ok = await biometricGate('turn off emergency recovery access')
    if (!ok) return false
    await vaultStore.clearRecovery()
    return true
  })

  ipcMain.handle('vault:exportRecoveryKit', async () => {
    const ok = await biometricGate('view your recovery kit')
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
}
