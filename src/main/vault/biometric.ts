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
 * Gate a sensitive action behind Touch ID. On Macs without Touch ID hardware
 * or enrollment there is nothing to gate with, so the action is allowed through
 * (the user already authenticated with the master password to unlock the vault).
 */
export async function biometricGate(reason: string): Promise<boolean> {
  if (!isBiometricsAvailable()) return true
  return promptBiometrics(reason)
}
