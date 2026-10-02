import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, chmodSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { EXTENSION_ID, getOrCreateBridgeToken, BRIDGE_PORT, BRIDGE_HOST } from './browser-bridge'
import { is } from '@electron-toolkit/utils'

const HOST_NAME = 'com.vaultic.browser'

function nativeHostScriptSource(): string {
  // Prefer repo native-host in dev; packaged copy under resources in production.
  const candidates = [
    join(app.getAppPath(), 'native-host', 'vaultic-native-host.mjs'),
    join(process.resourcesPath, 'native-host', 'vaultic-native-host.mjs'),
    join(__dirname, '../../../native-host/vaultic-native-host.mjs')
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return candidates[0]
}

function installedHostPath(): string {
  return join(app.getPath('userData'), 'native-host', 'vaultic-native-host.mjs')
}

function chromeNativeMessagingDir(): string {
  return join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts')
}

function chromeManifestPath(): string {
  return join(chromeNativeMessagingDir(), `${HOST_NAME}.json`)
}

/**
 * Installs/refreshes the Chrome Native Messaging host so the extension can
 * talk to Vaultic without pasting a token (still uses the local bridge under the hood).
 */
export function installNativeMessagingHost(): { ok: boolean; path: string; error?: string } {
  try {
    const token = getOrCreateBridgeToken()
    const source = nativeHostScriptSource()
    if (!existsSync(source)) {
      return { ok: false, path: '', error: `Native host script not found at ${source}` }
    }

    const destDir = dirname(installedHostPath())
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })
    copyFileSync(source, installedHostPath())
    chmodSync(installedHostPath(), 0o755)

    // Config the host reads on each message.
    const configPath = join(destDir, 'bridge-config.json')
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          token,
          baseUrl: `http://${BRIDGE_HOST}:${BRIDGE_PORT}`,
          updatedAt: Date.now()
        },
        null,
        2
      ),
      { mode: 0o600 }
    )

    const nmDir = chromeNativeMessagingDir()
    if (!existsSync(nmDir)) mkdirSync(nmDir, { recursive: true })

    // Use `node` to run the host — Chrome requires an executable path.
    // Resolve node via process.execPath when running under electron? Prefer system node.
    const nodePath = process.env.VAULTIC_NODE_PATH || '/usr/local/bin/node'
    const nodeCandidates = [nodePath, '/opt/homebrew/bin/node', '/usr/bin/node']
    let nodeBin = nodeCandidates.find((p) => existsSync(p)) || 'node'

    // Wrapper shell script so Chrome can exec a single path with no args issues.
    const wrapperPath = join(destDir, 'vaultic-native-host.sh')
    writeFileSync(
      wrapperPath,
      `#!/bin/bash\nexec "${nodeBin}" "${installedHostPath()}" "$@"\n`,
      { mode: 0o755 }
    )
    chmodSync(wrapperPath, 0o755)

    const manifest = {
      name: HOST_NAME,
      description: 'Vaultic browser bridge',
      path: wrapperPath,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`]
    }
    writeFileSync(chromeManifestPath(), JSON.stringify(manifest, null, 2))

    return { ok: true, path: chromeManifestPath() }
  } catch (err) {
    return {
      ok: false,
      path: '',
      error: err instanceof Error ? err.message : 'Failed to install native host'
    }
  }
}

export function getNativeHostInstallInfo(): {
  hostName: string
  extensionId: string
  manifestPath: string
  installed: boolean
  isDev: boolean
} {
  return {
    hostName: HOST_NAME,
    extensionId: EXTENSION_ID,
    manifestPath: chromeManifestPath(),
    installed: existsSync(chromeManifestPath()),
    isDev: is.dev
  }
}
