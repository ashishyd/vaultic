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
      const unlocked = await chrome.runtime.sendMessage({ type: 'unlockLogin', id: login.id })
      if (!unlocked?.ok) {
        setStatus(unlocked?.error === 'auth_declined' ? 'Auth cancelled' : 'Fill failed', 'err')
        return
      }
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillPage,
        args: [unlocked.username || '', unlocked.password || '', unlocked.totp || '']
      })
      window.close()
    })
    listEl.appendChild(btn)
  }
}

function fillPage(username, password, totp) {
  function setNativeValue(input, value) {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const passwords = [...document.querySelectorAll('input[type="password"]')].filter((el) => el.offsetParent !== null)
  const pw = passwords[0]
  if (!pw) return
  const scope = pw.form || document
  const users = [...scope.querySelectorAll('input[type="email"], input[type="text"], input[type="tel"], input[autocomplete="username"], input[autocomplete="email"]')].filter(
    (el) => el.offsetParent !== null
  )
  const user = users.find((el) => pw.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING) || users[0]
  if (user && username) setNativeValue(user, username)
  setNativeValue(pw, password)
  if (totp) navigator.clipboard.writeText(totp).catch(() => {})
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

document.getElementById('refresh').addEventListener('click', () => load())
document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage())
load()
