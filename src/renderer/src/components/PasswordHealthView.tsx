import { useEffect, useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { ConfirmDialog } from './ConfirmDialog'
import { PageHeader } from './PageHeader'
import { copyWithAutoClear } from '../lib/clipboard'
import type { PasswordAnalysis, AiCli } from '../../../preload/api-types'

const STRENGTH_STYLES: Record<string, string> = {
  weak: 'border border-vt-danger text-vt-danger',
  fair: 'border border-yellow-500 text-yellow-400',
  strong: 'border border-vt-teal text-vt-teal'
}

function formatAge(days: number): string {
  const years = days / 365
  return years >= 1 ? `${years.toFixed(1)}y` : `${days}d`
}

function StatCard({ label, value, danger }: { label: string; value: number; danger?: boolean }): JSX.Element {
  return (
    <div className="rounded-[10px] border border-vt-border bg-vt-surface p-4">
      <div className="mb-1.5 text-[11px] uppercase tracking-wide text-vt-muted">{label}</div>
      <div className={`text-[28px] font-semibold ${danger ? 'text-vt-danger' : ''}`}>{value}</div>
    </div>
  )
}

export function PasswordHealthView(): JSX.Element {
  const { logins, refresh } = useVaultStore()
  const [analysis, setAnalysis] = useState<PasswordAnalysis[]>([])
  const [loadingAnalysis, setLoadingAnalysis] = useState(true)

  const [showAiDisclosure, setShowAiDisclosure] = useState(false)
  const [suggestingLabels, setSuggestingLabels] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
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
  const issueRows = useMemo(
    () => rows.filter((r) => r.info && (r.info.strength === 'weak' || r.info.reused || r.info.stale)),
    [rows]
  )

  const stats = useMemo(
    () => ({
      total: rows.length,
      weak: rows.filter((r) => r.info?.strength === 'weak').length,
      reused: rows.filter((r) => r.info?.reused).length,
      stale: rows.filter((r) => r.info?.stale).length
    }),
    [rows]
  )

  async function handleConfirmAiSuggestLabels(): Promise<void> {
    setShowAiDisclosure(false)
    setSuggestingLabels(true)
    setSuggestError(null)
    try {
      const cliCheck = await window.vaultAPI.checkAiCliAvailable()
      if (!cliCheck) {
        setSuggestError('No AI CLI found. Install Claude Code (claude) or Cursor CLI (cursor-agent) to enable this.')
        return
      }
      const result = await window.vaultAPI.suggestLabelsWithAi()
      if (result.success) {
        setUsedCli(result.cli)
        if (result.failedCount > 0) {
          setSuggestError(`Labeled most logins, but ${result.failedCount} failed and were left unlabeled.`)
        }
        await refresh()
      } else {
        setSuggestError(result.error)
      }
    } finally {
      setSuggestingLabels(false)
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
    <div className="flex h-full flex-col">
      <PageHeader
        title="Password Health"
        actions={
          <button
            onClick={() => setShowAiDisclosure(true)}
            disabled={suggestingLabels}
            className="rounded-lg border border-vt-teal/40 bg-vt-teal/10 px-3.5 py-2 text-sm font-medium text-vt-teal hover:bg-vt-teal/20 disabled:opacity-50"
          >
            {suggestingLabels ? 'Suggesting…' : 'Suggest labels with AI'}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-7 py-6">
        <p className="mb-4 text-xs text-vt-muted">
          Strength and reuse are checked entirely on this device — no data leaves your Mac for that. Label
          suggestions are optional and, if you use them, send only site names/URLs (never passwords or usernames)
          to a local AI CLI.
        </p>
        {usedCli && !suggestError && <p className="mb-3 text-xs text-vt-muted">Suggested using the {usedCli} CLI.</p>}
        {suggestError && <p className="mb-3 text-xs text-vt-danger">{suggestError}</p>}

        <div className="mb-6 grid grid-cols-4 gap-3">
          <StatCard label="Total logins" value={stats.total} />
          <StatCard label="Weak" value={stats.weak} danger={stats.weak > 0} />
          <StatCard label="Reused" value={stats.reused} danger={stats.reused > 0} />
          <StatCard label="Stale (1yr+)" value={stats.stale} />
        </div>

        {loadingAnalysis ? (
          <p className="text-xs text-vt-muted">Analyzing…</p>
        ) : issueRows.length === 0 ? (
          <p className="text-xs text-vt-muted">No issues found — nice and tidy.</p>
        ) : (
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className="border-b border-vt-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-vt-muted">
                  Service
                </th>
                <th className="border-b border-vt-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-vt-muted">
                  Username
                </th>
                <th className="border-b border-vt-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-vt-muted">
                  Issue
                </th>
                <th className="border-b border-vt-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-vt-muted" style={{ width: 260 }} />
              </tr>
            </thead>
            <tbody>
              {issueRows.map(({ login, info }) => (
                <tr key={login.id}>
                  <td className="border-b border-vt-border/60 px-3 py-3 font-medium">{login.service}</td>
                  <td className="border-b border-vt-border/60 px-3 py-3 text-xs text-vt-muted">{login.username}</td>
                  <td className="border-b border-vt-border/60 px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {info?.strength === 'weak' && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${STRENGTH_STYLES.weak}`}>Weak</span>
                      )}
                      {info?.reused && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${STRENGTH_STYLES.weak}`}>Reused</span>
                      )}
                      {info?.stale && (
                        <span className="rounded-full border border-yellow-500 px-2 py-0.5 text-[11px] text-yellow-400">
                          {formatAge(info.ageDays)} old
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="border-b border-vt-border/60 px-3 py-3 text-right">
                    {suggestions.has(login.id) ? (
                      <div className="flex items-center justify-end gap-2">
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
                          {savingId === login.id ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleSuggest(login.id)}
                        className="rounded-lg border border-vt-border px-3.5 py-1.5 text-xs text-vt-text hover:bg-vt-surface2"
                      >
                        Generate new
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAiDisclosure && (
        <ConfirmDialog
          title="Send site names to AI?"
          message="This sends only service names and URLs (never usernames or passwords) to a local AI CLI (Claude Code or Cursor) installed on this Mac, which may contact its provider's cloud API to suggest labels. Continue?"
          confirmLabel="Continue"
          tone="neutral"
          onConfirm={handleConfirmAiSuggestLabels}
          onCancel={() => setShowAiDisclosure(false)}
        />
      )}
    </div>
  )
}
