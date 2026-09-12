import { app } from 'electron'
import { mkdir, readFile, writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  decryptVault,
  decryptWithKey,
  encryptVault,
  encryptVaultWithKey,
  generateSalt,
  deriveKey,
  type EncryptedVault
} from './crypto'

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // permanently purge soft-deletes after 30 days

interface ApiKeyRecord {
  id: string
  project: string
  name: string
  value: string
  notes?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

interface LoginRecord {
  id: string
  service: string
  username: string
  password: string
  url?: string
  notes?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
  favorite?: boolean
  category?: string
}

// Masked shapes sent to the renderer — the secret field never leaves the main
// process except through the explicit, biometric-gated reveal/copy calls.
export interface ApiKeySummary {
  id: string
  project: string
  name: string
  notes?: string
  createdAt: number
  updatedAt: number
}

export interface LoginSummary {
  id: string
  service: string
  username: string
  url?: string
  notes?: string
  createdAt: number
  updatedAt: number
  favorite: boolean
  category?: string
}

function toApiKeySummary(r: ApiKeyRecord): ApiKeySummary {
  return {
    id: r.id,
    project: r.project,
    name: r.name,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? r.createdAt
  }
}

function toLoginSummary(r: LoginRecord): LoginSummary {
  return {
    id: r.id,
    service: r.service,
    username: r.username,
    url: r.url,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? r.createdAt,
    favorite: r.favorite ?? false,
    category: r.category
  }
}

interface VaultData {
  apiKeys: ApiKeyRecord[]
  logins: LoginRecord[]
}

const EMPTY_VAULT: VaultData = { apiKeys: [], logins: [] }

function vaultPath(): string {
  return join(app.getPath('userData'), 'vault.enc')
}

function recoveryPath(): string {
  return join(app.getPath('userData'), 'recovery.enc')
}

class VaultStore {
  private data: VaultData | null = null
  private key: Buffer | null = null
  private salt: Buffer | null = null

  get isUnlocked(): boolean {
    return this.data !== null && this.key !== null
  }

  hasVault(): boolean {
    return existsSync(vaultPath())
  }

  async createVault(masterPassword: string): Promise<void> {
    const salt = generateSalt()
    const key = await deriveKey(masterPassword, salt)
    this.data = { ...EMPTY_VAULT }
    this.key = key
    this.salt = salt
    await this.persist()
  }

  /** Throws on wrong password. */
  async unlock(masterPassword: string): Promise<void> {
    const raw = await readFile(vaultPath(), 'utf8')
    const encrypted: EncryptedVault = JSON.parse(raw)
    const { plaintext, key } = await decryptVault(encrypted, masterPassword)
    this.data = JSON.parse(plaintext)
    this.key = key
    this.salt = Buffer.from(encrypted.salt, 'hex')
    await this.purgeOldTrash()
  }

  /** Unlock using a raw key previously cached in the OS keychain (skips scrypt). */
  async unlockWithKey(key: Buffer): Promise<void> {
    const raw = await readFile(vaultPath(), 'utf8')
    const encrypted: EncryptedVault = JSON.parse(raw)
    const plaintext = decryptWithKey(encrypted, key)
    this.data = JSON.parse(plaintext)
    this.key = key
    this.salt = Buffer.from(encrypted.salt, 'hex')
    await this.purgeOldTrash()
  }

  getRawKey(): Buffer | null {
    return this.key
  }

  lock(): void {
    this.data = null
    this.key = null
    this.salt = null
  }

  hasRecovery(): boolean {
    return existsSync(recoveryPath())
  }

  /**
   * Wraps the vault's raw AES key with a second, independent passphrase —
   * like a second LUKS keyslot. Requires the vault to already be unlocked.
   * From then on, EITHER the master password OR this recovery passphrase can
   * unlock the vault; each is stored/verified completely independently.
   */
  async setupRecovery(passphrase: string): Promise<void> {
    const key = this.getRawKey()
    if (!key) throw new Error('Vault is locked')
    const wrapped = await encryptVault(key.toString('hex'), passphrase)
    await writeFile(recoveryPath(), JSON.stringify(wrapped), 'utf8')
  }

  async clearRecovery(): Promise<void> {
    if (existsSync(recoveryPath())) await unlink(recoveryPath())
  }

  /** Returns the recovery keyslot's raw JSON so it can be backed up externally (e.g. printed). */
  async exportRecoveryKit(): Promise<string | null> {
    if (!existsSync(recoveryPath())) return null
    return readFile(recoveryPath(), 'utf8')
  }

