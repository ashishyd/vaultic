import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

let loaded = false

/**
 * Loads `.env.local` / `.env` (Neon's `neon deploy` writes DATABASE_URL etc. there)
 * into `process.env`. Electron doesn't do this automatically for the main process,
 * unlike Vite's `import.meta.env` handling for the renderer. Safe to call repeatedly.
 */
export function ensureEnvLoaded(): void {
  if (loaded) return
  loaded = true
  const candidates = [
    join(process.cwd(), '.env.local'),
    join(process.cwd(), '.env'),
    join(app.getAppPath(), '.env.local'),
    join(app.getAppPath(), '.env')
  ]
  for (const path of candidates) {
    if (existsSync(path)) loadDotenv({ path, override: false })
  }
}
