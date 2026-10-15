import { BrowserWindow, BrowserView, ipcMain } from 'electron'
import { randomUUID } from 'crypto'

export interface CapturedPreview {
  title?: string
  description?: string
  image?: string
}

const TOOLBAR_HEIGHT = 48

function toolbarHtml(channel: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0;
    height: ${TOOLBAR_HEIGHT}px;
    background: #111827;
    color: #e5e7eb;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    box-sizing: border-box;
  }
  button {
    font: inherit;
    font-size: 13px;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid #374151;
    background: #1f2937;
    color: #e5e7eb;
    cursor: pointer;
  }
  button.primary {
    background: #14b8a6;
    color: #04201c;
    border-color: #14b8a6;
    font-weight: 600;
  }
  span {
    font-size: 12px;
    color: #9ca3af;
    white-space: nowrap;
  }
</style>
</head>
<body>
  <span>Solve any challenge below, then:</span>
  <button class="primary" id="capture">Capture preview</button>
  <button id="cancel">Cancel</button>
  <script>
    const { ipcRenderer } = require('electron')
    document.getElementById('capture').onclick = () => ipcRenderer.send(${JSON.stringify(channel)}, 'capture')
    document.getElementById('cancel').onclick = () => ipcRenderer.send(${JSON.stringify(channel)}, 'cancel')
  </script>
</body>
</html>`
}

// Runs inside the captured page itself, so the image fetch carries whatever
// cookies/session the user just earned by solving the challenge there.
const EXTRACT_SCRIPT = `
(function () {
  function meta(name) {
    const el = document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]')
    return el ? el.getAttribute('content') : null
  }
  const title = document.title || null
  const description = meta('og:description') || meta('description')
  let imageUrl = meta('og:image') || meta('twitter:image')
  if (imageUrl) {
    try {
      imageUrl = new URL(imageUrl, location.href).toString()
    } catch (e) {
      imageUrl = null
    }
  }
  function toDataUrl(url) {
    return fetch(url, { credentials: 'include' })
      .then(function (res) {
        if (!res.ok) return undefined
        return res.blob().then(function (blob) {
          if (!blob.type || blob.type.indexOf('image/') !== 0) return undefined
          if (blob.size > 2000000) return undefined
          return new Promise(function (resolve) {
            const fr = new FileReader()
            fr.onload = function () { resolve(fr.result) }
            fr.onerror = function () { resolve(undefined) }
            fr.readAsDataURL(blob)
          })
        })
      })
      .catch(function () { return undefined })
  }
  const imagePromise = imageUrl ? toDataUrl(imageUrl) : Promise.resolve(undefined)
  return imagePromise.then(function (image) {
    return {
      title: title || undefined,
      description: description || undefined,
      image: image
    }
  })
})()
`

/**
 * Opens a visible, interactive browser window at `url` so the user can solve a
 * CAPTCHA or other bot-challenge by hand, then captures title/description/image
 * from the resulting page using that same (just-authenticated) session — rather
 * than the headless ephemeral fetch in link-preview.ts, which a challenge like
 * this would always block. The window is on an in-memory-only partition (never
 * persisted to disk) and closes itself once the capture finishes or is cancelled.
 * Resolves to null if the user cancels or closes the window without capturing.
 */
export async function captureInteractivePreview(url: string): Promise<CapturedPreview | null> {
  return new Promise((resolve) => {
    const channel = `vaultic-capture-${randomUUID()}`
    let settled = false

    const win = new BrowserWindow({
      width: 1100,
      height: 820,
      minWidth: 500,
      minHeight: 400,
      title: 'Capture bookmark preview',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    })

    const view = new BrowserView({
      webPreferences: {
        partition: `vaultic-capture-${randomUUID()}`,
        sandbox: true,
        contextIsolation: true
      }
    })
    win.setBrowserView(view)

    function layout(): void {
      const [w, h] = win.getContentSize()
      view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width: w, height: Math.max(0, h - TOOLBAR_HEIGHT) })
    }
    layout()
    win.on('resize', layout)

    function finish(result: CapturedPreview | null): void {
      if (settled) return
      settled = true
      ipcMain.removeAllListeners(channel)
      if (!win.isDestroyed()) win.close()
      resolve(result)
    }

    win.on('closed', () => finish(null))

    ipcMain.on(channel, (_e, action: string) => {
      if (action === 'cancel') {
        finish(null)
        return
      }
      if (action === 'capture') {
        view.webContents
          .executeJavaScript(EXTRACT_SCRIPT, true)
          .then((result: CapturedPreview) => finish(result ?? null))
          .catch(() => finish(null))
      }
    })

    win.loadURL(`data:text/html,${encodeURIComponent(toolbarHtml(channel))}`)
    view.webContents.loadURL(url)
  })
}
