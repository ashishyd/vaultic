import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export interface AppSettings {
  /** Minutes of inactivity before the vault auto-locks. 0 = never. */
  autoLockMinutes: number
}

const DEFAULT_SETTINGS: AppSettings = { autoLockMinutes: 5 }

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

// Not secret — just a UI preference — so this is a plain unencrypted file,
// separate from vault.enc.
export function readSettings(): AppSettings {
  try {
    const raw = readFileSync(settingsPath(), 'utf8')
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeSettings(settings: AppSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(settings), 'utf8')
}

export function hasSettingsFile(): boolean {
  return existsSync(settingsPath())
}
