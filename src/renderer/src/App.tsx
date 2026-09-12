import { useEffect, useState } from 'react'
import { useVaultStore } from './stores/vault-store'
import { useToastStore } from './stores/toast-store'
import { UnlockScreen } from './components/UnlockScreen'
import { Sidebar } from './components/Sidebar'
import { ApiKeyList } from './components/ApiKeyList'
import { LoginList } from './components/LoginList'
import { PasswordHealthView } from './components/PasswordHealthView'
import { AddEntryModal } from './components/AddEntryModal'
import { ScanImportModal } from './components/ScanImportModal'
import { ImportLoginsModal } from './components/ImportLoginsModal'
import { EditEntryModal } from './components/EditEntryModal'
import { SettingsModal } from './components/SettingsModal'
import { ToastContainer } from './components/ToastContainer'
import { CommandPalette } from './components/CommandPalette'
import { LabelManagerModal } from './components/LabelManagerModal'

export interface EditTarget {
  kind: 'key' | 'login'
  id: string
}

export default function App(): JSX.Element {
  const { unlocked, hasVault, section, setUnlocked, setHasVault, refresh } = useVaultStore()
  const push = useToastStore((s) => s.push)
  const [showAdd, setShowAdd] = useState(false)
  const [showScan, setShowScan] = useState(false)
  const [showImportLogins, setShowImportLogins] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [showLabelManager, setShowLabelManager] = useState(false)
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)

  useEffect(() => {
    window.vaultAPI.hasVault().then(setHasVault)
  }, [setHasVault])

  useEffect(() => {
    if (unlocked) refresh()
  }, [unlocked, refresh])

  useEffect(() => {
    const unsubscribe = window.vaultAPI.onAutoLocked(() => {
      setUnlocked(false)
      push('Vault locked due to inactivity', 'info')
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      if (isCmdK && unlocked) {
        e.preventDefault()
        setShowPalette((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [unlocked])

  async function handleLock(): Promise<void> {
    await window.vaultAPI.lock()
    setUnlocked(false)
  }

  return (
    <>
      {!unlocked ? (
        <UnlockScreen
          hasVault={hasVault}
          onUnlocked={() => {
            setHasVault(true)
            setUnlocked(true)
          }}
        />
      ) : (
        <div className="flex h-screen">
          <Sidebar onLock={handleLock} onSettings={() => setShowSettings(true)} />
          <main className="flex-1 overflow-hidden">
            {section === 'keys' && (
              <ApiKeyList
                onEdit={(id) => setEditTarget({ kind: 'key', id })}
                onAdd={() => setShowAdd(true)}
                onScan={() => setShowScan(true)}
              />
            )}
            {section === 'logins' && (
              <LoginList
                onEdit={(id) => setEditTarget({ kind: 'login', id })}
                onManageLabels={() => setShowLabelManager(true)}
                onAdd={() => setShowAdd(true)}
                onImportLogins={() => setShowImportLogins(true)}
              />
            )}
            {section === 'analysis' && <PasswordHealthView />}
          </main>

          {showAdd && <AddEntryModal section={section} onClose={() => setShowAdd(false)} />}
          {showScan && <ScanImportModal onClose={() => setShowScan(false)} />}
          {showImportLogins && <ImportLoginsModal onClose={() => setShowImportLogins(false)} />}
          {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
          {editTarget && (
            <EditEntryModal kind={editTarget.kind} id={editTarget.id} onClose={() => setEditTarget(null)} />
          )}
          {showPalette && <CommandPalette onClose={() => setShowPalette(false)} />}
          {showLabelManager && <LabelManagerModal onClose={() => setShowLabelManager(false)} />}
        </div>
      )}

      <ToastContainer />
    </>
  )
}
