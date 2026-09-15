import { contextBridge, ipcRenderer } from 'electron'
import type { VaultAPI } from './api-types'

const vaultAPI: VaultAPI = {
  hasVault: () => ipcRenderer.invoke('vault:hasVault'),
  isUnlocked: () => ipcRenderer.invoke('vault:isUnlocked'),
  create: (masterPassword) => ipcRenderer.invoke('vault:create', masterPassword),
  unlock: (masterPassword) => ipcRenderer.invoke('vault:unlock', masterPassword),
  canUseBiometrics: () => ipcRenderer.invoke('vault:canUseBiometrics'),
  unlockWithBiometrics: () => ipcRenderer.invoke('vault:unlockWithBiometrics'),
  lock: () => ipcRenderer.invoke('vault:lock'),

  listApiKeys: () => ipcRenderer.invoke('vault:listApiKeys'),
  listLogins: () => ipcRenderer.invoke('vault:listLogins'),
  listRecoveryCodes: () => ipcRenderer.invoke('vault:listRecoveryCodes'),
  listSecureNotes: () => ipcRenderer.invoke('vault:listSecureNotes'),

  addApiKey: (entry) => ipcRenderer.invoke('vault:addApiKey', entry),
  addApiKeys: (entries) => ipcRenderer.invoke('vault:addApiKeys', entries),
  addLogin: (entry) => ipcRenderer.invoke('vault:addLogin', entry),
  addLogins: (entries) => ipcRenderer.invoke('vault:addLogins', entries),
  addRecoveryCode: (entry) => ipcRenderer.invoke('vault:addRecoveryCode', entry),
  addRecoveryCodesBatch: (entries) => ipcRenderer.invoke('vault:addRecoveryCodesBatch', entries),
  addSecureNote: (entry) => ipcRenderer.invoke('vault:addSecureNote', entry),

  deleteApiKey: (id) => ipcRenderer.invoke('vault:deleteApiKey', id),
  deleteApiKeysByProject: (project) => ipcRenderer.invoke('vault:deleteApiKeysByProject', project),
  deleteLogin: (id) => ipcRenderer.invoke('vault:deleteLogin', id),
  deleteRecoveryCode: (id) => ipcRenderer.invoke('vault:deleteRecoveryCode', id),
  deleteSecureNote: (id) => ipcRenderer.invoke('vault:deleteSecureNote', id),
  restoreApiKey: (id) => ipcRenderer.invoke('vault:restoreApiKey', id),
  restoreApiKeys: (ids) => ipcRenderer.invoke('vault:restoreApiKeys', ids),
  restoreLogin: (id) => ipcRenderer.invoke('vault:restoreLogin', id),
  restoreRecoveryCode: (id) => ipcRenderer.invoke('vault:restoreRecoveryCode', id),
  restoreSecureNote: (id) => ipcRenderer.invoke('vault:restoreSecureNote', id),

  revealApiKeyValue: (id) => ipcRenderer.invoke('vault:revealApiKeyValue', id),
  revealLoginPassword: (id) => ipcRenderer.invoke('vault:revealLoginPassword', id),
  revealRecoveryCodes: (id) => ipcRenderer.invoke('vault:revealRecoveryCodes', id),
  revealSecureNoteContent: (id) => ipcRenderer.invoke('vault:revealSecureNoteContent', id),
  copyApiKeyValue: (id) => ipcRenderer.invoke('vault:copyApiKeyValue', id),
  copyLoginPassword: (id) => ipcRenderer.invoke('vault:copyLoginPassword', id),
  copyRecoveryCode: (code) => ipcRenderer.invoke('vault:copyRecoveryCode', code),
  copySecureNoteContent: (id) => ipcRenderer.invoke('vault:copySecureNoteContent', id),
  exportLoginsCsv: (ids) => ipcRenderer.invoke('vault:exportLoginsCsv', ids),

  copyToClipboard: (value) => ipcRenderer.invoke('vault:copyToClipboard', value),

  pickFolder: () => ipcRenderer.invoke('vault:pickFolder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('vault:scanFolder', folderPath),
  scanFolderForRecoveryCodes: (folderPath) =>
    ipcRenderer.invoke('vault:scanFolderForRecoveryCodes', folderPath),

  pickRecoveryCodesFile: () => ipcRenderer.invoke('vault:pickRecoveryCodesFile'),
  parseRecoveryCodesFile: (filePath) => ipcRenderer.invoke('vault:parseRecoveryCodesFile', filePath),

  pickCsvFile: () => ipcRenderer.invoke('vault:pickCsvFile'),
  parseLoginsCsv: (filePath) => ipcRenderer.invoke('vault:parseLoginsCsv', filePath),
  deleteFile: (filePath) => ipcRenderer.invoke('vault:deleteFile', filePath),

  analyzePasswords: () => ipcRenderer.invoke('vault:analyzePasswords'),
  generateStrongPassword: (length) => ipcRenderer.invoke('vault:generateStrongPassword', length),

  checkAiCliAvailable: () => ipcRenderer.invoke('vault:checkAiCliAvailable'),
  suggestLabelsWithAi: () => ipcRenderer.invoke('vault:suggestLabelsWithAi'),

  updateLoginPassword: (id, newPassword) => ipcRenderer.invoke('vault:updateLoginPassword', id, newPassword),
  updateApiKey: (id, patch) => ipcRenderer.invoke('vault:updateApiKey', id, patch),
  updateLogin: (id, patch) => ipcRenderer.invoke('vault:updateLogin', id, patch),
  updateRecoveryCode: (id, patch) => ipcRenderer.invoke('vault:updateRecoveryCode', id, patch),
  updateSecureNote: (id, patch) => ipcRenderer.invoke('vault:updateSecureNote', id, patch),

  setLoginFavorite: (id, favorite) => ipcRenderer.invoke('vault:setLoginFavorite', id, favorite),

  listLabels: () => ipcRenderer.invoke('vault:listLabels'),
  addLabel: (name, color) => ipcRenderer.invoke('vault:addLabel', name, color),
  updateLabel: (id, patch) => ipcRenderer.invoke('vault:updateLabel', id, patch),
  deleteLabel: (id) => ipcRenderer.invoke('vault:deleteLabel', id),
  toggleLoginLabel: (loginId, labelId) => ipcRenderer.invoke('vault:toggleLoginLabel', loginId, labelId),

  getSettings: () => ipcRenderer.invoke('vault:getSettings'),
  setSettings: (settings) => ipcRenderer.invoke('vault:setSettings', settings),

  onAutoLocked: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('vault:autoLocked', listener)
    return () => ipcRenderer.removeListener('vault:autoLocked', listener)
  },

  hasRecovery: () => ipcRenderer.invoke('vault:hasRecovery'),
  setupRecovery: (passphrase) => ipcRenderer.invoke('vault:setupRecovery', passphrase),
  clearRecovery: () => ipcRenderer.invoke('vault:clearRecovery'),
  exportRecoveryKit: () => ipcRenderer.invoke('vault:exportRecoveryKit'),
  unlockWithRecovery: (passphrase) => ipcRenderer.invoke('vault:unlockWithRecovery', passphrase),

  getFrontmostChromeTabUrl: () => ipcRenderer.invoke('vault:getFrontmostChromeTabUrl')
}

contextBridge.exposeInMainWorld('vaultAPI', vaultAPI)
