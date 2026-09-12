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

  addApiKey: (entry) => ipcRenderer.invoke('vault:addApiKey', entry),
  addApiKeys: (entries) => ipcRenderer.invoke('vault:addApiKeys', entries),
  addLogin: (entry) => ipcRenderer.invoke('vault:addLogin', entry),
  addLogins: (entries) => ipcRenderer.invoke('vault:addLogins', entries),

  deleteApiKey: (id) => ipcRenderer.invoke('vault:deleteApiKey', id),
  deleteLogin: (id) => ipcRenderer.invoke('vault:deleteLogin', id),
  restoreApiKey: (id) => ipcRenderer.invoke('vault:restoreApiKey', id),
  restoreLogin: (id) => ipcRenderer.invoke('vault:restoreLogin', id),

  revealApiKeyValue: (id) => ipcRenderer.invoke('vault:revealApiKeyValue', id),
  revealLoginPassword: (id) => ipcRenderer.invoke('vault:revealLoginPassword', id),
  copyApiKeyValue: (id) => ipcRenderer.invoke('vault:copyApiKeyValue', id),
  copyLoginPassword: (id) => ipcRenderer.invoke('vault:copyLoginPassword', id),
  exportLoginsCsv: (ids) => ipcRenderer.invoke('vault:exportLoginsCsv', ids),

  copyToClipboard: (value) => ipcRenderer.invoke('vault:copyToClipboard', value),

  pickFolder: () => ipcRenderer.invoke('vault:pickFolder'),
  scanFolder: (folderPath) => ipcRenderer.invoke('vault:scanFolder', folderPath),

  pickCsvFile: () => ipcRenderer.invoke('vault:pickCsvFile'),
  parseLoginsCsv: (filePath) => ipcRenderer.invoke('vault:parseLoginsCsv', filePath),
  deleteFile: (filePath) => ipcRenderer.invoke('vault:deleteFile', filePath),

  analyzePasswords: () => ipcRenderer.invoke('vault:analyzePasswords'),
  generateStrongPassword: (length) => ipcRenderer.invoke('vault:generateStrongPassword', length),

  checkAiCliAvailable: () => ipcRenderer.invoke('vault:checkAiCliAvailable'),
  categorizeLoginsWithAi: () => ipcRenderer.invoke('vault:categorizeLoginsWithAi'),

  updateLoginPassword: (id, newPassword) => ipcRenderer.invoke('vault:updateLoginPassword', id, newPassword),
  updateApiKey: (id, patch) => ipcRenderer.invoke('vault:updateApiKey', id, patch),
  updateLogin: (id, patch) => ipcRenderer.invoke('vault:updateLogin', id, patch),

  setLoginFavorite: (id, favorite) => ipcRenderer.invoke('vault:setLoginFavorite', id, favorite),

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
