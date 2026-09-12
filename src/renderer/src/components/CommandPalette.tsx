import { useEffect, useMemo, useRef, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'

interface CommandPaletteProps {
  onClose: () => void
}

interface Item {
  id: string
  kind: 'key' | 'login'
  title: string
  subtitle: string
}

export function CommandPalette({ onClose }: CommandPaletteProps): JSX.Element {
  const { apiKeys, logins } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const items = useMemo<Item[]>(() => {
    const keyItems: Item[] = apiKeys.map((k) => ({
      id: k.id,
      kind: 'key',
      title: k.name,
      subtitle: k.project
    }))
    const loginItems: Item[] = logins.map((l) => ({
      id: l.id,
      kind: 'login',
      title: l.service,
      subtitle: l.username
    }))
    return [...keyItems, ...loginItems]
  }, [apiKeys, logins])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items.slice(0, 20)
    return items
      .filter((i) => i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q))
      .slice(0, 20)
  }, [items, query])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  async function activate(item: Item): Promise<void> {
    const ok =
      item.kind === 'key'
        ? await window.vaultAPI.copyApiKeyValue(item.id)
        : await window.vaultAPI.copyLoginPassword(item.id)
    push(
      ok ? `Copied ${item.kind === 'key' ? 'API key' : 'password'} for "${item.title}"` : 'Touch ID failed or was cancelled',
      ok ? 'success' : 'error'
    )
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[activeIndex]
      if (item) activate(item)
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
          placeholder="Search API keys and logins… (Enter to copy)"
          className="w-full rounded-t-2xl border-b border-vt-border bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-80 overflow-y-auto p-1">
          {filtered.length === 0 && <p className="px-3 py-4 text-xs text-vt-muted">No matches.</p>}
          {filtered.map((item, i) => (
            <button
              key={`${item.kind}-${item.id}`}
              onClick={() => activate(item)}
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
                {item.kind === 'key' ? 'API key' : 'Login'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
