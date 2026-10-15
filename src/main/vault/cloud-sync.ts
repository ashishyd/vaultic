import { Pool } from 'pg'
import { ensureEnvLoaded } from './env'

// Electron's main process is a single long-running Node process (not serverless/edge),
// so a pooled node-postgres client — reused across calls — is the right driver choice
// (see the Neon docs: "On Neon Functions, use node-postgres, as the functions are
// long-running and reuse the pool across requests" — the same reasoning applies here).
let pool: Pool | null = null
let schemaReady = false

function getPool(): Pool | null {
  ensureEnvLoaded()
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) return null
  if (!pool) pool = new Pool({ connectionString, max: 2 })
  return pool
}

async function ensureSchema(p: Pool): Promise<void> {
  if (schemaReady) return
  await p.query(`
    CREATE TABLE IF NOT EXISTS vault_sync (
      id text PRIMARY KEY,
      vault_json text NOT NULL,
      recovery_json text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  schemaReady = true
}

export function isCloudSyncConfigured(): boolean {
  ensureEnvLoaded()
  return !!process.env.DATABASE_URL
}

export interface CloudSyncStatus {
  configured: boolean
  updatedAt: number | null
  error?: string
}

/** Row's last-synced timestamp, without transferring the (potentially large) blob. */
export async function getCloudSyncStatus(): Promise<CloudSyncStatus> {
  const p = getPool()
  if (!p) return { configured: false, updatedAt: null }
  try {
    await ensureSchema(p)
    const res = await p.query<{ updated_at: Date }>(`SELECT updated_at FROM vault_sync WHERE id = 'default'`)
    return { configured: true, updatedAt: res.rows[0] ? res.rows[0].updated_at.getTime() : null }
  } catch (err) {
    return { configured: true, updatedAt: null, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export interface CloudSyncResult {
  ok: boolean
  error?: string
}

/**
 * Upserts the vault's ciphertext JSON (same bytes as a local `vault.enc` backup —
 * ciphertext only, never anything decrypted) into the single `default` row.
 */
export async function pushVaultToCloud(vaultJson: string, recoveryJson: string | null): Promise<CloudSyncResult> {
  const p = getPool()
  if (!p) return { ok: false, error: 'Cloud sync is not configured (missing DATABASE_URL).' }
  try {
    await ensureSchema(p)
    await p.query(
      `INSERT INTO vault_sync (id, vault_json, recovery_json, updated_at)
       VALUES ('default', $1, $2, now())
       ON CONFLICT (id) DO UPDATE SET vault_json = $1, recovery_json = $2, updated_at = now()`,
      [vaultJson, recoveryJson]
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export type CloudPullResult =
  | { ok: true; vaultJson: string; recoveryJson: string | null; updatedAt: number }
  | { ok: false; error: string }

export async function pullVaultFromCloud(): Promise<CloudPullResult> {
  const p = getPool()
  if (!p) return { ok: false, error: 'Cloud sync is not configured (missing DATABASE_URL).' }
  try {
    await ensureSchema(p)
    const res = await p.query<{ vault_json: string; recovery_json: string | null; updated_at: Date }>(
      `SELECT vault_json, recovery_json, updated_at FROM vault_sync WHERE id = 'default'`
    )
    if (res.rows.length === 0) return { ok: false, error: 'No cloud backup found yet — push one first.' }
    const row = res.rows[0]
    return {
      ok: true,
      vaultJson: row.vault_json,
      recoveryJson: row.recovery_json,
      updatedAt: row.updated_at.getTime()
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
