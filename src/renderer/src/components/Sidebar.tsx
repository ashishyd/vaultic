import { useEffect, useState } from 'react'
import { BrandLogo } from './BrandLogo'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { hostnameOf } from '../lib/url'

interface SidebarProps {
  onLock: () => void
  onAdd: () => void
  onScan: () => void
  onImportLogins: () => void
  onSettings: () => void
  onOpenSecurityDashboard: () => void
}

export function Sidebar({
  onLock,
  onAdd,
  onScan,
  onImportLogins,
  onSettings,
  onOpenSecurityDashboard
}: SidebarProps): JSX.Element {
  const { section, setSection, search, setSearch, apiKeys, logins } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [weakCount, setWeakCount] = useState(0)
  const [reusedCount, setReusedCount] = useState(0)
  const [copyingFromChrome, setCopyingFromChrome] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.vaultAPI.analyzePasswords().then((results) => {
      if (cancelled) return
      setWeakCount(results.filter((r) => r.strength === 'weak').length)
      setReusedCount(results.filter((r) => r.reused).length)
    })
    return () => {
      cancelled = true
    }
  }, [logins])

  async function handleCopyForChromeTab(): Promise<void> {
    setCopyingFromChrome(true)
    try {
      const url = await window.vaultAPI.getFrontmostChromeTabUrl()
      const host = hostnameOf(url ?? undefined)
      if (!host) {
        push("Couldn't read Chrome's active tab — is Chrome open?", 'error')
        return
      }
      const match = logins.find((l) => hostnameOf(l.url) === host)
      if (!match) {
        push(`No saved login matches ${host}`, 'info')
        return
      }
      const ok = await window.vaultAPI.copyLoginPassword(match.id)
      push(
        ok ? `Copied password for "${match.service}"` : 'Touch ID failed or was cancelled',
        ok ? 'success' : 'error'
      )
    } finally {
      setCopyingFromChrome(false)
    }
  }

  return (
    <div className="flex h-full w-56 shrink-0 flex-col border-r border-vt-border bg-vt-surface px-3 py-4">
      <div className="mb-5 px-1">
        <BrandLogo size={26} withWordmark />
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search…"
        className="mb-4 w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-1.5 text-sm outline-none focus:border-vt-teal"
      />

      <nav className="flex flex-col gap-1">
        <button
          onClick={() => setSection('keys')}
          className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
            section === 'keys' ? 'bg-vt-surface2 text-vt-text' : 'text-vt-muted hover:bg-vt-surface2'
          }`}
        >
          <span>API Keys</span>
          <span className="text-xs text-vt-muted">{apiKeys.length}</span>
        </button>
        <button
          onClick={() => setSection('logins')}
          className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
            section === 'logins' ? 'bg-vt-surface2 text-vt-text' : 'text-vt-muted hover:bg-vt-surface2'
          }`}
        >
          <span>Logins</span>
          <span className="text-xs text-vt-muted">{logins.length}</span>
        </button>
      </nav>

      {(weakCount > 0 || reusedCount > 0) && (
        <button
          onClick={onOpenSecurityDashboard}
          className="mt-2 flex items-center gap-1.5 rounded-lg border border-vt-danger/30 bg-vt-danger/10 px-3 py-1.5 text-left text-xs text-vt-danger transition hover:bg-vt-danger/20"
        >
          <span>⚠</span>
          <span>
            {weakCount > 0 && `${weakCount} weak`}
            {weakCount > 0 && reusedCount > 0 && ' · '}
            {reusedCount > 0 && `${reusedCount} reused`}
          </span>
        </button>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <button
          onClick={onAdd}
          className="rounded-lg bg-vt-teal px-3 py-2 text-sm font-medium text-vt-bg transition hover:brightness-110"
        >
          + Add {section === 'keys' ? 'API Key' : 'Login'}
        </button>
        {section === 'keys' && (
          <button
            onClick={onScan}
            className="rounded-lg border border-vt-border px-3 py-2 text-sm text-vt-text transition hover:bg-vt-surface2"
          >
            Scan a folder…
          </button>
        )}
        {section === 'logins' && (
          <>
            <button
              onClick={onImportLogins}
              className="rounded-lg border border-vt-border px-3 py-2 text-sm text-vt-text transition hover:bg-vt-surface2"
            >
              Import from Chrome…
            </button>
            <button
              onClick={handleCopyForChromeTab}
              disabled={copyingFromChrome}
              className="rounded-lg border border-vt-border px-3 py-2 text-sm text-vt-text transition hover:bg-vt-surface2 disabled:opacity-50"
            >
              {copyingFromChrome ? 'Checking Chrome…' : 'Copy for current Chrome tab'}
            </button>
          </>
        )}
      </div>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <button
          onClick={onSettings}
          className="w-full rounded-lg border border-vt-border px-3 py-2 text-sm text-vt-muted transition hover:bg-vt-surface2 hover:text-vt-text"
        >
          Settings
        </button>
        <button
          onClick={onLock}
          className="w-full rounded-lg border border-vt-border px-3 py-2 text-sm text-vt-muted transition hover:bg-vt-surface2 hover:text-vt-text"
        >
          Lock Vault
        </button>
      </div>
    </div>
  )
}