  /** Throws on wrong recovery passphrase, or if recovery was never set up. */
  async unlockWithRecovery(passphrase: string): Promise<void> {
    if (!existsSync(recoveryPath())) throw new Error('Recovery access is not set up.')
    const raw = await readFile(recoveryPath(), 'utf8')
    const wrapped: EncryptedVault = JSON.parse(raw)
    const { plaintext: rawKeyHex } = await decryptVault(wrapped, passphrase)
    await this.unlockWithKey(Buffer.from(rawKeyHex, 'hex'))
  }

  private ensureUnlocked(): VaultData {
    if (!this.data || !this.key || !this.salt) throw new Error('Vault is locked')
    return this.data
  }

  private async persist(): Promise<void> {
    if (!this.data || !this.key || !this.salt) throw new Error('Vault is locked')
    const dir = app.getPath('userData')
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    const plaintext = JSON.stringify(this.data)
    const encrypted = await encryptVaultWithKey(plaintext, this.key, this.salt)
    await writeFile(vaultPath(), JSON.stringify(encrypted), 'utf8')
  }

  /** Permanently drops anything soft-deleted more than 30 days ago. Runs on every unlock. */
  private async purgeOldTrash(): Promise<void> {
    const data = this.ensureUnlocked()
    const cutoff = Date.now() - TRASH_RETENTION_MS
    const before = data.apiKeys.length + data.logins.length
    data.apiKeys = data.apiKeys.filter((k) => !k.deletedAt || k.deletedAt > cutoff)
    data.logins = data.logins.filter((l) => !l.deletedAt || l.deletedAt > cutoff)
    if (data.apiKeys.length + data.logins.length !== before) {
      await this.persist()
    }
  }

  listApiKeys(): ApiKeySummary[] {
    return this.ensureUnlocked()
      .apiKeys.filter((k) => !k.deletedAt)
      .map(toApiKeySummary)
  }

  listLogins(): LoginSummary[] {
    return this.ensureUnlocked()
      .logins.filter((l) => !l.deletedAt)
      .map(toLoginSummary)
  }

  /** Biometric-gated in ipc-handlers before this is called. */
  getApiKeyValue(id: string): string | null {
    const data = this.ensureUnlocked()
    return data.apiKeys.find((k) => k.id === id)?.value ?? null
  }

  /** Biometric-gated in ipc-handlers before this is called. */
  getLoginPassword(id: string): string | null {
    const data = this.ensureUnlocked()
    return data.logins.find((l) => l.id === id)?.password ?? null
  }

  /** Biometric-gated in ipc-handlers before this is called (used for bulk export). */
  getLoginsByIds(
    ids: string[]
  ): Array<{ service: string; url?: string; username: string; password: string; notes?: string }> {
    const data = this.ensureUnlocked()
    const idSet = new Set(ids)
    return data.logins
      .filter((l) => idSet.has(l.id))
      .map((l) => ({ service: l.service, url: l.url, username: l.username, password: l.password, notes: l.notes }))
  }

