/**
 * Detects login forms, offers fill from Vaultic, and offers to save submitted credentials.
 */

const STATE = {
  popup: null,
  lastCreds: null
}

function isVisible(el) {
  if (!el || el.disabled) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function findPasswordFields(root = document) {
  return [...root.querySelectorAll('input[type="password"]')].filter(isVisible)
}

function findUsernameField(formOrDoc, passwordField) {
  const scope = passwordField.form || formOrDoc
  const candidates = [
    ...scope.querySelectorAll(
      'input[type="email"], input[type="text"], input[type="tel"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[autocomplete="username"], input[autocomplete="email"]'
    )
  ].filter(isVisible)
  // Prefer field before password in DOM order
  const before = candidates.filter((el) => {
    return passwordField.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING
  })
  return before[before.length - 1] || candidates[0] || null
}

function setNativeValue(input, value) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(input, value)
  else input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function removePopup() {
  STATE.popup?.remove()
  STATE.popup = null
}

function showPopup(anchor, logins, onPick) {
  removePopup()
  const rect = anchor.getBoundingClientRect()
  const el = document.createElement('div')
  el.className = 'vaultic-popup'
  el.style.top = `${window.scrollY + rect.bottom + 6}px`
  el.style.left = `${window.scrollX + rect.left}px`

  if (!logins.length) {
    el.innerHTML = `<div class="vaultic-popup-empty">No Vaultic logins for this site.<div class="vaultic-muted">Unlock Vaultic or save a login first.</div></div>`
  } else {
    el.innerHTML = logins
      .map(
        (l, i) =>
          `<button type="button" class="vaultic-item" data-i="${i}">
            <span class="vaultic-item-title">${escapeHtml(l.service)}</span>
            <span class="vaultic-item-sub">${escapeHtml(l.username || '(no username)')}</span>
          </button>`
      )
      .join('')
  }

  const brand = document.createElement('div')
  brand.className = 'vaultic-brand'
  brand.textContent = 'Vaultic'
  el.prepend(brand)

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.vaultic-item')
    if (!btn) return
    const login = logins[Number(btn.dataset.i)]
    if (login) onPick(login)
  })

  document.body.appendChild(el)
  STATE.popup = el

  const dismiss = (ev) => {
    if (el.contains(ev.target) || ev.target === anchor) return
    removePopup()
    document.removeEventListener('mousedown', dismiss, true)
  }
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0)
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function ensureFillButton(passwordField) {
  if (passwordField.dataset.vaulticWired) return
  passwordField.dataset.vaulticWired = '1'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'vaultic-fill-btn'
  btn.title = 'Fill with Vaultic'
  btn.textContent = 'V'

  function place() {
    const rect = passwordField.getBoundingClientRect()
    btn.style.position = 'fixed'
    btn.style.top = `${Math.max(4, rect.top + (rect.height - 22) / 2)}px`
    btn.style.left = `${Math.min(window.innerWidth - 30, rect.right - 28)}px`
    btn.style.display = isVisible(passwordField) ? 'block' : 'none'
  }

  btn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  btn.addEventListener('click', async (e) => {
    e.preventDefault()
    e.stopPropagation()
    const result = await chrome.runtime.sendMessage({ type: 'findLogins', url: location.href })
    if (result?.error === 'locked' || result?.status === 423) {
      showToast('Unlock Vaultic to fill logins')
      return
    }
    const logins = result?.logins || []
    showPopup(passwordField, logins, async (login) => {
      removePopup()
      const unlocked = await chrome.runtime.sendMessage({ type: 'unlockLogin', id: login.id })
      if (!unlocked?.ok) {
        showToast(unlocked?.error === 'auth_declined' ? 'Touch ID cancelled' : 'Could not unlock login')
        return
      }
      const userField = findUsernameField(document, passwordField)
      if (userField && unlocked.username) setNativeValue(userField, unlocked.username)
      setNativeValue(passwordField, unlocked.password || '')
      if (unlocked.totp) {
        await navigator.clipboard.writeText(unlocked.totp).catch(() => {})
        showToast('Filled — TOTP copied to clipboard')
      } else {
        showToast('Filled from Vaultic')
      }
    })
  })

  document.documentElement.appendChild(btn)
  place()
  passwordField.addEventListener('focus', place)
  window.addEventListener('scroll', place, true)
  window.addEventListener('resize', place)
}

function showToast(message) {
  let toast = document.querySelector('.vaultic-toast')
  if (!toast) {
    toast = document.createElement('div')
    toast.className = 'vaultic-toast'
    document.body.appendChild(toast)
  }
  toast.textContent = message
  toast.classList.add('vaultic-toast-show')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => toast.classList.remove('vaultic-toast-show'), 2800)
}

function showSaveBar(creds) {
  document.querySelector('.vaultic-savebar')?.remove()
  const bar = document.createElement('div')
  bar.className = 'vaultic-savebar'
  bar.innerHTML = `
    <div class="vaultic-savebar-text">
      <strong>Save to Vaultic?</strong>
      <span>${escapeHtml(creds.username || '(no username)')} · ${escapeHtml(location.hostname)}</span>
    </div>
    <div class="vaultic-savebar-actions">
      <button type="button" class="vaultic-btn-ghost" data-act="dismiss">Not now</button>
      <button type="button" class="vaultic-btn-primary" data-act="save">Save</button>
    </div>
  `
  bar.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'dismiss') {
      bar.remove()
      return
    }
    if (act === 'save') {
      const result = await chrome.runtime.sendMessage({
        type: 'saveLogin',
        service: location.hostname.replace(/^www\./, ''),
        username: creds.username,
        password: creds.password,
        url: location.origin
      })
      bar.remove()
      if (result?.ok) showToast('Saved to Vaultic')
      else if (result?.status === 423 || result?.error === 'locked') showToast('Unlock Vaultic, then try again')
      else showToast(result?.message || 'Could not save')
    }
  })
  document.documentElement.appendChild(bar)
}

function wireForms() {
  findPasswordFields().forEach((pw) => {
    ensureFillButton(pw)
    const form = pw.form
    if (!form || form.dataset.vaulticFormWired) return
    form.dataset.vaulticFormWired = '1'
    form.addEventListener(
      'submit',
      () => {
        const userField = findUsernameField(form, pw)
        const username = userField?.value?.trim() || ''
        const password = pw.value
        if (password && password.length >= 1) {
          STATE.lastCreds = { username, password, at: Date.now() }
          // Delay slightly so navigation sites still show the bar briefly
          setTimeout(() => {
            if (STATE.lastCreds && Date.now() - STATE.lastCreds.at < 8000) {
              showSaveBar(STATE.lastCreds)
            }
          }, 400)
        }
      },
      true
    )
  })
}

wireForms()
const observer = new MutationObserver(() => wireForms())
observer.observe(document.documentElement, { childList: true, subtree: true })
