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
    <div className="rounded-xl border border-vt-border bg-vt-surface p-4">
      <div className="mb-1.5 text-xs text-vt-muted">{label}</div>
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
    setLoadingAnalysis(true)
    window.vaultAPI.analyzePasswords().then((result) => {
      if (!cancelled) {
        setAnalysis(result)
        setLoadingAnalysis(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [logins])

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

  const strongUnique = useMemo(
    () => rows.filter((r) => r.info?.strength === 'strong' && !r.info.reused).length,
    [rows]
  )
  const breakdown: Array<{ label: string; count: number; bar: string }> = [
    { label: 'Weak passwords', count: stats.weak, bar: 'bg-vt-danger' },
    { label: 'Reused across sites', count: stats.reused, bar: 'bg-vt-danger' },
    { label: 'Older than a year', count: stats.stale, bar: 'bg-vt-muted' },
    { label: 'Strong and unique', count: strongUnique, bar: 'bg-vt-teal' }
  ]

  const score = stats.total === 0 ? 100 : Math.round(((stats.total - issueRows.length) / stats.total) * 100)

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

        {stats.total > 0 && (
          <div className="mb-4 flex items-center gap-6 rounded-2xl border border-vt-border bg-vt-surface p-5">
            <svg width="96" height="96" viewBox="0 0 132 132" role="img" aria-label={`Vault score ${score} out of 100`}>
              <circle cx="66" cy="66" r="54" fill="none" strokeWidth="12" className="stroke-vt-border" />
              <circle
                cx="66"
                cy="66"
                r="54"
                fill="none"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${(score / 100) * 339} 339`}
                transform="rotate(-90 66 66)"
                className={score >= 70 ? 'stroke-vt-teal' : 'stroke-vt-danger'}
              />
              <text x="66" y="76" textAnchor="middle" fontSize="34" fontWeight="700" className="fill-vt-text">
                {score}
              </text>
            </svg>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold">
                {issueRows.length === 0 ? 'All logins look good' : `${issueRows.length} login${issueRows.length === 1 ? '' : 's'} need attention`}
              </span>
              <span className="text-xs text-vt-muted">Score is the share of logins with no weak, reused or stale password.</span>
            </div>
          </div>
        )}

        {stats.total > 0 && (
          <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-vt-border bg-vt-surface p-5">
            {breakdown.map(({ label, count, bar }) => (
              <div key={label}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="text-vt-muted">{label}</span>
                  <span className="font-medium">{count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-vt-surface2">
                  <div
                    className={`h-full rounded-full ${bar}`}
                    style={{ width: `${Math.min(100, Math.max(0, (count / stats.total) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          <>
            <div className="mb-3 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">Fix first</h2>
              <span className="text-xs text-vt-muted">Weak, reused and stale passwords</span>
            </div>
            <div className="flex flex-col overflow-hidden rounded-xl border border-vt-border">
              {issueRows.map(({ login, info }) => (
                <div
                  key={login.id}
                  className="flex flex-wrap items-center gap-3 border-b border-vt-border bg-vt-surface px-4 py-3 last:border-b-0"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-vt-surface2 text-sm font-semibold">
                    {login.service.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-[160px] flex-1">
                    <p className="truncate text-sm font-medium">{login.service}</p>
                    <p className="truncate text-xs text-vt-muted">{login.username}</p>
                  </div>
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
                  {suggestions.has(login.id) ? (
                    <div className="flex items-center gap-2">
                      <span className="max-w-[200px] truncate rounded bg-vt-surface2 px-2 py-1 font-mono text-xs text-vt-teal">
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
                      className="rounded-lg border border-vt-border px-3 py-1.5 text-xs text-vt-text hover:bg-vt-surface2"
                    >
                      Generate new
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
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
