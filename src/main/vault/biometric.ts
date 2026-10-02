import { systemPreferences } from 'electron'

/** Whether this Mac can prompt Touch ID (hardware present, user has a fingerprint enrolled). */
export function isBiometricsAvailable(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    return systemPreferences.canPromptTouchID()
  } catch {
    return false
  }
}

export async function promptBiometrics(reason: string): Promise<boolean> {
  if (!isBiometricsAvailable()) return false
  try {
    await systemPreferences.promptTouchID(reason)
    return true
  } catch {
    return false
  }
}

/**
 * Gate a sensitive action behind Touch ID when available. When Touch ID isn't
 * available, calls `fallback` (typically a master-password re-prompt) so the
 * action is never silently allow-through after unlock alone.
 */
export async function biometricGate(
  reason: string,
  fallback?: () => Promise<boolean>
): Promise<boolean> {
  if (isBiometricsAvailable()) {
    return promptBiometrics(reason)
  }
  if (fallback) return fallback()
  return false
}