  async addApiKey(entry: Omit<ApiKeyRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiKeySummary> {
    const data = this.ensureUnlocked()
    const now = Date.now()
    const full: ApiKeyRecord = { ...entry, id: randomUUID(), createdAt: now, updatedAt: now }
    data.apiKeys.push(full)
    await this.persist()
    return toApiKeySummary(full)
  }

  async addApiKeys(entries: Array<Omit<ApiKeyRecord, 'id' | 'createdAt' | 'updatedAt'>>): Promise<ApiKeySummary[]> {
    const data = this.ensureUnlocked()
    const now = Date.now()
    const full = entries.map((e) => ({ ...e, id: randomUUID(), createdAt: now, updatedAt: now }))
    data.apiKeys.push(...full)
    await this.persist()
    return full.map(toApiKeySummary)
  }

  async addLogin(entry: Omit<LoginRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<LoginSummary> {
    const data = this.ensureUnlocked()
    const now = Date.now()
    const full: LoginRecord = { ...entry, id: randomUUID(), createdAt: now, updatedAt: now }
    data.logins.push(full)
    await this.persist()
    return toLoginSummary(full)
  }

  async addLogins(entries: Array<Omit<LoginRecord, 'id' | 'createdAt' | 'updatedAt'>>): Promise<LoginSummary[]> {
    const data = this.ensureUnlocked()
    const now = Date.now()
    const full = entries.map((e) => ({ ...e, id: randomUUID(), createdAt: now, updatedAt: now }))
    data.logins.push(...full)
    await this.persist()
    return full.map(toLoginSummary)
  }

  /** Soft-delete — kept in storage so it can be restored (undo), swept after 30 days. */
  async deleteApiKey(id: string): Promise<void> {
    const data = this.ensureUnlocked()
    const key = data.apiKeys.find((k) => k.id === id)
    if (key) key.deletedAt = Date.now()
    await this.persist()
  }

  async restoreApiKey(id: string): Promise<void> {
    const data = this.ensureUnlocked()
    const key = data.apiKeys.find((k) => k.id === id)
    if (key) key.deletedAt = undefined
    await this.persist()
  }

  /** Soft-delete — kept in storage so it can be restored (undo), swept after 30 days. */
  async deleteLogin(id: string): Promise<void> {
    const data = this.ensureUnlocked()
    const login = data.logins.find((l) => l.id === id)
    if (login) login.deletedAt = Date.now()
    await this.persist()
  }

  async restoreLogin(id: string): Promise<void> {
    const data = this.ensureUnlocked()
    const login = data.logins.find((l) => l.id === id)
    if (login) login.deletedAt = undefined
    await this.persist()
  }

  /**
   * Plaintext passwords + timestamps for local-only analysis (strength/reuse/age
   * scoring). The caller must never forward the password itself — only derived
   * labels (e.g. "weak", "reused", "stale") may cross back over IPC.
   */
  getLoginsForLocalAnalysis(): Array<{ id: string; password: string; updatedAt: number }> {
    const data = this.ensureUnlocked()
    return data.logins
      .filter((l) => !l.deletedAt)
      .map((l) => ({ id: l.id, password: l.password, updatedAt: l.updatedAt ?? l.createdAt }))
  }

  /** Metadata-only view for AI categorization — never includes username/password/notes. */
  getLoginsMetadata(): Array<{ id: string; service: string; url?: string }> {
    const data = this.ensureUnlocked()
    return data.logins.filter((l) => !l.deletedAt).map((l) => ({ id: l.id, service: l.service, url: l.url }))
  }

  /** Biometric-gated in ipc-handlers before this is called. */
  async updateLoginPassword(id: string, newPassword: string): Promise<void> {
    const data = this.ensureUnlocked()
    const login = data.logins.find((l) => l.id === id)
    if (!login) throw new Error('Login not found')
    login.password = newPassword
    login.updatedAt = Date.now()
    await this.persist()
  }

  /** Biometric-gated in ipc-handlers before this is called (edit flow needs the current value prefilled). */
  async updateApiKey(
    id: string,
    patch: { project: string; name: string; value: string; notes?: string }
  ): Promise<ApiKeySummary> {
    const data = this.ensureUnlocked()
    const key = data.apiKeys.find((k) => k.id === id)
    if (!key) throw new Error('API key not found')
    key.project = patch.project
    key.name = patch.name
    key.value = patch.value
    key.notes = patch.notes
    key.updatedAt = Date.now()
    await this.persist()
    return toApiKeySummary(key)
  }

  /** Biometric-gated in ipc-handlers before this is called (edit flow needs the current password prefilled). */
  async updateLogin(
    id: string,
    patch: { service: string; username: string; password: string; url?: string; notes?: string }
  ): Promise<LoginSummary> {
    const data = this.ensureUnlocked()
    const login = data.logins.find((l) => l.id === id)
    if (!login) throw new Error('Login not found')
    login.service = patch.service
    login.username = patch.username
    login.password = patch.password
    login.url = patch.url
    login.notes = patch.notes
    login.updatedAt = Date.now()
    await this.persist()
    return toLoginSummary(login)
  }

  async setLoginFavorite(id: string, favorite: boolean): Promise<LoginSummary> {
    const data = this.ensureUnlocked()
    const login = data.logins.find((l) => l.id === id)
    if (!login) throw new Error('Login not found')
    login.favorite = favorite
    await this.persist()
    return toLoginSummary(login)
  }

  /** Persists AI-assigned categories so they survive without recomputation. */
  async setLoginCategories(entries: Array<{ id: string; category: string }>): Promise<void> {
    const data = this.ensureUnlocked()
    const categoryById = new Map(entries.map((e) => [e.id, e.category]))
    for (const login of data.logins) {
      const category = categoryById.get(login.id)
      if (category) login.category = category
    }
    await this.persist()
  }
}

export const vaultStore = new VaultStore()
