import { useEffect, useRef, useState } from 'react'
import { useEscapeKey } from '../lib/use-escape-key'

/**
 * Listens for main-process requests to re-enter the master password when Touch ID
 * isn't available for a sensitive action (reveal / copy / edit / export).
 */
export function MasterPasswordPrompt(): JSX.Element | null {
  const [request, setRequest] = useState<{ requestId: string; reason: string } | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return window.vaultAPI.onNeedMasterPassword((next) => {
      setRequest(next)
      setPassword('')
      setError(null)
    })
  }, [])

  useEffect(() => {
    if (request) {
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
    return undefined
  }, [request])

  async function submit(passwordOrNull: string | null): Promise<void> {
    if (!request) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await window.vaultAPI.confirmMasterPassword(request.requestId, passwordOrNull)
      if (passwordOrNull === null) {
        setRequest(null)
        setPassword('')
        return
      }
      if (result.ok) {
        setRequest(null)
        setPassword('')
        return
      }
      setError(result.error ?? 'Could not confirm master password.')
      setPassword('')
      inputRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  useEscapeKey(() => void submit(null), !!request, true)

  if (!request) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div
        className="w-full max-w-sm rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold">Confirm master password</h2>
        <p className="mb-4 text-xs text-vt-muted">
          Touch ID isn&apos;t available. Enter your master password to {request.reason}.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            void submit(password)
          }}
          className="flex flex-col gap-3"
        >
          <input
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={submitting}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Master password"
            className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal disabled:opacity-50"
          />
          {error && <p className="text-xs text-vt-danger">{error}</p>}
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => void submit(null)}
              className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || password.length === 0}
              className="rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
            >
              {submitting ? 'Checking…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
