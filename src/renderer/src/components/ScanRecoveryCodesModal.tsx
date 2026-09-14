import { useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import type { ScannedRecoveryCodes } from '../../../preload/api-types'

interface ScanRecoveryCodesModalProps {
  onClose: () => void
}

export function ScanRecoveryCodesModal({ onClose }: ScanRecoveryCodesModalProps): JSX.Element {
  const refresh = useVaultStore((s) => s.refresh)
  const [folder, setFolder] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [results, setResults] = useState<ScannedRecoveryCodes[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [importing, setImporting] = useState(false)

  async function handlePickAndScan(): Promise<void> {
    const picked = await window.vaultAPI.pickFolder()
    if (!picked) return
    setFolder(picked)
    setScanning(true)
    try {
      const scanResults = await window.vaultAPI.scanFolderForRecoveryCodes(picked)
      setResults(scanResults)
      setSelected(new Set(scanResults.map((_, i) => i)))
    } finally {
      setScanning(false)
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
      const entries = results
        .filter((_, i) => selected.has(i))
        .map((r) => ({ service: r.service, codes: r.codes }))
      if (entries.length > 0) {
        await window.vaultAPI.addRecoveryCodesBatch(entries)
        await refresh()
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
        <h2 className="mb-1 text-sm font-semibold">Scan a folder for recovery codes</h2>
        <p className="mb-4 text-xs text-vt-muted">
          Looks for exported 2FA/account backup-code files (e.g. Downloads). Read-only — nothing is saved until you
          review and confirm below.
        </p>

        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={handlePickAndScan}
            className="rounded-lg border border-vt-border px-3 py-1.5 text-sm hover:bg-vt-surface2"
          >
            Choose folder…
          </button>
          {folder && <span className="truncate text-xs text-vt-muted">{folder}</span>}
        </div>

        {scanning && <p className="text-xs text-vt-muted">Scanning…</p>}

        {!scanning && results.length > 0 && (
          <div className="flex-1 overflow-y-auto rounded-lg border border-vt-border">
            {results.map((file, i) => (
              <label
                key={file.filePath}
                className="flex cursor-pointer items-start gap-2 border-b border-vt-border p-3 last:border-b-0"
              >
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={() => toggle(i)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-vt-teal">{file.service}</p>
                  <p className="mb-1 truncate text-[11px] text-vt-muted">{file.filePath}</p>
                  <p className="text-[11px] text-vt-muted">{file.codes.length} codes found</p>
                </div>
              </label>
            ))}
          </div>
        )}

        {!scanning && folder && results.length === 0 && (
          <p className="text-xs text-vt-muted">No recovery-code files found in that folder.</p>
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
            {importing ? 'Importing…' : `Import ${totalSelected} entr${totalSelected === 1 ? 'y' : 'ies'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
