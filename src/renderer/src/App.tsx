import { useEffect, useState } from 'react'
import { useVaultStore } from './stores/vault-store'
import { useToastStore } from './stores/toast-store'
import { UnlockScreen } from './components/UnlockScreen'
import { Sidebar } from './components/Sidebar'
import { ApiKeyList } from './components/ApiKeyList'
import { LoginList } from './components/LoginList'
import { PasswordHealthView } from './components/PasswordHealthView'
import { RecoveryCodesView } from './components/RecoveryCodesView'
import { SecureNotesView } from './components/SecureNotesView'
import { AddEntryModal } from './components/AddEntryModal'
import { ScanImportModal } from './components/ScanImportModal'
import { ScanRecoveryCodesModal } from './components/ScanRecoveryCodesModal'
import { RecoveryCodesFormModal } from './components/RecoveryCodesFormModal'
import { SecureNoteFormModal } from './components/SecureNoteFormModal'
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
  const [showAddRecoveryCodes, setShowAddRecoveryCodes] = useState(false)
  const [showScanRecoveryCodes, setShowScanRecoveryCodes] = useState(false)
  const [editRecoveryCodesId, setEditRecoveryCodesId] = useState<string | null>(null)
  const [showAddSecureNote, setShowAddSecureNote] = useState(false)
  const [editSecureNoteId, setEditSecureNoteId] = useState<string | null>(null)

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
            {section === 'recovery' && (
              <RecoveryCodesView
                onEdit={(id) => setEditRecoveryCodesId(id)}
                onAdd={() => setShowAddRecoveryCodes(true)}
                onScan={() => setShowScanRecoveryCodes(true)}
              />
            )}
            {section === 'notes' && (
              <SecureNotesView onEdit={(id) => setEditSecureNoteId(id)} onAdd={() => setShowAddSecureNote(true)} />
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
          {showAddRecoveryCodes && (
            <RecoveryCodesFormModal onClose={() => setShowAddRecoveryCodes(false)} />
          )}
          {showScanRecoveryCodes && (
            <ScanRecoveryCodesModal onClose={() => setShowScanRecoveryCodes(false)} />
          )}
          {editRecoveryCodesId && (
            <RecoveryCodesFormModal id={editRecoveryCodesId} onClose={() => setEditRecoveryCodesId(null)} />
          )}
          {showAddSecureNote && <SecureNoteFormModal onClose={() => setShowAddSecureNote(false)} />}
          {editSecureNoteId && (
            <SecureNoteFormModal id={editSecureNoteId} onClose={() => setEditSecureNoteId(null)} />
          )}
        </div>
      )}

      <ToastContainer />
    </>
  )
}
