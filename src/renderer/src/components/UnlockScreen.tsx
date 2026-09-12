import { useEffect, useState } from 'react'
import { BrandLogo } from './BrandLogo'

interface UnlockScreenProps {
  hasVault: boolean
  onUnlocked: () => void
}

export function UnlockScreen({ hasVault, onUnlocked }: UnlockScreenProps): JSX.Element {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [checkingBiometrics, setCheckingBiometrics] = useState(true)
  const [biometricsAvailable, setBiometricsAvailable] = useState(false)
  const [unlockingWithTouchId, setUnlockingWithTouchId] = useState(false)
  const [recoveryAvailable, setRecoveryAvailable] = useState(false)
  const [usingRecovery, setUsingRecovery] = useState(false)
  const [recoveryPassphrase, setRecoveryPassphrase] = useState('')
  const [recoveryLoading, setRecoveryLoading] = useState(false)

  // Just check whether Touch ID is usable — the actual prompt only fires on an
  // explicit click (see handleUseTouchId). Auto-firing it here raced with the
  // window not being focused yet right after launch and could silently fail.
  useEffect(() => {
    let cancelled = false
    Promise.all([window.vaultAPI.canUseBiometrics(), hasVault ? window.vaultAPI.hasRecovery() : Promise.resolve(false)]).then(
      ([available, hasRecovery]) => {
        if (!cancelled) {
          setBiometricsAvailable(available)
          setRecoveryAvailable(hasRecovery)
          setCheckingBiometrics(false)
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [hasVault])

  async function handleUnlockWithRecovery(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setRecoveryLoading(true)
    try {
      const ok = await window.vaultAPI.unlockWithRecovery(recoveryPassphrase)
      if (ok) onUnlocked()
      else setError('Wrong recovery passphrase.')
    } finally {
      setRecoveryLoading(false)
    }
  }

  async function handleUseTouchId(): Promise<void> {
    setError(null)
    setUnlockingWithTouchId(true)
    try {
      const ok = await window.vaultAPI.unlockWithBiometrics()
      if (ok) onUnlocked()
      else setError('Touch ID failed. Enter your master password instead.')
    } finally {
      setUnlockingWithTouchId(false)
    }
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    if (!hasVault) {
      if (password.length < 8) {
        setError('Master password must be at least 8 characters.')
        return
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.')
        return
      }
      setLoading(true)
      try {
        await window.vaultAPI.create(password)
        onUnlocked()
      } catch {
        setError('Could not create vault.')
      } finally {
        setLoading(false)
      }
      return
    }

    setLoading(true)
    try {
      await window.vaultAPI.unlock(password)
      onUnlocked()
    } catch {
      setError('Wrong master password.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingBiometrics) {
    return (
      <div className="flex h-full items-center justify-center">
        <BrandLogo size={40} />
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-vt-border bg-vt-surface p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandLogo size={48} />
          <div className="text-center">
            <h1 className="text-xl font-semibold">Vaultic</h1>
            <p className="text-sm text-vt-muted">Your keys, kept.</p>
          </div>
        </div>

        {hasVault && biometricsAvailable && !usingRecovery && (
          <button
            onClick={handleUseTouchId}
            disabled={unlockingWithTouchId}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border border-vt-teal/40 bg-vt-teal/10 px-3 py-2 text-sm font-medium text-vt-teal transition hover:bg-vt-teal/20 disabled:opacity-50"
          >
            {unlockingWithTouchId ? 'Waiting for Touch ID…' : 'Unlock with Touch ID'}
          </button>
        )}

        {usingRecovery ? (
          <form onSubmit={handleUnlockWithRecovery} className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-vt-muted">Recovery passphrase</label>
              <input
                autoFocus
                type="password"
                value={recoveryPassphrase}
                onChange={(e) => setRecoveryPassphrase(e.target.value)}
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
                placeholder="••••••••"
              />
            </div>
            {error && <p className="text-xs text-vt-danger">{error}</p>}
            <button
              type="submit"
              disabled={recoveryLoading || !recoveryPassphrase}
              className="rounded-lg bg-vt-teal px-3 py-2 text-sm font-medium text-vt-bg transition hover:brightness-110 disabled:opacity-50"
            >
              {recoveryLoading ? 'Please wait…' : 'Unlock with recovery passphrase'}
            </button>
            <button
              type="button"
              onClick={() => {
                setUsingRecovery(false)
                setError(null)
              }}
              className="text-center text-[11px] text-vt-muted hover:text-vt-text"
            >
              Use master password instead
            </button>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-vt-muted">
              {hasVault ? 'Master password' : 'Create a master password'}
            </label>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
              placeholder="••••••••"
            />
          </div>

          {!hasVault && (
            <div>
              <label className="mb-1 block text-xs font-medium text-vt-muted">Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
                placeholder="••••••••"
              />
            </div>
          )}

          {error && <p className="text-xs text-vt-danger">{error}</p>}

          <button
            type="submit"
            disabled={loading || !password}
            className="mt-2 rounded-lg bg-vt-teal px-3 py-2 text-sm font-medium text-vt-bg transition hover:brightness-110 disabled:opacity-50"
          >
            {loading ? 'Please wait…' : hasVault ? 'Unlock with password' : 'Create Vault'}
          </button>

          {!hasVault && (
            <p className="mt-1 text-center text-[11px] text-vt-muted">
              This password encrypts everything locally.
              {biometricsAvailable && ' Touch ID will be available next launch.'} You can set up emergency recovery
              access later in Settings.
            </p>
          )}

          {hasVault && recoveryAvailable && (
            <button
              type="button"
              onClick={() => setUsingRecovery(true)}
              className="text-center text-[11px] text-vt-muted hover:text-vt-text"
            >
              Forgot your master password? Use recovery passphrase
            </button>
          )}
        </form>
        )}
      </div>
    </div>
  )
}
