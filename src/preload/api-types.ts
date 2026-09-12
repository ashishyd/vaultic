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
  labelIds: string[]
}

export interface LabelSummary {
  id: string
  name: string
  color: string
  createdAt: number
}

export interface ScannedFile {
  project: string
  filePath: string
  keys: Array<{ name: string; value: string }>
}

export interface CsvLoginRow {
  service: string
  url?: string
  username: string
  password: string
  notes?: string
}

export type Strength = 'weak' | 'fair' | 'strong'

export interface PasswordAnalysis {
  id: string
  strength: Strength
  reused: boolean
  ageDays: number
  stale: boolean
}

export type AiCli = 'claude' | 'cursor-agent'

export type SuggestLabelsResult =
  | { success: true; suggestions: Record<string, string[]>; cli: AiCli; failedCount: number }
  | { success: false; error: string }

export interface AppSettings {
  /** Minutes of inactivity before the vault auto-locks. 0 = never. */
  autoLockMinutes: number
}

export interface VaultAPI {
  hasVault: () => Promise<boolean>
  isUnlocked: () => Promise<boolean>
  create: (masterPassword: string) => Promise<boolean>
  unlock: (masterPassword: string) => Promise<boolean>
  canUseBiometrics: () => Promise<boolean>
  unlockWithBiometrics: () => Promise<boolean>
  lock: () => Promise<boolean>

  listApiKeys: () => Promise<ApiKeySummary[]>
  listLogins: () => Promise<LoginSummary[]>

  addApiKey: (entry: { project: string; name: string; value: string; notes?: string }) => Promise<ApiKeySummary>
  addApiKeys: (
    entries: Array<{ project: string; name: string; value: string; notes?: string }>
  ) => Promise<ApiKeySummary[]>
  addLogin: (entry: {
    service: string
    username: string
    password: string
    url?: string
    notes?: string
  }) => Promise<LoginSummary>
  addLogins: (
    entries: Array<{ service: string; username: string; password: string; url?: string; notes?: string }>
  ) => Promise<LoginSummary[]>

  deleteApiKey: (id: string) => Promise<void>
  deleteLogin: (id: string) => Promise<void>
  restoreApiKey: (id: string) => Promise<void>
  restoreLogin: (id: string) => Promise<void>

  // Biometric-gated (falls back to allowed-through when no Touch ID is available).
  revealApiKeyValue: (id: string) => Promise<string | null>
  revealLoginPassword: (id: string) => Promise<string | null>
  copyApiKeyValue: (id: string) => Promise<boolean>
  copyLoginPassword: (id: string) => Promise<boolean>
  exportLoginsCsv: (ids: string[]) => Promise<{ success: boolean; filePath?: string }>

  // Not gated — these aren't secrets.
  copyToClipboard: (value: string) => Promise<boolean>

  pickFolder: () => Promise<string | null>
  scanFolder: (folderPath: string) => Promise<ScannedFile[]>

  pickCsvFile: () => Promise<string | null>
  parseLoginsCsv: (filePath: string) => Promise<CsvLoginRow[]>
  deleteFile: (filePath: string) => Promise<boolean>

  // Local-only, no AI, no network.
  analyzePasswords: () => Promise<PasswordAnalysis[]>
  generateStrongPassword: (length?: number) => Promise<string>

  // AI-assisted — sends only {id, service, url} to a local CLI (claude or cursor-agent).
  checkAiCliAvailable: () => Promise<AiCli | null>
  suggestLabelsWithAi: () => Promise<SuggestLabelsResult>

  // Biometric-gated (modifies a stored secret).
  updateLoginPassword: (id: string, newPassword: string) => Promise<boolean>
  updateApiKey: (
    id: string,
    patch: { project: string; name: string; value: string; notes?: string }
  ) => Promise<ApiKeySummary | null>
  updateLogin: (
    id: string,
    patch: { service: string; username: string; password: string; url?: string; notes?: string }
  ) => Promise<LoginSummary | null>

  setLoginFavorite: (id: string, favorite: boolean) => Promise<LoginSummary>

  listLabels: () => Promise<LabelSummary[]>
  addLabel: (name: string, color?: string) => Promise<LabelSummary>
  updateLabel: (id: string, patch: { name: string; color: string }) => Promise<LabelSummary>
  deleteLabel: (id: string) => Promise<void>
  toggleLoginLabel: (loginId: string, labelId: string) => Promise<LoginSummary>

  getSettings: () => Promise<AppSettings>
  setSettings: (settings: AppSettings) => Promise<boolean>

  /** Fires when the main process auto-locks the vault due to inactivity. Returns an unsubscribe function. */
  onAutoLocked: (callback: () => void) => () => void

  // Emergency recovery access — a second, independent unlock path (separate
  // passphrase + keyslot) in case the master password is forgotten.
  hasRecovery: () => Promise<boolean>
  setupRecovery: (passphrase: string) => Promise<boolean>
  clearRecovery: () => Promise<boolean>
  exportRecoveryKit: () => Promise<string | null>
  unlockWithRecovery: (passphrase: string) => Promise<boolean>

  // Best-effort local automation (AppleScript), not a secret — never gated.
  getFrontmostChromeTabUrl: () => Promise<string | null>
}
