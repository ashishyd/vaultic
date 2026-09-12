import { useEffect, useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { ConfirmDialog } from './ConfirmDialog'
import { copyWithAutoClear } from '../lib/clipboard'
import type { PasswordAnalysis, AiCli } from '../../../preload/api-types'

interface PasswordAnalysisModalProps {
  onClose: () => void
}

const STRENGTH_STYLES: Record<string, string> = {
  weak: 'bg-vt-danger/20 text-vt-danger',
  fair: 'bg-yellow-500/20 text-yellow-400',
  strong: 'bg-vt-teal/20 text-vt-teal'
}

function formatAge(days: number): string {
  const years = days / 365
  return years >= 1 ? `${years.toFixed(1)}y` : `${days}d`
}

export function PasswordAnalysisModal({ onClose }: PasswordAnalysisModalProps): JSX.Element {
  const { logins, refresh } = useVaultStore()
  const [analysis, setAnalysis] = useState<PasswordAnalysis[]>([])
  const [loadingAnalysis, setLoadingAnalysis] = useState(true)

  const [showAiDisclosure, setShowAiDisclosure] = useState(false)
  const [categorizing, setCategorizing] = useState(false)
  const [categories, setCategories] = useState<Record<string, string>>({})
  const [categorizeError, setCategorizeError] = useState<string | null>(null)
  const [usedCli, setUsedCli] = useState<AiCli | null>(null)

  const [suggestions, setSuggestions] = useState<Map<string, string>>(new Map())
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.vaultAPI.analyzePasswords().then((result) => {
      if (!cancelled) {
        setAnalysis(result)
        setLoadingAnalysis(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const byId = useMemo(() => new Map(analysis.map((a) => [a.id, a])), [analysis])
  const rows = useMemo(
    () => logins.map((l) => ({ login: l, info: byId.get(l.id) })).filter((r) => r.info),
    [logins, byId]
  )

  async function handleConfirmAiCategorize(): Promise<void> {
    setShowAiDisclosure(false)
    setCategorizing(true)
    setCategorizeError(null)
    try {
      const cliCheck = await window.vaultAPI.checkAiCliAvailable()
      if (!cliCheck) {
        setCategorizeError('No AI CLI found. Install Claude Code (claude) or Cursor CLI (cursor-agent) to enable this.')
        return
      }
      const result = await window.vaultAPI.categorizeLoginsWithAi()
      if (result.success) {
        setCategories(result.categories)
        setUsedCli(result.cli)
        await refresh() // categories are persisted server-side; reflect them in the login list too
      } else {
        setCategorizeError(result.error)
      }
    } finally {
      setCategorizing(false)
    }
  }

  async function handleSuggest(id: string): Promise<void> {
    const suggestion = await window.vaultAPI.generateStrongPassword()
    setSuggestions((prev) => new Map(prev).set(id, suggestion))
  }

  async function handleSaveSuggestion(id: string): Promise<void> {
    const suggestion = suggestions.get(id)
    if (!suggestion) return
    setSavingId(id)
    try {
      const ok = await window.vaultAPI.updateLoginPassword(id, suggestion)
      if (ok) {
        setSuggestions((prev) => {
          const next = new Map(prev)
          next.delete(id)
          return next
        })
        const refreshed = await window.vaultAPI.analyzePasswords()
        setAnalysis(refreshed)
        await refresh()
      }
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Analyze passwords</h2>
          <button
            onClick={() => setShowAiDisclosure(true)}
            disabled={categorizing}
            className="rounded-lg border border-vt-teal/40 bg-vt-teal/10 px-3 py-1.5 text-xs font-medium text-vt-teal hover:bg-vt-teal/20 disabled:opacity-50"
          >
            {categorizing ? 'Categorizing…' : 'Categorize with AI'}
          </button>
        </div>
        <p className="mb-3 text-xs text-vt-muted">
          Strength and reuse are checked entirely on this device — no data leaves your Mac for that. Categorizing
          is optional and, if you use it, sends only site names/URLs (never passwords or usernames) to a local AI
          CLI.
        </p>

        {usedCli && !categorizeError && (
          <p className="mb-2 text-xs text-vt-muted">Categorized using the {usedCli} CLI.</p>
        )}
        {categorizeError && <p className="mb-2 text-xs text-vt-danger">{categorizeError}</p>}

        {loadingAnalysis ? (
          <p className="text-xs text-vt-muted">Analyzing…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-vt-muted">No logins to analyze yet.</p>
        ) : (
          <div className="flex-1 overflow-y-auto rounded-lg border border-vt-border">
            {rows.map(({ login, info }) => (
              <div key={login.id} className="border-b border-vt-border p-3 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{login.service}</p>
                    <p className="truncate text-xs text-vt-muted">{login.username}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {(login.category ?? categories[login.id]) && (
                      <span className="rounded-full bg-vt-surface2 px-2 py-0.5 text-[11px] text-vt-muted">
                        {login.category ?? categories[login.id]}
                      </span>
                    )}
                    {info?.reused && (
                      <span className="rounded-full bg-vt-danger/20 px-2 py-0.5 text-[11px] text-vt-danger">
                        Reused
                      </span>
                    )}
                    {info?.stale && (
                      <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-[11px] text-yellow-400">
                        {formatAge(info.ageDays)} old
                      </span>
                    )}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] capitalize ${STRENGTH_STYLES[info?.strength ?? 'weak']}`}
                    >
                      {info?.strength}
                    </span>
                  </div>
                </div>

                {info && (info.strength === 'weak' || info.reused || info.stale) && (
                  <div className="mt-2 flex items-center gap-2">
                    {suggestions.has(login.id) ? (
                      <>
                        <span className="truncate rounded bg-vt-surface2 px-2 py-1 font-mono text-xs text-vt-teal">
                          {suggestions.get(login.id)}
                        </span>
                        <button
                          onClick={() => copyWithAutoClear(suggestions.get(login.id) ?? '')}
                          className="rounded-md px-2 py-1 text-xs text-vt-muted hover:bg-vt-surface2 hover:text-vt-text"
                        >
                          Copy
                        </button>
                        <button
                          onClick={() => handleSaveSuggestion(login.id)}
                          disabled={savingId === login.id}
                          className="rounded-md bg-vt-teal px-2 py-1 text-xs font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
                        >
                          {savingId === login.id ? 'Saving…' : 'Save to this login'}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleSuggest(login.id)}
                        className="rounded-md border border-vt-border px-2 py-1 text-xs text-vt-text hover:bg-vt-surface2"
                      >
                        Suggest strong password
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2">
            Close
          </button>
        </div>
      </div>

      {showAiDisclosure && (
        <ConfirmDialog
          title="Send site names to AI?"
          message="This sends only service names and URLs (never usernames or passwords) to a local AI CLI (Claude Code or Cursor) installed on this Mac, which may contact its provider's cloud API to categorize them. Continue?"
          confirmLabel="Continue"
          tone="neutral"
          onConfirm={handleConfirmAiCategorize}
          onCancel={() => setShowAiDisclosure(false)}
        />
      )}
    </div>
  )
}
