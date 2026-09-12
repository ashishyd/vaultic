import type { ReactNode } from 'react'
import { useVaultStore } from '../stores/vault-store'

interface PageHeaderProps {
  title: string
  searchPlaceholder?: string
  actions?: ReactNode
}

export function PageHeader({ title, searchPlaceholder, actions }: PageHeaderProps): JSX.Element {
  const { search, setSearch } = useVaultStore()

  return (
    <div className="flex items-center gap-4 border-b border-vt-border px-7 py-5">
      <h1 className="shrink-0 text-xl font-semibold">{title}</h1>
      {searchPlaceholder && (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="max-w-xs flex-1 rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal"
        />
      )}
      {actions && <div className="ml-auto flex shrink-0 gap-2">{actions}</div>}
    </div>
  )
}
