import { setStoredToken, vaultRequest } from './bridge.js'

const tokenInput = document.getElementById('token')
const msg = document.getElementById('msg')

chrome.storage.local.get('bridgeToken').then(({ bridgeToken }) => {
  if (bridgeToken) tokenInput.value = bridgeToken
})

document.getElementById('save').addEventListener('click', async () => {
  await setStoredToken(tokenInput.value.trim())
  msg.textContent = 'Token saved.'
})

document.getElementById('clear').addEventListener('click', async () => {
  tokenInput.value = ''
  await setStoredToken('')
  msg.textContent = 'Token cleared.'
})

document.getElementById('test').addEventListener('click', async () => {
  msg.textContent = 'Testing…'
  const ping = await vaultRequest('ping')
  if (!ping.ok && ping.error === 'native_unavailable') {
    // try status which also falls back to http
  }
  const status = await vaultRequest('status')
  if (status.ok || status.unlocked !== undefined) {
    msg.textContent = status.unlocked
      ? `Connected — vault unlocked (v${status.version || '?'})`
      : `Connected — vault locked. Unlock Vaultic to fill/save.`
    return
  }
  if (status.error === 'no_token' || status.status === 401) {
    msg.textContent = 'Unauthorized — check the token or install the native host from Vaultic Settings.'
    return
  }
  msg.textContent = status.message || status.error || 'Could not reach Vaultic. Is the app running?'
})
