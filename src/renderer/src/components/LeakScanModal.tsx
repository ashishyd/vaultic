import { useState } from 'react'
import type { LeakScanResult } from '../../../preload/api-types'
import { useToastStore } from '../stores/toast-store'
import { useEscapeKey } from '../lib/use-escape-key'
import { ModalBackdrop } from './ModalBackdrop'

interface LeakScanModalProps {
  onClose: () => void
}

export function LeakScanModal({ onClose }: LeakScanModalProps): JSX.Element {
  useEscapeKey(onClose)
  const push = useToastStore((s) => s.push)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<LeakScanResult | null>(null)

  async function handlePickAndScan(): Promise<void> {
    const picked = await window.vaultAPI.pickFolder()
    if (!picked) return
    setScanning(true)
    try {
      const scan = await window.vaultAPI.scanForLeaks(picked)
      if (scan === null) push('Touch ID failed or was cancelled', 'error')
      else setResult(scan)
    } finally {
      setScanning(false)
    }
  }

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-sm font-semibold">Check for leaks</h2>
        <p className="mb-4 text-xs text-vt-muted">
          Looks for exact copies of your API key values in the folder you pick and in your shell history. Files
          are read on this Mac only; values are never shown.
        </p>

        {result && (
          <div className="mb-4 max-h-72 overflow-y-auto">
            {result.hits.length === 0 ? (
              <p className="text-sm text-vt-teal">No leaks found in {result.filesScanned} files.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {result.hits.map((h, i) => (
                  <div key={i} className="rounded-xl border border-vt-border p-4">
                    <div className="break-all font-mono text-xs">
                      {h.filePath}:{h.line}
                    </div>
                    <div className="mt-1 text-xs text-vt-danger">
                      {h.project} › {h.name}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {result.envFileCount > 0 && (
              <p className="mt-3 text-xs text-vt-muted">
                Also found in {result.envFileCount} .env file{result.envFileCount === 1 ? '' : 's'} (expected, not
                listed).
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
          >
            Close
          </button>
          <button
            onClick={() => void handlePickAndScan()}
            disabled={scanning}
            className="rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
          >
            {scanning ? 'Scanning…' : result ? 'Scan another folder…' : 'Choose folder…'}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  )
}
