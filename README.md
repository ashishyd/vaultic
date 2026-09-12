# Vaultic

**Your keys, kept.**

Vaultic is a local-first macOS desktop app for storing API keys and login credentials — encrypted on your machine, unlocked with your master password or Touch ID, never synced anywhere.

It exists to solve a specific problem: developers end up with API keys scattered across dozens of `.env` files and login credentials scattered across browsers, with no single, secure, searchable place to see "what key belongs to which project" or quickly grab a password. Vaultic isn't trying to be a cloud password manager — everything it holds stays on your disk, encrypted, under a key only you control.

## Features

- **API keys**, grouped by project — add manually, paste `.env` contents for bulk import, or scan a folder recursively for `.env*` files (read-only scan; nothing saves until you review and confirm).
- **Logins** (site/username/password/URL) with one-click copy — import from Chrome's exported passwords CSV, and export selected logins back out in the same format for re-importing into Chrome or another browser.
- **Touch ID** to unlock the vault and to gate every reveal, copy, or edit of a secret. Falls back cleanly to your master password wherever Touch ID isn't available.
- **Password analysis** — weak/reused/stale detection computed entirely on-device (no network involved), plus a cryptographically random strong-password generator. AI categorization of *logins* (e.g. "Finance", "Work") is opt-in and sends only site names/URLs — never usernames or passwords — to a local CLI (`claude` or `cursor-agent`) already installed on your Mac, with an explicit disclosure before it ever runs.
- **Command palette** (⌘K) to fuzzy-search everything and copy a value in two keystrokes.
- **Emergency recovery access** — an optional, independent recovery passphrase (a second keyslot on the same vault key) so a lost master password doesn't mean permanently lost data.
- **Auto-lock** on inactivity, soft-delete with undo, favorites, and a proactive "N weak / N reused" indicator in the sidebar.
- **Chrome quick-copy** — grabs the frontmost Chrome tab's URL via AppleScript and copies the matching saved password directly.

## Security model

- A master password (never stored) derives an encryption key via `scrypt`; the vault is a single file encrypted with AES-256-GCM.
- The derived key is cached in the macOS Keychain so Touch ID can unlock the vault without re-deriving the key each time — clearing it requires an explicit action, not just closing the app.
- All cryptography and secret storage happens in Electron's main process. The renderer (UI) never receives a secret except through an explicit, biometric-gated IPC call — API key values and login passwords are stripped out of every list the UI displays by default.
- Deleted entries are soft-deleted (recoverable via "Undo" for a few seconds, and kept in encrypted storage for 30 days) rather than destroyed immediately.
- Nothing is sent off your machine except when you explicitly opt into AI categorization or Chrome CSV import/export — both are one-shot, disclosed actions, not background syncing.

## Tech stack

Electron + [electron-vite](https://electron-vite.org/) + React + TypeScript + Tailwind CSS + Zustand, packaged with `electron-builder`. No backend, no telemetry, no accounts.

## Getting started

```bash
npm install
npm run dev          # run in development
npm run typecheck    # check main/preload + renderer
npm run dist:mac     # build, package, and install to /Applications
```

Requires macOS (Touch ID and Keychain integration are macOS-specific; this has not been built for Windows/Linux).

## Project structure

```
src/
  main/           # Electron main process — crypto, vault storage, IPC handlers
    vault/
  preload/        # contextBridge API exposed to the renderer (window.vaultAPI)
  renderer/       # React UI
    src/
      components/
      stores/
build/            # app icon assets used by electron-builder
assets/logo/      # source SVG for the Vaultic mark
scripts/          # build helpers (installs the packaged .app to /Applications)
```

## License

MIT — see [LICENSE](LICENSE).
