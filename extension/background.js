import { vaultRequest, setStoredToken } from './bridge.js'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message).then(sendResponse)
  return true // async
})

async function handle(message) {
  switch (message?.type) {
    case 'status':
      return vaultRequest('status')
    case 'findLogins':
      return vaultRequest('findLogins', { url: message.url })
    case 'unlockLogin':
      return vaultRequest('unlockLogin', { id: message.id })
    case 'saveLogin':
      return vaultRequest('saveLogin', message)
    case 'setToken':
      await setStoredToken(message.token)
      return { ok: true }
    case 'getToken': {
      const { bridgeToken } = await chrome.storage.local.get('bridgeToken')
      return { ok: true, token: bridgeToken || '' }
    }
    case 'scheduleFill': {
      // Popup closes immediately; fill after the page regains focus (banks hide
      // password fields while the extension popup is open).
      fillTabWithRetry(message).catch(() => {})
      return { ok: true, scheduled: true }
    }
    default:
      return { ok: false, error: 'unknown' }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Injected into the page — must stay self-contained (no outer scope). */
function pageFillCredentials(username, password) {
  function isCandidate(el) {
    if (!el || el.disabled) return false
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    return true
  }

  function collectInputs(root, out = []) {
    if (!root) return out
    const nodes = root.querySelectorAll ? root.querySelectorAll('input') : []
    for (const el of nodes) {
      out.push(el)
      if (el.shadowRoot) collectInputs(el.shadowRoot, out)
    }
    const all = root.querySelectorAll ? root.querySelectorAll('*') : []
    for (const el of all) {
      if (el.shadowRoot) collectInputs(el.shadowRoot, out)
    }
    return out
  }

  function setNativeValue(input, value) {
    input.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('focusin', { bubbles: true }))
    input.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertReplacementText',
        data: value
      })
    )
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new Event('blur', { bubbles: true }))
    input.focus()
  }

  const inputs = collectInputs(document)
  const passwords = inputs.filter(
    (el) =>
      (el.type === 'password' ||
        el.autocomplete === 'current-password' ||
        el.autocomplete === 'new-password') &&
      isCandidate(el)
  )
  if (!passwords.length) return { ok: false, error: 'no_password_field', scanned: inputs.length }

  const pw = passwords[0]
  const scope =
    pw.closest('form') ||
    pw.closest('[class*="login" i], [class*="auth" i], main') ||
    document
  const userCandidates = [...scope.querySelectorAll('input')].filter(
    (el) =>
      el !== pw &&
      el.type !== 'password' &&
      el.type !== 'hidden' &&
      el.type !== 'submit' &&
      el.type !== 'button' &&
      isCandidate(el) &&
      (el.type === 'text' ||
        el.type === 'email' ||
        el.type === 'tel' ||
        /user|email|login|id/i.test(el.name || '') ||
        /user|email|login|id/i.test(el.id || '') ||
        el.autocomplete === 'username' ||
        el.autocomplete === 'email')
  )
  const userField =
    userCandidates.filter((el) => pw.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING).at(-1) ||
    userCandidates[0] ||
    null

  if (userField && username) setNativeValue(userField, username)
  if (password) setNativeValue(pw, password)
  return { ok: true }
}

async function tryFill(tabId, username, password, totp) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: pageFillCredentials,
    args: [username, password]
  })
  const hit = results?.find((r) => r.result?.ok)
  if (!hit) {
    return results?.find((r) => r.result?.error)?.result || { ok: false, error: 'no_password_field' }
  }
  if (totp) {
    await chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [hit.frameId] },
        func: async (code) => {
          try {
            await navigator.clipboard.writeText(code)
          } catch {
            /* ignore */
          }
        },
        args: [totp]
      })
      .catch(() => {})
  }
  await chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [hit.frameId] },
      func: (withTotp) => {
        let toast = document.querySelector('.vaultic-toast')
        if (!toast) {
          toast = document.createElement('div')
          toast.className = 'vaultic-toast'
          document.body.appendChild(toast)
        }
        toast.textContent = withTotp ? 'Filled — TOTP copied' : 'Filled from Vaultic'
        toast.classList.add('vaultic-toast-show')
        clearTimeout(toast._t)
        toast._t = setTimeout(() => toast.classList.remove('vaultic-toast-show'), 2800)
      },
      args: [Boolean(totp)]
    })
    .catch(() => {})
  return hit.result
}

async function fillTabWithRetry({ tabId, username, password, totp }) {
  // Wait for popup to close so blur-sensitive login pages restore inputs.
  await sleep(120)
  for (let i = 0; i < 10; i++) {
    try {
      const result = await tryFill(tabId, username, password, totp || '')
      if (result?.ok) return result
    } catch {
      /* tab may be briefly unavailable */
    }
    await sleep(100 + i * 50)
  }
  await chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => {
        let toast = document.querySelector('.vaultic-toast')
        if (!toast) {
          toast = document.createElement('div')
          toast.className = 'vaultic-toast'
          document.body.appendChild(toast)
        }
        toast.textContent = 'Could not find a password field — click the page and try again'
        toast.classList.add('vaultic-toast-show')
        clearTimeout(toast._t)
        toast._t = setTimeout(() => toast.classList.remove('vaultic-toast-show'), 4000)
      }
    })
    .catch(() => {})
  return { ok: false, error: 'no_password_field' }
}

// Toolbar badge: show match count for active tab when possible
chrome.tabs.onActivated.addListener(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.url?.startsWith('http')) await refreshBadge(tab)
  } catch {
    /* ignore */
  }
})

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === 'complete' && tab.active && tab.url?.startsWith('http')) {
    await refreshBadge(tab)
  }
})

async function refreshBadge(tab) {
  const result = await vaultRequest('findLogins', { url: tab.url })
  if (result.ok && Array.isArray(result.logins) && result.logins.length > 0) {
    chrome.action.setBadgeText({ text: String(result.logins.length), tabId: tab.id })
    chrome.action.setBadgeBackgroundColor({ color: '#2DD4BF', tabId: tab.id })
  } else {
    chrome.action.setBadgeText({ text: '', tabId: tab.id })
  }
}
