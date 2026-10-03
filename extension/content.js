/**
 * Detects login forms, offers fill from Vaultic, and offers to save submitted credentials.
 * Fill logic is SPA-safe (Angular / React).
 *
 * Guarded so a second inject (extension reload / executeScript) does not throw
 * "Identifier has already been declared".
 */
;(() => {
  if (globalThis.__vaulticContentLoaded) return
  globalThis.__vaulticContentLoaded = true

  const STATE = {
    popup: null,
    lastCreds: null
  }

  function isVisible(el) {
    if (!el || el.disabled) return false
    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    return true
  }

  function collectInputs(root, out = []) {
    if (!root?.querySelectorAll) return out
    for (const el of root.querySelectorAll('input')) out.push(el)
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) collectInputs(el.shadowRoot, out)
    }
    return out
  }

  function findPasswordFields(root = document) {
    return collectInputs(root).filter(
      (el) =>
        (el.type === 'password' ||
          el.autocomplete === 'current-password' ||
          el.autocomplete === 'new-password') &&
        isVisible(el)
    )
  }

  function findUsernameField(formOrDoc, passwordField) {
    const scope =
      passwordField.closest('form') ||
      passwordField.closest('[class*="login" i], [class*="auth" i], main') ||
      formOrDoc ||
      document
    const candidates = [
      ...scope.querySelectorAll(
        [
          'input[type="email"]',
          'input[type="text"]',
          'input[type="tel"]',
          'input[name*="user" i]',
          'input[name*="email" i]',
          'input[name*="login" i]',
          'input[id*="user" i]',
          'input[id*="email" i]',
          'input[autocomplete="username"]',
          'input[autocomplete="email"]'
        ].join(', ')
      )
    ].filter((el) => el !== passwordField && el.type !== 'password' && isVisible(el))

    const before = candidates.filter((el) => {
      return passwordField.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING
    })
    return before[before.length - 1] || candidates[0] || null
  }

  function setNativeValue(input, value) {
    input.focus()
    const proto = HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
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
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Unidentified' }))
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }))
  }

  function fillCredentials(username, password) {
    const passwords = findPasswordFields()
    if (!passwords.length) return { ok: false, error: 'no_password_field' }
    const pw = passwords[0]
    const userField = findUsernameField(document, pw)
    if (userField && username) setNativeValue(userField, username)
    if (password) setNativeValue(pw, password)
    pw.focus()
    pw.dispatchEvent(new Event('input', { bubbles: true }))
    return { ok: true }
  }

  globalThis.__vaulticFill = fillCredentials

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
      el.innerHTML =
        '<div class="vaultic-popup-empty">No Vaultic logins for this site.<div class="vaultic-muted">Unlock Vaultic or save a login first.</div></div>'
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

  async function unlockAndFill(loginId) {
    const unlocked = await chrome.runtime.sendMessage({ type: 'unlockLogin', id: loginId })
    if (!unlocked?.ok) {
      showToast(unlocked?.error === 'auth_declined' ? 'Touch ID cancelled' : 'Could not unlock login')
      return false
    }
    const result = fillCredentials(unlocked.username || '', unlocked.password || '')
    if (!result.ok) {
      showToast('No password field found on this page')
      return false
    }
    if (unlocked.totp) {
      await navigator.clipboard.writeText(unlocked.totp).catch(() => {})
      showToast('Filled — TOTP copied to clipboard')
    } else {
      showToast('Filled from Vaultic')
    }
    return true
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
        await unlockAndFill(login.id)
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'fillCredentials') {
      const result = fillCredentials(message.username || '', message.password || '')
      if (!result.ok) return false
      if (message.totp) navigator.clipboard.writeText(message.totp).catch(() => {})
      showToast(message.totp ? 'Filled — TOTP copied' : 'Filled from Vaultic')
      sendResponse(result)
      return true
    }
    return false
  })

  wireForms()
  const observer = new MutationObserver(() => wireForms())
  observer.observe(document.documentElement, { childList: true, subtree: true })
})()
