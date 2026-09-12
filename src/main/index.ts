import { app, shell, BrowserWindow, powerMonitor } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerVaultIpcHandlers } from './vault/ipc-handlers'
import { vaultStore } from './vault/vault-store'
import { readSettings } from './vault/settings'

const IDLE_CHECK_INTERVAL_MS = 10_000

function startAutoLockWatcher(): void {
  setInterval(() => {
    const { autoLockMinutes } = readSettings()
    if (autoLockMinutes <= 0) return
    if (!vaultStore.isUnlocked) return

    const idleSeconds = powerMonitor.getSystemIdleTime()
    if (idleSeconds >= autoLockMinutes * 60) {
      vaultStore.lock()
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('vault:autoLocked')
      }
    }
  }, IDLE_CHECK_INTERVAL_MS)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0B1220',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.vaultic.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerVaultIpcHandlers()
  createWindow()
  startAutoLockWatcher()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
