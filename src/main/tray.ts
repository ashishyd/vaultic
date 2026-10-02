import { Tray, Menu, nativeImage, BrowserWindow, globalShortcut, app } from 'electron'
import { join } from 'path'
import { vaultStore } from './vault/vault-store'

let tray: Tray | null = null

function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

function rebuildTrayMenu(): void {
  if (!tray) return
  const unlocked = vaultStore.isUnlocked
  const menu = Menu.buildFromTemplate([
    {
      label: unlocked ? 'Vault unlocked' : 'Vault locked',
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Show Vaultic',
      click: () => showMainWindow()
    },
    {
      label: 'Lock vault',
      enabled: unlocked,
      click: () => {
        vaultStore.lock()
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('vault:autoLocked')
        }
        rebuildTrayMenu()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit()
    }
  ])
  tray.setContextMenu(menu)
}

export function setupTrayAndHotkey(): void {
  if (process.platform !== 'darwin') return

  const candidates = [
    join(__dirname, '../../build/icon.png'),
    join(process.resourcesPath, 'icon.png'),
    join(app.getAppPath(), 'build/icon.png')
  ]
  let image = nativeImage.createEmpty()
  for (const candidate of candidates) {
    const next = nativeImage.createFromPath(candidate)
    if (!next.isEmpty()) {
      image = next
      break
    }
  }
  if (!image.isEmpty()) {
    image = image.resize({ width: 18, height: 18 })
    image.setTemplateImage(true)
  }

  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)
  tray.setToolTip('Vaultic')
  tray.on('click', () => showMainWindow())
  rebuildTrayMenu()

  // Refresh menu state when lock/unlock happens from the app.
  setInterval(() => rebuildTrayMenu(), 5000)

  const registered = globalShortcut.register('CommandOrControl+Shift+V', () => {
    showMainWindow()
  })
  if (!registered) {
    console.warn('Could not register ⌘⇧V global hotkey')
  }

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    tray?.destroy()
    tray = null
  })
}

export function refreshTrayMenu(): void {
  rebuildTrayMenu()
}
