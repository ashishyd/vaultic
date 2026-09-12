import { existsSync, rmSync, readdirSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import os from 'os'

const distDir = 'dist'
const arch = os.arch() // 'arm64' | 'x64'

// electron-builder's unpacked app dir (dist/mac-arm64/Vaultic.app) contains
// symlinks (e.g. Contents/Frameworks/*.framework/Versions/Current) written as
// ABSOLUTE paths pointing back at that build directory. Copying that directory
// with cp/cpSync/ditto preserves the symlink text as-is, so once `dist/` is
// cleaned up (or the build re-runs) the copy's frameworks become broken links
// and the installed app crashes with "Library not loaded" at launch.
//
// The .zip artifact electron-builder also produces stores relative symlinks,
// so extracting it directly into /Applications gives a self-contained app
// whose links resolve correctly regardless of what happens to dist/ afterward.
const zipCandidates = readdirSync(distDir).filter(
  (f) => f.endsWith('-mac.zip') && (arch === 'arm64' ? f.includes('-arm64-mac.zip') : !f.includes('-arm64-mac.zip'))
)

if (zipCandidates.length === 0) {
  console.error(`Could not find a built mac .zip artifact under ${distDir}/ for arch ${arch}`)
  process.exit(1)
}

const zipPath = join(distDir, zipCandidates[0])
const destPath = '/Applications/Vaultic.app'

if (existsSync(destPath)) {
  rmSync(destPath, { recursive: true, force: true })
}

execFileSync('ditto', ['-xk', zipPath, '/Applications'], { stdio: 'inherit' })
console.log(`Installed ${zipPath} -> ${destPath}`)
