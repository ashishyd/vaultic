import { useEffect, useState } from 'react'
import { BrandLogo } from './BrandLogo'
import { useVaultStore } from '../stores/vault-store'
import {
  KeyIcon,
  LockIcon,
  ShieldIcon,
  LifeBuoyIcon,
  NoteIcon,
  BookmarkIcon,
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  TrashIcon
} from './icons'

function TrashNavIcon(): JSX.Element {
  return <TrashIcon size={16} />
}

interface SidebarProps {
  onLock: () => void
  onSettings: () => void
}

export function Sidebar({ onLock, onSettings }: SidebarProps): JSX.Element {
  const { section, setSection, apiKeys, logins, recoveryCodes, secureNotes, bookmarks } = useVaultStore()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [weakCount, setWeakCount] = useState(0)
  const [reusedCount, setReusedCount] = useState(0)

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

  const navItem = (
    active: boolean,
    onClick: () => void,
    icon: JSX.Element,
    label: string,
    count?: number
  ): JSX.Element => (
    <button
      onClick={onClick}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-lg border-none py-2 px-2.5 text-left transition ${
        active ? 'bg-vt-surface2 text-vt-text' : 'bg-transparent text-vt-muted hover:bg-vt-surface2/60 hover:text-vt-text'
      }`}
    >
      <span className={`flex shrink-0 ${active ? 'text-vt-teal' : ''}`}>{icon}</span>
      {sidebarOpen && (
        <>
          <span className="whitespace-nowrap text-sm">{label}</span>
          {count !== undefined && <span className="ml-auto text-xs text-vt-muted">{count}</span>}
        </>
      )}
    </button>
  )

  return (
    <div
      className="flex h-full shrink-0 flex-col border-r border-vt-border bg-vt-surface py-4 transition-[width] duration-150"
      style={{ width: sidebarOpen ? '210px' : '58px' }}
    >
      <div className="mb-2 flex items-center gap-2.5 px-4 pb-4">
        <BrandLogo size={24} />
        {sidebarOpen && <span className="whitespace-nowrap text-base font-semibold tracking-tight">Vaultic</span>}
      </div>

      <nav className="flex flex-col gap-0.5 px-2.5">
        {sidebarOpen && (
          <span className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-vt-muted">Vault</span>
        )}
        {navItem(section === 'keys', () => setSection('keys'), <KeyIcon />, 'API Keys', apiKeys.length)}
        {navItem(section === 'logins', () => setSection('logins'), <LockIcon />, 'Logins', logins.length)}
        {navItem(
          section === 'recovery',
          () => setSection('recovery'),
          <LifeBuoyIcon />,
          'Recovery Codes',
          recoveryCodes.length
        )}
        {navItem(section === 'notes', () => setSection('notes'), <NoteIcon />, 'Secure Notes', secureNotes.length)}
        {navItem(section === 'bookmarks', () => setSection('bookmarks'), <BookmarkIcon />, 'Bookmarks', bookmarks.length)}
        {navItem(section === 'analysis', () => setSection('analysis'), <ShieldIcon />, 'Password Health')}
        {navItem(section === 'trash', () => setSection('trash'), <TrashNavIcon />, 'Recently Deleted')}
      </nav>

      {sidebarOpen && (weakCount > 0 || reusedCount > 0) && (
        <button
          onClick={() => setSection('analysis')}
          className="mx-2.5 mt-5 flex flex-col gap-1.5 rounded-xl border border-vt-border bg-vt-bg p-3 text-left hover:bg-vt-surface2"
        >
          <span className="flex items-center gap-2 text-xs font-medium text-vt-text">
            <AlertTriangleIcon size={14} />
            Password health
          </span>
          <span className="text-xs text-vt-danger">
            {weakCount > 0 && `${weakCount} weak`}
            {weakCount > 0 && reusedCount > 0 && ' · '}
            {reusedCount > 0 && `${reusedCount} reused`}
          </span>
        </button>
      )}

      <div className="mt-auto flex flex-col gap-0.5 px-2.5">
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          title="Collapse"
          className="flex items-center gap-2.5 rounded-lg border-none bg-transparent py-2.5 px-2.5 text-left text-vt-muted transition hover:bg-vt-surface2 hover:text-vt-text"
        >
          {sidebarOpen ? <ChevronLeftIcon size={16} /> : <ChevronRightIcon size={16} />}
          {sidebarOpen && <span className="text-sm">Collapse</span>}
        </button>
        <button
          onClick={onSettings}
          title="Settings"
          className="flex items-center gap-2.5 rounded-lg border-none bg-transparent py-2.5 px-2.5 text-left text-vt-muted transition hover:bg-vt-surface2 hover:text-vt-text"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {sidebarOpen && <span className="text-sm">Settings</span>}
        </button>
        <button
          onClick={onLock}
          title="Lock Vault"
          className="flex items-center gap-2.5 rounded-lg border-none bg-transparent py-2.5 px-2.5 text-left text-vt-muted transition hover:bg-vt-surface2 hover:text-vt-text"
        >
          <LockIcon size={16} />
          {sidebarOpen && (
            <>
              <span className="text-sm">Lock Vault</span>
              <span className="ml-auto font-mono text-[11px]">⌘L</span>
            </>
          )}
        </button>
      </div>
    </div>
  )
}
