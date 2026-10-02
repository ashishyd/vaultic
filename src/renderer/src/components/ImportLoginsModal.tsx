import { useMemo, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { useEscapeKey } from '../lib/use-escape-key'
import type { CsvLoginRow } from '../../../preload/api-types'

interface ImportLoginsModalProps {
  onClose: () => void
}

function loginKey(service: string, username: string): string {
  return `${service.trim().toLowerCase()}\0${username.trim().toLowerCase()}`
}

export function ImportLoginsModal({ onClose }: ImportLoginsModalProps): JSX.Element {
  const logins = useVaultStore((s) => s.logins)
  const refresh = useVaultStore((s) => s.refresh)
  const push = useToastStore((s) => s.push)
  useEscapeKey(onClose)

  const [filePath, setFilePath] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [rows, setRows] = useState<CsvLoginRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deleteAfterImport, setDeleteAfterImport] = useState(true)
  const [importing, setImporting] = useState(false)

  const existingKeys = useMemo(
    () => new Set(logins.map((l) => loginKey(l.service, l.username))),
    [logins]
  )

  const duplicateIndexes = useMemo(() => {
    const dups = new Set<number>()
    rows.forEach((row, i) => {
      if (existingKeys.has(loginKey(row.service, row.username))) dups.add(i)
    })
    return dups
  }, [rows, existingKeys])

  async function handlePickAndParse(): Promise<void> {
    const picked = await window.vaultAPI.pickCsvFile()
    if (!picked) return
    setFilePath(picked)
    setParseError(null)
    setParsing(true)
    try {
      const parsed = await window.vaultAPI.parseLoginsCsv(picked)
      setRows(parsed)
      // Pre-select non-duplicates only.
      const existing = new Set(logins.map((l) => loginKey(l.service, l.username)))
      setSelected(
        new Set(
          parsed
            .map((row, i) => (existing.has(loginKey(row.service, row.username)) ? -1 : i))
            .filter((i) => i >= 0)
        )
      )
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Could not read that file.')
      setRows([])
    } finally {
      setParsing(false)
    }
  }

  function toggle(i: number): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  async function handleImport(): Promise<void> {
    setImporting(true)
    try {
      const entries = rows.filter((_, i) => selected.has(i))
      const unique = entries.filter((row) => !existingKeys.has(loginKey(row.service, row.username)))
      const skippedSelectedDuplicates = entries.length - unique.length

      if (unique.length > 0) {
        await window.vaultAPI.addLogins(unique)
        await refresh()
      }

      if (deleteAfterImport && filePath) {
        await window.vaultAPI.deleteFile(filePath)
      }

      if (unique.length === 0 && skippedSelectedDuplicates > 0) {
        push('Nothing new to import — selected logins already exist', 'info')
      } else if (skippedSelectedDuplicates > 0) {
        push(
          `Imported ${unique.length}, skipped ${skippedSelectedDuplicates} duplicate${skippedSelectedDuplicates === 1 ? '' : 's'}`,
          'success'
        )
      } else if (unique.length > 0) {
        push(`Imported ${unique.length} login${unique.length === 1 ? '' : 's'}`, 'success')
      }

      onClose()
    } finally {
      setImporting(false)
    }
  }

  const totalSelected = selected.size
  const duplicateCount = duplicateIndexes.size

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold">Import logins from Chrome (or any browser)</h2>
        <p className="mb-3 text-xs text-vt-muted">
          Chrome keeps saved passwords encrypted for its own use only, so there&apos;s no direct read — export them
          first: open <span className="font-mono text-vt-teal">chrome://password-manager/passwords</span>, click the
          ⋮ menu → <span className="text-vt-text">Export passwords</span>, and authenticate with Touch ID or your
          Mac password. That saves a CSV file (usually to Downloads) — pick it below.
        </p>

        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={handlePickAndParse}
            className="rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2"
          >
            Choose CSV file…
          </button>
          {filePath && <span className="truncate text-xs text-vt-muted">{filePath}</span>}
        </div>

        {parsing && <p className="text-xs text-vt-muted">Reading…</p>}
        {parseError && <p className="text-xs text-vt-danger">{parseError}</p>}

        {!parsing && rows.length > 0 && (
          <>
            {duplicateCount > 0 && (
              <p className="mb-2 text-xs text-vt-muted">
                {duplicateCount} already in your vault (unchecked by default). Duplicates are matched by service +
                username.
              </p>
            )}
            <div className="flex-1 overflow-y-auto rounded-lg border border-vt-border">
              {rows.map((row, i) => {
                const isDup = duplicateIndexes.has(i)
                return (
                  <label
                    key={i}
                    className="flex items-center gap-2 border-b border-vt-border px-3 py-2 text-xs last:border-b-0"
                  >
                    <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-vt-text">{row.service}</p>
                      <p className="truncate text-vt-muted">{row.username || '(no username)'}</p>
                    </div>
                    {isDup && (
                      <span className="shrink-0 rounded-full border border-vt-border px-1.5 py-0.5 text-[10px] text-vt-muted">
                        exists
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          </>
        )}

        {!parsing && filePath && rows.length === 0 && !parseError && (
          <p className="text-xs text-vt-muted">No login rows found in that file.</p>
        )}

        {rows.length > 0 && (
          <label className="mt-3 flex items-center gap-2 text-xs text-vt-muted">
            <input
              type="checkbox"
              checked={deleteAfterImport}
              onChange={(e) => setDeleteAfterImport(e.target.checked)}
            />
            Delete this CSV file after import (recommended — it&apos;s plaintext)
          </label>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={importing || totalSelected === 0}
            className="rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
          >
            {importing ? 'Importing…' : `Import ${totalSelected} login${totalSelected === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
