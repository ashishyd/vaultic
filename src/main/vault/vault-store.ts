import { app } from 'electron'
import { mkdir, readFile, writeFile, unlink, open, rename, copyFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { randomUUID, timingSafeEqual } from 'crypto'
import {
  decryptVault,
  decryptWithKey,
  encryptVault,
  encryptVaultWithKey,
  generateSalt,
  deriveKey,
  type EncryptedVault
} from './crypto'
import { generateTotpCode, normalizeTotpSecret } from './totp'

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // permanently purge soft-deletes after 30 days
const TRASH_RETENTION_MS_INTERNAL = TRASH_RETENTION_MS

interface ApiKeyRecord {
  id: string
  project: string
  name: string
  value: string
  notes?: string
  /** Basename of the .env file this key was imported from (e.g. ".env", ".env.local"). Unset for manually-added keys. */
  envFile?: string
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
  /** Base32 TOTP secret (or normalized from otpauth URI). Never sent in list summaries. */
  totpSecret?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
  favorite?: boolean
  labelIds?: string[]
}

interface LabelRecord {
  id: string
  name: string
  color: string // hex, e.g. #2DD4BF
  createdAt: number
}

interface RecoveryCodeRecord {
  id: string
  service: string
  codes: string[]
  notes?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

interface SecureNoteRecord {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export interface LabelSummary {
  id: string
  name: string
  color: string
  createdAt: number
}

// Rotated through when a label is created without an explicit color (e.g. AI suggestions).
const LABEL_COLOR_PALETTE = [
  '#2DD4BF', // teal
  '#F59E0B', // amber
  '#F87171', // red
  '#A78BFA', // violet
  '#60A5FA', // blue
  '#34D399', // green
  '#F472B6', // pink
  '#FBBF24', // yellow
  '#818CF8', // indigo
  '#FB923C' // orange
]

// Masked shapes sent to the renderer — the secret field never leaves the main
// process except through the explicit, biometric-gated reveal/copy calls.
export interface ApiKeySummary {
  id: string
  project: string
  name: string
  notes?: string
  envFile?: string
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
  labelIds: string[]
  hasTotp: boolean
}

export type TrashKind = 'key' | 'login' | 'recovery' | 'note'

export interface TrashItem {
  kind: TrashKind
  id: string
  title: string
  subtitle: string
  deletedAt: number
  expiresAt: number
}

export interface StorageInfo {
  vaultPath: string
  vaultBytes: number
  recoveryEnabled: boolean
  trashCount: number
  retentionDays: number
  counts: {
    apiKeys: number
    logins: number
    recoveryCodes: number
    secureNotes: number
  }
}

export interface RecoveryCodeSummary {
  id: string
  service: string
  codeCount: number
  notes?: string
  createdAt: number
  updatedAt: number
}

export interface SecureNoteSummary {
  id: string
  title: string
  contentLength: number
  createdAt: number
  updatedAt: number
}

function toApiKeySummary(r: ApiKeyRecord): ApiKeySummary {
  return {
    id: r.id,
    project: r.project,
    name: r.name,
    notes: r.notes,
    envFile: r.envFile,
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
    labelIds: r.labelIds ?? [],
    hasTotp: Boolean(r.totpSecret)
  }
}

function toLabelSummary(r: LabelRecord): LabelSummary {
  return { id: r.id, name: r.name, color: r.color, createdAt: r.createdAt }
}

function toRecoveryCodeSummary(r: RecoveryCodeRecord): RecoveryCodeSummary {
  return {
    id: r.id,
    service: r.service,
    codeCount: r.codes.length,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? r.createdAt
  }
}

function toSecureNoteSummary(r: SecureNoteRecord): SecureNoteSummary {
  return {
    id: r.id,
    title: r.title,
    contentLength: r.content.length,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt ?? r.createdAt
  }
}

interface VaultData {
  apiKeys: ApiKeyRecord[]
  logins: LoginRecord[]
  labels: LabelRecord[]
  recoveryCodes: RecoveryCodeRecord[]
  secureNotes: SecureNoteRecord[]
}

const EMPTY_VAULT: VaultData = {
  apiKeys: [],
  logins: [],
  labels: [],
  recoveryCodes: [],
  secureNotes: []
}

function vaultPath(): string {
  return join(app.getPath('userData'), 'vault.enc')
}

function recoveryPath(): string {
  return join(app.getPath('userData'), 'recovery.enc')
}

/**
 * Write then rename so a crash mid-write cannot leave a truncated vault.enc.
 * Same-filesystem rename is atomic on macOS.
 */
async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`
  await writeFile(tmpPath, contents, 'utf8')
  const handle = await open(tmpPath, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(tmpPath, filePath)
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
    const data: VaultData = JSON.parse(plaintext)
    if (!data.labels) data.labels = [] // vaults created before labels existed
    if (!data.recoveryCodes) data.recoveryCodes = [] // vaults created before recovery codes existed
    if (!data.secureNotes) data.secureNotes = [] // vaults created before secure notes existed
    this.data = data
    this.key = key
    this.salt = Buffer.from(encrypted.salt, 'hex')
    await this.purgeOldTrash()
  }

  /** Unlock using a raw key previously cached in the OS keychain (skips scrypt). */
  async unlockWithKey(key: Buffer): Promise<void> {
    const raw = await readFile(vaultPath(), 'utf8')
    const encrypted: EncryptedVault = JSON.parse(raw)
    const plaintext = decryptWithKey(encrypted, key)
    const data: VaultData = JSON.parse(plaintext)
    if (!data.labels) data.labels = [] // vaults created before labels existed
    if (!data.recoveryCodes) data.recoveryCodes = [] // vaults created before recovery codes existed
    if (!data.secureNotes) data.secureNotes = [] // vaults created before secure notes existed
    this.data = data
    this.key = key
    this.salt = Buffer.from(encrypted.salt, 'hex')
    await this.purgeOldTrash()
  }

  getRawKey(): Buffer | null {
    return this.key
  }

  /**
   * Re-derives the vault key from the given password and compares it to the
   * currently unlocked key. Used as a Touch ID fallback for sensitive actions.
   */
  async verifyMasterPassword(masterPassword: string): Promise<boolean> {
    if (!this.key || !this.salt) return false
    const derived = await deriveKey(masterPassword, this.salt)
    if (derived.length !== this.key.length) return false
    return timingSafeEqual(derived, this.key)
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
    await writeFileAtomic(recoveryPath(), JSON.stringify(wrapped))
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
    await writeFileAtomic(vaultPath(), JSON.stringify(encrypted))
  }

  /** Permanently drops anything soft-deleted more than 30 days ago. Runs on every unlock. */
  private async purgeOldTrash(): Promise<void> {
    const data = this.ensureUnlocked()
    const cutoff = Date.now() - TRASH_RETENTION_MS_INTERNAL
    const before =
      data.apiKeys.length + data.logins.length + data.recoveryCodes.length + data.secureNotes.length
    data.apiKeys = data.apiKeys.filter((k) => !k.deletedAt || k.deletedAt > cutoff)
    data.logins = data.logins.filter((l) => !l.deletedAt || l.deletedAt > cutoff)
    data.recoveryCodes = data.recoveryCodes.filter((r) => !r.deletedAt || r.deletedAt > cutoff)
    data.secureNotes = data.secureNotes.filter((n) => !n.deletedAt || n.deletedAt > cutoff)
    if (data.apiKeys.length + data.logins.length + data.recoveryCodes.length + data.secureNotes.length !== before) {
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

  listRecoveryCodes(): RecoveryCodeSummary[] {
    return this.ensureUnlocked()
      .recoveryCodes.filter((r) => !r.deletedAt)
      .map(toRecoveryCodeSummary)
  }

  listSecureNotes(): SecureNoteSummary[] {
    return this.ensureUnlocked()
      .secureNotes.filter((n) => !n.deletedAt)
      .map(toSecureNoteSummary)
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

  /** Biometric-gated in ipc-handlers before this is called. */
  getRecoveryCodes(id: string): string[] | null {
    const data = this.ensureUnlocked()
    return data.recoveryCodes.find((r) => r.id === id)?.codes ?? null
  }

  /** Biometric-gated in ipc-handlers before this is called. */
  getSecureNoteContent(id: string): string | null {
    const data = this.ensureUnlocked()
    return data.secureNotes.find((n) => n.id === id)?.content ?? null
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
    let totpSecret = entry.totpSecret
    if (totpSecret) {
      const normalized = normalizeTotpSecret(totpSecret)
      if (!normalized) throw new Error('Invalid TOTP secret')
      totpSecret = normalized
    }
    const full: LoginRecord = {
      ...entry,
      totpSecret,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now
    }
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

  async addRecoveryCode(
    entry: Omit<RecoveryCodeRecord, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<RecoveryCodeSummary> {
    const data = this.ensureUnlocked()
    const now = Date.now()
    const full: RecoveryCodeRecord = { ...entry, id: randomUUID(), createdAt: now, updatedAt: now }
    data.recoveryCodes.push(full)
    await this.persist()
    return toRecoveryCodeSummary(full)
  }

  async addRecoveryCodesBatch(
    entries: Array<Omit<RecoveryCodeRecord, 'id' | 'createdAt' | 'updatedAt'>>
  ): Promise<RecoveryCodeSummary[]> {
    const data = this.ensureUnlocked()
    const now = Date.now()
    const full = entries.map((e) => ({ ...e, id: randomUUID(), createdAt: now, updatedAt: now }))
    data.recoveryCodes.push(...full)
    await this.persist()
    return full.map(toRecoveryCodeSummary)
  }

  async addSecureNote(entry: Omit<SecureNoteRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<SecureNoteSummary> {
    const data = this.ensureUnlocked()
    const now = Date.now()
    const full: SecureNoteRecord = { ...entry, id: randomUUID(), createdAt: now, updatedAt: now }
    data.secureNotes.push(full)
    await this.persist()
    return toSecureNoteSummary(full)
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

  /** Soft-deletes every non-deleted key in a project. Returns the deleted ids for undo. */
  async deleteApiKeysByProject(project: string): Promise<string[]> {
    const data = this.ensureUnlocked()
    const now = Date.now()
    const ids: string[] = []
    for (const key of data.apiKeys) {
      if (key.project === project && !key.deletedAt) {
        key.deletedAt = now
        ids.push(key.id)
      }
    }
    await this.persist()
    return ids
  }

  async restoreApiKeys(ids: string[]): Promise<void> {
    const data = this.ensureUnlocked()
    const idSet = new Set(ids)
    for (const key of data.apiKeys) {
      if (idSet.has(key.id)) key.deletedAt = undefined
    }
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

  /** Soft-delete — kept in storage so it can be restored (undo), swept after 30 days. */
  async deleteRecoveryCode(id: string): Promise<void> {
    const data = this.ensureUnlocked()
    const entry = data.recoveryCodes.find((r) => r.id === id)
    if (entry) entry.deletedAt = Date.now()
    await this.persist()
  }

  async restoreRecoveryCode(id: string): Promise<void> {
    const data = this.ensureUnlocked()
    const entry = data.recoveryCodes.find((r) => r.id === id)
    if (entry) entry.deletedAt = undefined
    await this.persist()
  }

  /** Soft-delete — kept in storage so it can be restored (undo), swept after 30 days. */
  async deleteSecureNote(id: string): Promise<void> {
    const data = this.ensureUnlocked()
    const note = data.secureNotes.find((n) => n.id === id)
    if (note) note.deletedAt = Date.now()
    await this.persist()
  }

  async restoreSecureNote(id: string): Promise<void> {
    const data = this.ensureUnlocked()
    const note = data.secureNotes.find((n) => n.id === id)
    if (note) note.deletedAt = undefined
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
    patch: {
      service: string
      username: string
      password: string
      url?: string
      notes?: string
      /** Pass null to clear; omit to leave unchanged; string to set/replace. */
      totpSecret?: string | null
    }
  ): Promise<LoginSummary> {
    const data = this.ensureUnlocked()
    const login = data.logins.find((l) => l.id === id)
    if (!login) throw new Error('Login not found')
    login.service = patch.service
    login.username = patch.username
    login.password = patch.password
    login.url = patch.url
    login.notes = patch.notes
    if (patch.totpSecret !== undefined) {
      if (patch.totpSecret === null || patch.totpSecret === '') {
        delete login.totpSecret
      } else {
        const normalized = normalizeTotpSecret(patch.totpSecret)
        if (!normalized) throw new Error('Invalid TOTP secret')
        login.totpSecret = normalized
      }
    }
    login.updatedAt = Date.now()
    await this.persist()
    return toLoginSummary(login)
  }

  /** Biometric-gated in ipc-handlers before this is called (edit flow needs the current codes prefilled). */
  async updateRecoveryCode(
    id: string,
    patch: { service: string; codes: string[]; notes?: string }
  ): Promise<RecoveryCodeSummary> {
    const data = this.ensureUnlocked()
    const entry = data.recoveryCodes.find((r) => r.id === id)
    if (!entry) throw new Error('Recovery codes not found')
    entry.service = patch.service
    entry.codes = patch.codes
    entry.notes = patch.notes
    entry.updatedAt = Date.now()
    await this.persist()
    return toRecoveryCodeSummary(entry)
  }

  /** Biometric-gated in ipc-handlers before this is called (edit flow needs the current content prefilled). */
  async updateSecureNote(id: string, patch: { title: string; content: string }): Promise<SecureNoteSummary> {
    const data = this.ensureUnlocked()
    const note = data.secureNotes.find((n) => n.id === id)
    if (!note) throw new Error('Secure note not found')
    note.title = patch.title
    note.content = patch.content
    note.updatedAt = Date.now()
    await this.persist()
    return toSecureNoteSummary(note)
  }

  async setLoginFavorite(id: string, favorite: boolean): Promise<LoginSummary> {
    const data = this.ensureUnlocked()
    const login = data.logins.find((l) => l.id === id)
    if (!login) throw new Error('Login not found')
    login.favorite = favorite
    await this.persist()
    return toLoginSummary(login)
  }

  listLabels(): LabelSummary[] {
    return this.ensureUnlocked()
      .labels.slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(toLabelSummary)
  }

  async addLabel(name: string, color?: string): Promise<LabelSummary> {
    const data = this.ensureUnlocked()
    const full: LabelRecord = {
      id: randomUUID(),
      name: name.trim(),
      color: color ?? LABEL_COLOR_PALETTE[data.labels.length % LABEL_COLOR_PALETTE.length],
      createdAt: Date.now()
    }
    data.labels.push(full)
    await this.persist()
    return toLabelSummary(full)
  }

  async updateLabel(id: string, patch: { name: string; color: string }): Promise<LabelSummary> {
    const data = this.ensureUnlocked()
    const label = data.labels.find((l) => l.id === id)
    if (!label) throw new Error('Label not found')
    label.name = patch.name.trim()
    label.color = patch.color
    await this.persist()
    return toLabelSummary(label)
  }

  /** Removing a label also strips it from every login it was assigned to. */
  async deleteLabel(id: string): Promise<void> {
    const data = this.ensureUnlocked()
    data.labels = data.labels.filter((l) => l.id !== id)
    for (const login of data.logins) {
      if (login.labelIds?.includes(id)) {
        login.labelIds = login.labelIds.filter((labelId) => labelId !== id)
      }
    }
    await this.persist()
  }

  async toggleLoginLabel(loginId: string, labelId: string): Promise<LoginSummary> {
    const data = this.ensureUnlocked()
    const login = data.logins.find((l) => l.id === loginId)
    if (!login) throw new Error('Login not found')
    const current = login.labelIds ?? []
    login.labelIds = current.includes(labelId)
      ? current.filter((id) => id !== labelId)
      : [...current, labelId]
    await this.persist()
    return toLoginSummary(login)
  }

  /**
   * Applies AI-suggested label names to logins, creating any label that
   * doesn't already exist (case-insensitive match) and unioning label ids
   * onto each login rather than overwriting its existing labels.
   */
  async applySuggestedLabels(suggestions: Array<{ loginId: string; labelNames: string[] }>): Promise<void> {
    const data = this.ensureUnlocked()
    const byLowerName = new Map(data.labels.map((l) => [l.name.toLowerCase(), l]))

    for (const { loginId, labelNames } of suggestions) {
      const login = data.logins.find((l) => l.id === loginId)
      if (!login) continue

      const labelIds = new Set(login.labelIds ?? [])
      for (const rawName of labelNames) {
        const name = rawName.trim()
        if (!name) continue
        let label = byLowerName.get(name.toLowerCase())
        if (!label) {
          label = {
            id: randomUUID(),
            name,
            color: LABEL_COLOR_PALETTE[data.labels.length % LABEL_COLOR_PALETTE.length],
            createdAt: Date.now()
          }
          data.labels.push(label)
          byLowerName.set(name.toLowerCase(), label)
        }
        labelIds.add(label.id)
      }
      login.labelIds = [...labelIds]
    }
    await this.persist()
  }

  getTotpSecret(id: string): string | null {
    const login = this.ensureUnlocked().logins.find((l) => l.id === id && !l.deletedAt)
    return login?.totpSecret ?? null
  }

  getTotpCode(id: string): { code: string; remainingSeconds: number } | null {
    const secret = this.getTotpSecret(id)
    if (!secret) return null
    return generateTotpCode(secret)
  }

  listTrash(): TrashItem[] {
    const data = this.ensureUnlocked()
    const items: TrashItem[] = []
    const retention = TRASH_RETENTION_MS_INTERNAL

    for (const k of data.apiKeys) {
      if (!k.deletedAt) continue
      items.push({
        kind: 'key',
        id: k.id,
        title: k.name,
        subtitle: k.project,
        deletedAt: k.deletedAt,
        expiresAt: k.deletedAt + retention
      })
    }
    for (const l of data.logins) {
      if (!l.deletedAt) continue
      items.push({
        kind: 'login',
        id: l.id,
        title: l.service,
        subtitle: l.username || '(no username)',
        deletedAt: l.deletedAt,
        expiresAt: l.deletedAt + retention
      })
    }
    for (const r of data.recoveryCodes) {
      if (!r.deletedAt) continue
      items.push({
        kind: 'recovery',
        id: r.id,
        title: r.service,
        subtitle: `${r.codes.length} code${r.codes.length === 1 ? '' : 's'}`,
        deletedAt: r.deletedAt,
        expiresAt: r.deletedAt + retention
      })
    }
    for (const n of data.secureNotes) {
      if (!n.deletedAt) continue
      items.push({
        kind: 'note',
        id: n.id,
        title: n.title,
        subtitle: 'Secure note',
        deletedAt: n.deletedAt,
        expiresAt: n.deletedAt + retention
      })
    }

    return items.sort((a, b) => b.deletedAt - a.deletedAt)
  }

  async restoreTrashItem(kind: TrashKind, id: string): Promise<void> {
    if (kind === 'key') await this.restoreApiKey(id)
    else if (kind === 'login') await this.restoreLogin(id)
    else if (kind === 'recovery') await this.restoreRecoveryCode(id)
    else await this.restoreSecureNote(id)
  }

  async permanentlyDeleteTrashItem(kind: TrashKind, id: string): Promise<void> {
    const data = this.ensureUnlocked()
    if (kind === 'key') data.apiKeys = data.apiKeys.filter((k) => k.id !== id)
    else if (kind === 'login') data.logins = data.logins.filter((l) => l.id !== id)
    else if (kind === 'recovery') data.recoveryCodes = data.recoveryCodes.filter((r) => r.id !== id)
    else data.secureNotes = data.secureNotes.filter((n) => n.id !== id)
    await this.persist()
  }

  async emptyTrash(): Promise<number> {
    const data = this.ensureUnlocked()
    const before =
      data.apiKeys.length + data.logins.length + data.recoveryCodes.length + data.secureNotes.length
    data.apiKeys = data.apiKeys.filter((k) => !k.deletedAt)
    data.logins = data.logins.filter((l) => !l.deletedAt)
    data.recoveryCodes = data.recoveryCodes.filter((r) => !r.deletedAt)
    data.secureNotes = data.secureNotes.filter((n) => !n.deletedAt)
    const removed =
      before -
      (data.apiKeys.length + data.logins.length + data.recoveryCodes.length + data.secureNotes.length)
    if (removed > 0) await this.persist()
    return removed
  }

  async getStorageInfo(): Promise<StorageInfo> {
    this.ensureUnlocked()
    const path = vaultPath()
    let vaultBytes = 0
    if (existsSync(path)) {
      vaultBytes = (await stat(path)).size
    }
    const trash = this.listTrash()
    return {
      vaultPath: path,
      vaultBytes,
      recoveryEnabled: this.hasRecovery(),
      trashCount: trash.length,
      retentionDays: Math.round(TRASH_RETENTION_MS_INTERNAL / (24 * 60 * 60 * 1000)),
      counts: {
        apiKeys: this.listApiKeys().length,
        logins: this.listLogins().length,
        recoveryCodes: this.listRecoveryCodes().length,
        secureNotes: this.listSecureNotes().length
      }
    }
  }

  /** Copy vault.enc (and recovery.enc if present) next to the chosen backup path. */
  async backupVault(destVaultPath: string): Promise<{ vaultPath: string; recoveryPath?: string }> {
    if (!existsSync(vaultPath())) throw new Error('No vault file to back up')
    await mkdir(dirname(destVaultPath), { recursive: true })
    await copyFile(vaultPath(), destVaultPath)
    let copiedRecovery: string | undefined
    if (existsSync(recoveryPath())) {
      const recoveryDest = destVaultPath.replace(/\.enc$/i, '') + '.recovery.enc'
      await copyFile(recoveryPath(), recoveryDest)
      copiedRecovery = recoveryDest
    }
    return { vaultPath: destVaultPath, recoveryPath: copiedRecovery }
  }

  /**
   * Replace the on-disk vault with a backup file after verifying the password.
   * Locks the in-memory session — caller must unlock again.
   */
  async restoreVaultFromBackup(sourcePath: string, masterPassword: string): Promise<void> {
    const raw = await readFile(sourcePath, 'utf8')
    const encrypted: EncryptedVault = JSON.parse(raw)
    // Throws if password is wrong or file is corrupt.
    await decryptVault(encrypted, masterPassword)

    const dir = app.getPath('userData')
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await writeFileAtomic(vaultPath(), JSON.stringify(encrypted))

    // Companion recovery file from our backup naming convention.
    const companion = sourcePath.replace(/\.enc$/i, '') + '.recovery.enc'
    if (existsSync(companion)) {
      await writeFileAtomic(recoveryPath(), await readFile(companion, 'utf8'))
    }

    this.lock()
  }

  /**
   * Re-encrypts the vault under a new master password. If recovery is enabled,
   * pass the recovery passphrase to re-wrap the new key; otherwise recovery is cleared.
   */
  async changeMasterPassword(
    currentPassword: string,
    newPassword: string,
    recoveryPassphrase?: string | null
  ): Promise<{ recoveryCleared: boolean }> {
    if (!(await this.verifyMasterPassword(currentPassword))) {
      throw new Error('Wrong current password')
    }
    if (newPassword.length < 8) throw new Error('New password must be at least 8 characters')

    const hadRecovery = this.hasRecovery()
    let recoveryCleared = false

    if (hadRecovery) {
      if (recoveryPassphrase) {
        // Verify passphrase unwraps to the current vault key before rotating.
        const raw = await readFile(recoveryPath(), 'utf8')
        const wrapped: EncryptedVault = JSON.parse(raw)
        const { plaintext: rawKeyHex } = await decryptVault(wrapped, recoveryPassphrase)
        const unwrapped = Buffer.from(rawKeyHex, 'hex')
        if (!this.key || unwrapped.length !== this.key.length || !timingSafeEqual(unwrapped, this.key)) {
          throw new Error('Wrong recovery passphrase')
        }
      } else {
        await this.clearRecovery()
        recoveryCleared = true
      }
    }

    const newSalt = generateSalt()
    const newKey = await deriveKey(newPassword, newSalt)
    this.key = newKey
    this.salt = newSalt
    await this.persist()

    if (hadRecovery && !recoveryCleared && recoveryPassphrase) {
      await this.setupRecovery(recoveryPassphrase)
    }

    return { recoveryCleared }
  }
}

export const vaultStore = new VaultStore()
