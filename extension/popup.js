const statusEl = document.getElementById('status')
const listEl = document.getElementById('list')
const pageEl = document.getElementById('page')

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

function setStatus(text, kind) {
  statusEl.textContent = text
  statusEl.className = `status ${kind || ''}`
}

async function load() {
  listEl.innerHTML = ''
  const tab = await activeTab()
  if (!tab?.url || !/^https?:/.test(tab.url)) {
    pageEl.textContent = 'Open a website to see matching logins.'
    setStatus('Idle', '')
    return
  }
  pageEl.textContent = new URL(tab.url).hostname

  const status = await chrome.runtime.sendMessage({ type: 'status' })
  if (!status?.ok && status?.error === 'bridge_unreachable') {
    setStatus('Vaultic not running', 'err')
    listEl.innerHTML = `<div class="empty">Start the Vaultic desktop app, then click Refresh. If this is the first time, open Options and paste your bridge token (or install the native host from Vaultic → Settings).</div>`
    return
  }
  if (status?.error === 'no_token' || status?.error === 'unauthorized' || status?.status === 401) {
    setStatus('Needs setup', 'warn')
    listEl.innerHTML = `<div class="empty">Open Options and paste the bridge token from Vaultic → Settings → Browser extension. Or click “Install browser bridge” in Vaultic Settings.</div>`
    return
  }
  if (!status?.unlocked) {
    setStatus('Locked', 'warn')
    listEl.innerHTML = `<div class="empty">Unlock Vaultic on your Mac to fill or save logins.</div>`
    return
  }
  setStatus('Unlocked', 'ok')

  const result = await chrome.runtime.sendMessage({ type: 'findLogins', url: tab.url })
  const logins = result?.logins || []
  if (!logins.length) {
    listEl.innerHTML = `<div class="empty">No saved logins match this site. Log in once and Vaultic will offer to save.</div>`
    return
  }

  for (const login of logins) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'login'
    btn.innerHTML = `<strong>${escapeHtml(login.service)}</strong><span>${escapeHtml(login.username || '(no username)')}${login.hasTotp ? ' · TOTP' : ''}</span>`
    btn.addEventListener('click', async () => {
      btn.disabled = true
      setStatus('Authenticating…', 'warn')
      const unlocked = await chrome.runtime.sendMessage({ type: 'unlockLogin', id: login.id })
      if (!unlocked?.ok) {
        btn.disabled = false
        setStatus(unlocked?.error === 'auth_declined' ? 'Auth cancelled' : 'Fill failed', 'err')
        return
      }
      if (!unlocked.password) {
        btn.disabled = false
        setStatus('Login has no password saved', 'err')
        return
      }
      // Hand off to the service worker, then close so the page regains focus and
      // restores password fields (many SSO pages hide them while the popup is open).
      await chrome.runtime.sendMessage({
        type: 'scheduleFill',
        tabId: tab.id,
        username: unlocked.username || '',
        password: unlocked.password || '',
        totp: unlocked.totp || ''
      })
      window.close()
    })
    listEl.appendChild(btn)
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

document.getElementById('refresh').addEventListener('click', () => load())
document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage())
load()
