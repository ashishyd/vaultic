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
    default:
      return { ok: false, error: 'unknown' }
  }
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
