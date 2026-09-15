import { useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import type { ScannedFile } from '../../../preload/api-types'

interface ScanImportModalProps {
  onClose: () => void
}

export function ScanImportModal({ onClose }: ScanImportModalProps): JSX.Element {
  const apiKeys = useVaultStore((s) => s.apiKeys)
  const refresh = useVaultStore((s) => s.refresh)
  const [folder, setFolder] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [results, setResults] = useState<ScannedFile[]>([])
  const [skippedProjects, setSkippedProjects] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  function keyId(fileIdx: number, keyIdx: number): string {
    return `${fileIdx}:${keyIdx}`
  }

  async function handlePickAndScan(): Promise<void> {
    const picked = await window.vaultAPI.pickFolder()
    if (!picked) return
    setFolder(picked)
    setScanning(true)
    try {
      const scanResults = await window.vaultAPI.scanFolder(picked)
      // Projects already in the vault aren't rescanned — delete the folder from
      // API Keys first if you want to re-import it with fresh values.
      const existingProjects = new Set(apiKeys.map((k) => k.project))
      const fresh = scanResults.filter((file) => !existingProjects.has(file.project))
      const skipped = [...new Set(scanResults.filter((file) => existingProjects.has(file.project)).map((f) => f.project))]
      setResults(fresh)
      setSkippedProjects(skipped)
      const all = new Set<string>()
      fresh.forEach((file, fi) => file.keys.forEach((_, ki) => all.add(keyId(fi, ki))))
      setSelected(all)
    } finally {
      setScanning(false)
    }
  }

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleImport(): Promise<void> {
    setImporting(true)
    try {
      const entries: Array<{ project: string; name: string; value: string; envFile: string }> = []
      results.forEach((file, fi) => {
        const envFile = file.filePath.split(/[/\\]/).pop() ?? file.filePath
        file.keys.forEach((key, ki) => {
          if (selected.has(keyId(fi, ki))) {
            entries.push({ project: file.project, name: key.name, value: key.value, envFile })
          }
        })
      })
      if (entries.length > 0) {
        await window.vaultAPI.addApiKeys(entries)
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
        <h2 className="mb-1 text-sm font-semibold">Scan a folder for .env files</h2>
        <p className="mb-4 text-xs text-vt-muted">
          Read-only scan. Nothing is saved until you review and confirm below.
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

        {!scanning && skippedProjects.length > 0 && (
          <p className="mb-3 text-xs text-vt-muted">
            Already imported, skipped: <span className="font-medium">{skippedProjects.join(', ')}</span>. Delete the
            folder in API Keys first to rescan it.
          </p>
        )}

        {!scanning && results.length > 0 && (
          <div className="flex-1 overflow-y-auto rounded-lg border border-vt-border">
            {results.map((file, fi) => (
              <div key={file.filePath} className="border-b border-vt-border p-3 last:border-b-0">
                <p className="mb-1 text-xs font-semibold text-vt-teal">{file.project}</p>
                <p className="mb-2 truncate text-[11px] text-vt-muted">{file.filePath}</p>
                <div className="flex flex-col gap-1">
                  {file.keys.map((key, ki) => {
                    const id = keyId(fi, ki)
                    return (
                      <label key={id} className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} />
                        <span className="font-mono">{key.name}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {!scanning && folder && results.length === 0 && skippedProjects.length === 0 && (
          <p className="text-xs text-vt-muted">No .env files with keys found in that folder.</p>
        )}

        {!scanning && folder && results.length === 0 && skippedProjects.length > 0 && (
          <p className="text-xs text-vt-muted">Nothing new to import — every project found was already scanned.</p>
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
            {importing ? 'Importing…' : `Import ${totalSelected} key${totalSelected === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
