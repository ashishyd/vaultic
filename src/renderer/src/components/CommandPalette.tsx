import { useEffect, useMemo, useRef, useState } from 'react'
import { useVaultStore, type Section } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { fuzzyMatch } from '../lib/fuzzy'
import { useEscapeKey } from '../lib/use-escape-key'

interface CommandPaletteProps {
  onClose: () => void
  onNavigate: (section: Section) => void
  onSettings: () => void
  onLock: () => void
}

type Item =
  | { kind: 'key' | 'login' | 'recovery' | 'note'; id: string; title: string; subtitle: string }
  | { kind: 'nav'; id: string; title: string; subtitle: string; action: 'section' | 'settings' | 'lock'; section?: Section }

const NAV_ITEMS: Item[] = [
  { kind: 'nav', id: 'nav-keys', title: 'Go to API Keys', subtitle: 'Navigate', action: 'section', section: 'keys' },
  { kind: 'nav', id: 'nav-logins', title: 'Go to Logins', subtitle: 'Navigate', action: 'section', section: 'logins' },
  {
    kind: 'nav',
    id: 'nav-recovery',
    title: 'Go to Recovery Codes',
    subtitle: 'Navigate',
    action: 'section',
    section: 'recovery'
  },
  { kind: 'nav', id: 'nav-notes', title: 'Go to Secure Notes', subtitle: 'Navigate', action: 'section', section: 'notes' },
  {
    kind: 'nav',
    id: 'nav-health',
    title: 'Go to Password Health',
    subtitle: 'Navigate',
    action: 'section',
    section: 'analysis'
  },
  {
    kind: 'nav',
    id: 'nav-trash',
    title: 'Go to Recently Deleted',
    subtitle: 'Navigate',
    action: 'section',
    section: 'trash'
  },
  { kind: 'nav', id: 'nav-settings', title: 'Open Settings', subtitle: 'Navigate', action: 'settings' },
  { kind: 'nav', id: 'nav-lock', title: 'Lock vault', subtitle: '⌘L', action: 'lock' }
]

function kindLabel(kind: Item['kind']): string {
  switch (kind) {
    case 'key':
      return 'API key'
    case 'login':
      return 'Login'
    case 'recovery':
      return 'Recovery'
    case 'note':
      return 'Note'
    case 'nav':
      return 'Action'
  }
}

export function CommandPalette({ onClose, onNavigate, onSettings, onLock }: CommandPaletteProps): JSX.Element {
  const { apiKeys, logins, recoveryCodes, secureNotes } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEscapeKey(onClose)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const items = useMemo<Item[]>(() => {
    const keyItems: Item[] = apiKeys.map((k) => ({
      kind: 'key',
      id: k.id,
      title: k.name,
      subtitle: k.project
    }))
    const loginItems: Item[] = logins.map((l) => ({
      kind: 'login',
      id: l.id,
      title: l.service,
      subtitle: l.username || '(no username)'
    }))
    const recoveryItems: Item[] = recoveryCodes.map((r) => ({
      kind: 'recovery',
      id: r.id,
      title: r.service,
      subtitle: `${r.codeCount} code${r.codeCount === 1 ? '' : 's'}`
    }))
    const noteItems: Item[] = secureNotes.map((n) => ({
      kind: 'note',
      id: n.id,
      title: n.title,
      subtitle: 'Secure note'
    }))
    return [...NAV_ITEMS, ...keyItems, ...loginItems, ...recoveryItems, ...noteItems]
  }, [apiKeys, logins, recoveryCodes, secureNotes])

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) {
      // Prefer vault items when idle; still show a few nav shortcuts.
      const vault = items.filter((i) => i.kind !== 'nav').slice(0, 16)
      return [...NAV_ITEMS.slice(0, 4), ...vault].slice(0, 20)
    }

    return items
      .map((item) => ({ item, score: fuzzyMatch([item.title, item.subtitle], q) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title))
      .slice(0, 20)
      .map((r) => r.item)
  }, [items, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  async function activate(item: Item): Promise<void> {
    if (item.kind === 'nav') {
      if (item.action === 'section' && item.section) onNavigate(item.section)
      else if (item.action === 'settings') onSettings()
      else if (item.action === 'lock') onLock()
      else onClose()
      return
    }

    let ok = false
    let label = ''
    if (item.kind === 'key') {
      ok = await window.vaultAPI.copyApiKeyValue(item.id)
      label = 'API key'
    } else if (item.kind === 'login') {
      ok = await window.vaultAPI.copyLoginPassword(item.id)
      label = 'password'
    } else if (item.kind === 'recovery') {
      ok = await window.vaultAPI.copyRecoveryCode(item.id, 0)
      label = 'recovery code'
    } else {
      ok = await window.vaultAPI.copySecureNoteContent(item.id)
      label = 'note'
    }

    push(
      ok ? `Copied ${label} for "${item.title}"` : 'Authentication failed or was cancelled',
      ok ? 'success' : 'error'
    )
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[activeIndex]
      if (item) void activate(item)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center bg-black/50 pt-24" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-vt-border bg-vt-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search everything… (Enter to copy / run)"
          className="w-full rounded-t-2xl border-b border-vt-border bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-80 overflow-y-auto p-1">
          {filtered.length === 0 && <p className="px-3 py-4 text-xs text-vt-muted">No matches.</p>}
          {filtered.map((item, i) => (
            <button
              key={`${item.kind}-${item.id}`}
              onClick={() => void activate(item)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                i === activeIndex ? 'bg-vt-surface2' : ''
              }`}
            >
              <div className="min-w-0">
                <p className="truncate">{item.title}</p>
                <p className="truncate text-xs text-vt-muted">{item.subtitle}</p>
              </div>
              <span className="ml-2 shrink-0 rounded-full bg-vt-surface2 px-2 py-0.5 text-[10px] text-vt-muted">
                {kindLabel(item.kind)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
