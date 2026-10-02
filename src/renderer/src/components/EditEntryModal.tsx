import { useEffect, useState } from 'react'
import { useVaultStore } from '../stores/vault-store'
import { useToastStore } from '../stores/toast-store'
import { useEscapeKey } from '../lib/use-escape-key'

interface EditEntryModalProps {
  kind: 'key' | 'login'
  id: string
  onClose: () => void
}

export function EditEntryModal({ kind, id, onClose }: EditEntryModalProps): JSX.Element {
  const { apiKeys, logins, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)
  useEscapeKey(onClose)

  const [loadingSecret, setLoadingSecret] = useState(true)
  const [secretUnavailable, setSecretUnavailable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [project, setProject] = useState('')
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [service, setService] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [totpSecret, setTotpSecret] = useState('')
  const [clearTotp, setClearTotp] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      if (kind === 'key') {
        const key = apiKeys.find((k) => k.id === id)
        if (key) {
          setProject(key.project)
          setName(key.name)
          setNotes(key.notes ?? '')
        }
        const revealed = await window.vaultAPI.revealApiKeyValue(id)
        if (cancelled) return
        if (revealed === null) {
          setSecretUnavailable(true)
        } else {
          setValue(revealed)
        }
      } else {
        const login = logins.find((l) => l.id === id)
        if (login) {
          setService(login.service)
          setUsername(login.username)
          setUrl(login.url ?? '')
          setNotes(login.notes ?? '')
        }
        const revealed = await window.vaultAPI.revealLoginPassword(id)
        if (cancelled) return
        if (revealed === null) {
          setSecretUnavailable(true)
        } else {
          setPassword(revealed)
        }
        // Don't auto-reveal TOTP secret (would double-prompt). Leave blank = keep existing.
      }
      if (!cancelled) setLoadingSecret(false)
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id])

  async function handleGenerate(target: 'password' | 'value'): Promise<void> {
    setGenerating(true)
    try {
      const generated = await window.vaultAPI.generateStrongPassword()
      if (target === 'password') setPassword(generated)
      else setValue(generated)
    } finally {
      setGenerating(false)
    }
  }

  async function handleSave(): Promise<void> {
    setError(null)
    if (kind === 'key') {
      if (!project.trim() || !name.trim() || !value.trim()) {
        setError('Project, name, and value are required.')
        return
      }
    } else {
      if (!service.trim() || !password.trim()) {
        setError('Service and password are required.')
        return
      }
    }

    setSaving(true)
    try {
      if (kind === 'key') {
        const result = await window.vaultAPI.updateApiKey(id, {
          project: project.trim(),
          name: name.trim(),
          value: value.trim(),
          notes: notes.trim() || undefined
        })
        if (!result) {
          setError('Could not save — authentication was declined.')
          return
        }
      } else {
        const result = await window.vaultAPI.updateLogin(id, {
          service: service.trim(),
          username: username.trim(),
          password: password.trim(),
          url: url.trim() || undefined,
          notes: notes.trim() || undefined,
          totpSecret: clearTotp ? null : totpSecret.trim() ? totpSecret.trim() : undefined
        })
        if (!result) {
          setError('Could not save — authentication was declined.')
          return
        }
      }
      await refresh()
      push('Saved', 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
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
        <h2 className="mb-4 text-sm font-semibold">Edit {kind === 'key' ? 'API Key' : 'Login'}</h2>

        {loadingSecret ? (
          <p className="text-xs text-vt-muted">Waiting for authentication…</p>
        ) : secretUnavailable ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-vt-danger">
              Could not unlock the current value — authentication was declined or cancelled.
            </p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {kind === 'key' ? (
              <>
                <Field label="Project" value={project} onChange={setProject} />
                <Field label="Key name" value={name} onChange={setName} />
                <Field
                  label="Value"
                  value={value}
                  onChange={setValue}
                  mono
                  onGenerate={() => void handleGenerate('value')}
                  generating={generating}
                />
                <Field label="Notes (optional)" value={notes} onChange={setNotes} />
              </>
            ) : (
              <>
                <Field label="Service" value={service} onChange={setService} />
                <Field
                  label="Username / email (optional)"
                  value={username}
                  onChange={setUsername}
                  placeholder="Leave blank for file passwords"
                />
                <Field
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  mono
                  onGenerate={() => void handleGenerate('password')}
                  generating={generating}
                />
                <Field label="URL (optional)" value={url} onChange={setUrl} placeholder="https://" />
                <Field
                  label={
                    logins.find((l) => l.id === id)?.hasTotp
                      ? 'TOTP secret (leave blank to keep)'
                      : 'TOTP secret (optional)'
                  }
                  value={totpSecret}
                  onChange={(v) => {
                    setTotpSecret(v)
                    setClearTotp(false)
                  }}
                  placeholder="Base32 or otpauth://…"
                  mono
                />
                {Boolean(logins.find((l) => l.id === id)?.hasTotp) && (
                  <label className="flex items-center gap-2 text-xs text-vt-muted">
                    <input
                      type="checkbox"
                      checked={clearTotp}
                      onChange={(e) => {
                        setClearTotp(e.target.checked)
                        if (e.target.checked) setTotpSecret('')
                      }}
                    />
                    Remove authenticator / TOTP
                  </label>
                )}
                <Field label="Notes (optional)" value={notes} onChange={setNotes} />
              </>
            )}

            {error && <p className="text-xs text-vt-danger">{error}</p>}

            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2"
              >
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
        )}
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
  onGenerate,
  generating
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
  onGenerate?: () => void
  generating?: boolean
}): JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="block text-xs font-medium text-vt-muted">{label}</label>
        {onGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="text-[11px] font-medium text-vt-teal hover:underline disabled:opacity-50"
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
        )}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal ${mono ? 'font-mono' : ''}`}
      />
    </div>
  )
}
