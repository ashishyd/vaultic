import { create } from 'zustand'
import type { ApiKeySummary, LoginSummary, LabelSummary } from '../../../preload/api-types'

export type Section = 'keys' | 'logins'

interface VaultUIState {
  unlocked: boolean
  hasVault: boolean
  section: Section
  search: string
  apiKeys: ApiKeySummary[]
  logins: LoginSummary[]
  labels: LabelSummary[]
  setUnlocked: (v: boolean) => void
  setHasVault: (v: boolean) => void
  setSection: (s: Section) => void
  setSearch: (q: string) => void
  refresh: () => Promise<void>
}

export const useVaultStore = create<VaultUIState>((set) => ({
  unlocked: false,
  hasVault: false,
  section: 'keys',
  search: '',
  apiKeys: [],
  logins: [],
  labels: [],
  setUnlocked: (v) => set({ unlocked: v }),
  setHasVault: (v) => set({ hasVault: v }),
  setSection: (s) => set({ section: s }),
  setSearch: (q) => set({ search: q }),
  refresh: async () => {
    const [apiKeys, logins, labels] = await Promise.all([
      window.vaultAPI.listApiKeys(),
      window.vaultAPI.listLogins(),
      window.vaultAPI.listLabels()
    ])
    set({ apiKeys, logins, labels })
  }
}))
