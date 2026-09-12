import { useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import type { Section } from '../stores/vault-store'

interface AddEntryModalProps {
  section: Section
  onClose: () => void
}

export function AddEntryModal({ section, onClose }: AddEntryModalProps): JSX.Element {
  const refresh = useVaultStore((s) => s.refresh)

  const [project, setProject] = useState('')
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [service, setService] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(): Promise<void> {
    setError(null)
    setSaving(true)
    try {
      if (section === 'keys') {
        if (mode === 'bulk') {
          if (!project.trim()) {
            setError('Project tag is required.')
            return
          }
          const entries = bulkText
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#') && line.includes('='))
            .map((line) => {
              const eq = line.indexOf('=')
              let v = line.slice(eq + 1).trim()
              if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
                v = v.slice(1, -1)
              }
              return { project: project.trim(), name: line.slice(0, eq).trim().replace(/^export\s+/, ''), value: v }
            })
            .filter((e) => e.name && e.value)
          if (entries.length === 0) {
            setError('No valid KEY=VALUE pairs found.')
            return
          }
          await window.vaultAPI.addApiKeys(entries)
        } else {
          if (!project.trim() || !name.trim() || !value.trim()) {
            setError('Project, name, and value are required.')
            return
          }
          await window.vaultAPI.addApiKey({ project: project.trim(), name: name.trim(), value: value.trim(), notes: notes.trim() || undefined })
        }
      } else {
        if (!service.trim() || !username.trim() || !password.trim()) {
          setError('Service, username, and password are required.')
          return
        }
        await window.vaultAPI.addLogin({
          service: service.trim(),
          username: username.trim(),
          password: password.trim(),
          url: url.trim() || undefined,
          notes: notes.trim() || undefined
        })
      }
      await refresh()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-sm font-semibold">
          Add {section === 'keys' ? 'API Key' : 'Login'}
        </h2>

        {section === 'keys' && (
          <div className="mb-3 flex gap-1 rounded-lg bg-vt-surface2 p-1 text-xs">
            <button
              onClick={() => setMode('single')}
              className={`flex-1 rounded-md py-1 ${mode === 'single' ? 'bg-vt-teal text-vt-bg' : 'text-vt-muted'}`}
            >
              Single key
            </button>
            <button
              onClick={() => setMode('bulk')}
              className={`flex-1 rounded-md py-1 ${mode === 'bulk' ? 'bg-vt-teal text-vt-bg' : 'text-vt-muted'}`}
            >
              Paste .env
            </button>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {section === 'keys' ? (
            <>
              <Field label="Project" value={project} onChange={setProject} placeholder="e.g. viblix" />
              {mode === 'single' ? (
                <>
                  <Field label="Key name" value={name} onChange={setName} placeholder="ANTHROPIC_API_KEY" />
                  <Field label="Value" value={value} onChange={setValue} placeholder="sk-..." mono />
                  <Field label="Notes (optional)" value={notes} onChange={setNotes} />
                </>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-medium text-vt-muted">Paste .env contents</label>
                  <textarea
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    rows={6}
                    className="w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 font-mono text-xs outline-none focus:border-vt-teal"
                    placeholder={'ANTHROPIC_API_KEY=sk-...\nYOUTUBE_API_KEY=...'}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <Field label="Service" value={service} onChange={setService} placeholder="e.g. GitHub" />
              <Field label="Username / email" value={username} onChange={setUsername} />
              <Field label="Password" value={password} onChange={setPassword} mono type="password" />
              <Field label="URL (optional)" value={url} onChange={setUrl} placeholder="https://" />
              <Field label="Notes (optional)" value={notes} onChange={setNotes} />
            </>
          )}

          {error && <p className="text-xs text-vt-danger">{error}</p>}

          <div className="mt-2 flex justify-end gap-2">
            <button onClick={onClose} className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  type = 'text'
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  type?: string
}): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-vt-muted">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal ${mono ? 'font-mono' : ''}`}
      />
    </div>
  )
}
