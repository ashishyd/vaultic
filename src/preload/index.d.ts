import type { VaultAPI } from './api-types'

declare global {
  interface Window {
    vaultAPI: VaultAPI
  }
}
