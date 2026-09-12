import { useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import type { CsvLoginRow } from '../../../preload/api-types'

interface ImportLoginsModalProps {
  onClose: () => void
}

export function ImportLoginsModal({ onClose }: ImportLoginsModalProps): JSX.Element {
  const refresh = useVaultStore((s) => s.refresh)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [rows, setRows] = useState<CsvLoginRow[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deleteAfterImport, setDeleteAfterImport] = useState(true)
  const [importing, setImporting] = useState(false)

  async function handlePickAndParse(): Promise<void> {
    const picked = await window.vaultAPI.pickCsvFile()
    if (!picked) return
    setFilePath(picked)
    setParseError(null)
    setParsing(true)
    try {
      const parsed = await window.vaultAPI.parseLoginsCsv(picked)
      setRows(parsed)
      setSelected(new Set(parsed.map((_, i) => i)))
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
      if (entries.length > 0) {
        await window.vaultAPI.addLogins(entries)
        await refresh()
      }
      if (deleteAfterImport && filePath) {
        await window.vaultAPI.deleteFile(filePath)
      }
      onClose()
    } finally {
      setImporting(false)
    }
  }

  const totalSelected = selected.size

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold">Import logins from Chrome (or any browser)</h2>
        <p className="mb-3 text-xs text-vt-muted">
          Chrome keeps saved passwords encrypted for its own use only, so there's no direct read — export them
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
          <div className="flex-1 overflow-y-auto rounded-lg border border-vt-border">
            {rows.map((row, i) => (
              <label
                key={i}
                className="flex items-center gap-2 border-b border-vt-border px-3 py-2 text-xs last:border-b-0"
              >
                <input type="checkbox" checked={selected.has(i)} onChange={() => toggle(i)} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-vt-text">{row.service}</p>
                  <p className="truncate text-vt-muted">{row.username}</p>
                </div>
              </label>
            ))}
          </div>
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
            Delete this CSV file after import (recommended — it's plaintext)
          </label>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2">
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
