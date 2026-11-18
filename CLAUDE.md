# Vaultic

Local-first macOS password and API-key vault. Electron desktop app plus a Chrome extension that fills and saves logins through a localhost bridge. One user, one machine, one encrypted file. No server, no accounts, no telemetry.

Stack: Electron 32, electron-vite 2, React 18, TypeScript (strict), Tailwind 3, Zustand 4. Packaged with electron-builder for macOS arm64 only. Touch ID, Keychain (`keytar`) and AppleScript make it macOS-specific; do not add Windows/Linux branches.

## How it is built

Five pieces. Know which one you are in before you edit.

| Piece | Path | Runs as | May touch secrets |
|---|---|---|---|
| Main process | `src/main/` | Node inside Electron | Yes. The only place that may. |
| Preload | `src/preload/` | Bridge, `contextBridge` | Passes calls through, holds nothing |
| Renderer | `src/renderer/src/` | React in a browser window | Only after a gated reveal call |
| Extension | `extension/` | Chrome MV3, plain JS, no build step | Only a login the user just unlocked |
| Native host | `native-host/` | Node script Chrome spawns | Forwards requests, holds the bridge token |

Data flow in the app:

```
React component -> window.vaultAPI.x() -> ipcRenderer.invoke('vault:x')
  -> ipcMain.handle('vault:x') in ipc-handlers.ts -> vaultStore method -> persist()
```

Data flow from the browser:

```
content.js / popup.js -> background.js -> bridge.js vaultRequest()
  -> Native Messaging (native-host) or direct http://127.0.0.1:17843 with Bearer token
  -> browser-bridge.ts in the main process -> vaultStore
```

Main pushes three events to the renderer: `vault:autoLocked`, `vault:bookmarksUpdated`, `vault:needMasterPassword`.

Files on disk, all under Electron `userData` (`~/Library/Application Support/Vaultic`):

- `vault.enc`: the whole vault as one JSON blob, AES-256-GCM, key from scrypt (N=2^17). Shape is `VaultData` in `vault-store.ts`.
- `recovery.enc`: the same vault key wrapped by a second passphrase (a second keyslot).
- `settings.json`: plaintext UI preferences. Never put a secret here.
- `bridge-token`, `native-host/`: extension bridge credentials, mode 0600.

The vault key is also cached in the macOS Keychain so Touch ID can unlock. Lock clears memory only; it keeps the Keychain entry on purpose.

Cloud sync (`cloud-sync.ts`) is optional and pushes the ciphertext blob only to one Postgres row, using `DATABASE_URL` from `.env.local`. The README still says "never synced anywhere"; the code is the truth.

## Folder map

```
src/main/index.ts            window, auto-lock timer, startup order
src/main/tray.ts             tray menu, global hotkey Cmd+Shift+V
src/main/vault/
  vault-store.ts             all records, all mutations, persist(), trash, backup/restore
  ipc-handlers.ts            every 'vault:*' handler, auth gating, clipboard auto-clear
  crypto.ts                  scrypt + AES-GCM. Do not change parameters.
  biometric.ts keychain.ts   Touch ID gate, Keychain key cache
  browser-bridge.ts          localhost HTTP API for the extension (port 17843)
  native-host-install.ts     writes Chrome NativeMessagingHosts manifest
  link-preview.ts ephemeral-fetch.ts preview-queue.ts interactive-preview.ts
                             bookmark title/description/thumbnail fetching
  scanner.ts csv.ts chrome-bookmarks.ts   read-only importers
  password-strength.ts totp.ts url-match.ts ai-cli.ts cloud-sync.ts settings.ts env.ts
src/preload/index.ts         window.vaultAPI implementation
src/preload/api-types.ts     VaultAPI interface + every type the renderer sees
src/renderer/src/App.tsx     section switch, all modal open/close state, shortcuts
src/renderer/src/stores/     vault-store.ts (summaries + refresh), toast-store.ts
src/renderer/src/components/ one file per view or modal; icons.tsx holds every icon
src/renderer/src/lib/        fuzzy.ts, url.ts, clipboard.ts, use-escape-key.ts
extension/                   manifest.json, background.js, bridge.js, content.js/.css, popup, options
native-host/                 vaultic-native-host.mjs
scripts/                     install-to-applications.mjs (used by dist:mac)
build/ assets/               icons. out/ and dist/ are build output, never edit.
```

## Commands

```bash
npm install          # also rebuilds keytar for Electron (postinstall)
npm run dev          # run the app with hot reload
npm run typecheck    # tsc for main+preload, then renderer. The only automated check.
npm run build        # compile to out/
npm run start        # preview the built app
npm run dist:mac     # build, package, REPLACE /Applications/Vaultic.app, delete dist/
npm run extension:open   # opens chrome://extensions and the extension folder
```

- There are no tests, no linter, no formatter and no CI. Do not claim "tests pass". Do not add a test framework or ESLint unless asked.
- The extension has no build. Edit the files, then reload it at `chrome://extensions`. A changed `manifest.json` needs that reload; content scripts also need the page reloaded.
- Treat `npm run dev` as opening the real vault: the dev and installed app resolve to the same `userData` folder on a normal macOS disk. Never test delete, restore, empty-trash, change-password or cloud pull against it without asking.
- If the installed app is running (it can launch at login), dev cannot bind port 17843 and the bridge belongs to the installed app.
- Ask before `dist:mac`, before any cloud sync call, and before anything that touches a real `vault.enc`.

## How to work here

- Before a non-trivial change, say in two or three lines what you will change and how you will prove it. Then start.
- Make the smallest complete change. No refactors, renames, new dependencies or new abstractions that were not asked for.
- The neighbouring code beats general best practice. Open a sibling file and copy its shape.
- Ask before committing, pushing, running `dist:mac`, deleting files, or calling Neon/Postgres.
- Never open `.env.local`. The only variable is `DATABASE_URL`.
- If the same fix fails twice, stop and report what you learned.
- Decisions about the vault format, crypto, auth gating or what leaves the machine are the owner's. Give two options in one line each, say which you would pick, and wait.

## Coding rules

Style (match it exactly, there is no formatter to fix it for you):

- 2 spaces, single quotes, no semicolons, no trailing commas, lines up to about 120 columns.
- Explicit return types on every function: `: JSX.Element`, `: Promise<void>`, `: void`.
- Named exports only. `App.tsx` is the single default export.
- Relative imports. The `@renderer` alias exists but nothing uses it; do not start.
- `import type` for types. Renderer types come from `../../../preload/api-types`.
- Comments explain why, and mark security invariants ("Biometric-gated in ipc-handlers before this is called"). Keep the existing ones accurate when you change the code under them.

Main process:

- All vault reads and writes go through the `vaultStore` singleton. Every mutation ends with `await this.persist()`. Never write `vault.enc` any other way; `persist()` serializes writes and writes atomically.
- Deletes are soft: set `deletedAt`. Only trash actions and the 30-day purge remove records.
- A handler that returns or uses a secret must call `await requireAuth('<verb phrase>')` first and return `null` or `false` when it fails. The phrase completes "Touch ID to ..." so write it lower-case: `'copy this password'`.
- Secrets go to the clipboard only through `copyWithAutoClear` (clears after 30 s).
- Expected failures return a value, not an exception: `{ success: true as const, ... }` or `{ success: false as const, error: '...' }`. Auth declined is `null`/`false`.
- Spawn processes with `execFile` and a timeout, never `exec` with a shell string.
- Accept only `http:`/`https:` URLs before opening, fetching or storing (`normalizeBookmarkUrl`, the `/^https?:\/\//i` checks).
- Bookmark preview fetches go through `ephemeralFetch` (in-memory session, size and time caps). Do not use global `fetch` for user URLs.

Adding one IPC call is always four edits, in this order:

1. method on `VaultStore` in `src/main/vault/vault-store.ts` (if it touches data)
2. `ipcMain.handle('vault:name', ...)` in `src/main/vault/ipc-handlers.ts`
3. signature on `VaultAPI` in `src/preload/api-types.ts`
4. `name: (...) => ipcRenderer.invoke('vault:name', ...)` in `src/preload/index.ts`

`api-types.ts` must not import from `src/main` (the renderer tsconfig compiles it alone), so any new return type is copied into it by hand. Keep both copies identical.

Adding one bridge operation is also four edits: route in `browser-bridge.ts`, message type in `native-host/vaultic-native-host.mjs`, HTTP fallback in `extension/bridge.js`, case in `extension/background.js`. Error codes are snake_case strings (`auth_declined`, `not_found`).

Adding a record type or a field to `VaultData`: add it to `EMPTY_VAULT`, backfill it in both `unlock()` and `unlockWithKey()` (old vaults lack it), and for a record type also `purgeOldTrash`, `listTrash`, `restoreTrashItem`, `permanentlyDeleteTrashItem`, `emptyTrash`, `getStorageInfo`, `TrashKind` (both copies), the renderer store `refresh()`, `Section`, `Sidebar` and `App.tsx`.

Renderer:

- Never import `electron`, `fs` or anything from `src/main`. The only door is `window.vaultAPI`.
- The Zustand store holds summaries only. After any mutation call `await refresh()`; do not patch store arrays by hand.
- Revealed secrets live in component `useState` and die with the component. Never put one in the store.
- Open/close state for modals lives in `App.tsx` and is passed down as `onAdd`/`onEdit`/`onClose` props.

Extension:

- Plain ES modules, no TypeScript, no bundler, no npm imports.
- Functions passed to `chrome.scripting.executeScript` are serialized: they cannot use anything from the outer file. Keep them self-contained (see `pageFillCredentials`).
- `content.js` runs on every page in every frame. Keep the double-inject guard, prefix every class with `vaultic-`, and never log credentials.
- Do not touch the manifest `key`; it pins the extension ID that `EXTENSION_ID` in `browser-bridge.ts` and the native-host manifest depend on.
- Add a permission only when a feature needs it, and say so in your report.

## Design rules

Dark theme only. Every colour is a `vt-*` token from `tailwind.config.js`:

| Token | Use |
|---|---|
| `vt-bg` #0B1220 | window background, text on teal buttons |
| `vt-surface` #111A2E | sidebar, modal cards, toasts |
| `vt-surface2` #16213A | inputs, hover, active nav |
| `vt-border` #233150 | every border |
| `vt-text` / `vt-muted` | primary / secondary text |
| `vt-teal` #2DD4BF | the one accent: primary action, focus ring, success |
| `vt-danger` #F87171 | destructive action, error text |

- Tailwind utilities in `className` only. No new CSS files, no CSS-in-JS, no component library, no icon package. No raw Tailwind palette colours (`bg-red-500`); the only exception in common use is the `bg-black/50` scrim.
- Copy these class strings from a sibling instead of composing new ones:
  - Primary button: `rounded-lg bg-vt-teal px-3 py-1.5 text-sm font-medium text-vt-bg hover:brightness-110 disabled:opacity-50`
  - Secondary button: `rounded-lg border border-vt-border px-3 py-1.5 text-sm text-vt-muted hover:bg-vt-surface2`
  - Input: `w-full rounded-lg border border-vt-border bg-vt-surface2 px-3 py-2 text-sm outline-none focus:border-vt-teal`
  - Field label: `mb-1 block text-xs font-medium text-vt-muted`
  - Modal card: `w-full max-w-md rounded-2xl border border-vt-border bg-vt-surface p-6 shadow-2xl` (`max-w-sm` for confirms, `max-w-lg` for lists)
  - List card: `rounded-xl border border-vt-border p-4`
- Type scale: page title `text-xl font-semibold`, modal title `text-sm font-semibold`, body `text-sm`, help and errors `text-xs`. Secrets render in `font-mono text-xs`; hidden ones show as a row of `•`.
- Every view is `<div className="flex h-full flex-col">`, then `<PageHeader>`, then a scroll area with `px-7 py-6`. Handle three states: empty vault, empty search, list.
- Every modal is `<ModalBackdrop onClose>` wrapping a card with `onClick={(e) => e.stopPropagation()}`, plus `useEscapeKey(onClose)`. Do not put `onClick={onClose}` on a raw backdrop div; `ModalBackdrop` exists to stop drag-select from closing the modal.
- Destructive action: `ConfirmDialog`, then a success toast with an Undo action and `durationMs: 6000`.
- Feedback is a toast: `useToastStore((s) => s.push)(message, 'success' | 'error' | 'info')`. No `alert`, no `confirm`, no inline banners.
- Row actions are `<IconButton title="...">` with an icon from `icons.tsx` at `size={14}`. A new icon is added to `icons.tsx` using the shared `Svg` wrapper (24 viewBox, stroke 2, `currentColor`).
- Layers: modals `z-50`, master-password prompt `z-[60]`, toasts `z-[100]`.
- Copy: sentence case, short, the `…` character for in-progress ("Saving…"), "Touch ID failed or was cancelled" for a declined gate.
- The renderer CSP allows only `'self'` and `data:` images. No CDN scripts, web fonts or remote images. Preview thumbnails are stored as data URLs for this reason.
- Extension UI cannot use Tailwind. Write plain CSS with the same hex values.

## Mistakes a weaker model makes here

1. **Returns a secret in a list.** Adds `password` or `url` to a `*Summary` "for convenience". Fix: summaries never carry secrets; add a gated `reveal*` handler instead. Bookmark URLs count as secrets; lists get `host` only.
2. **Forgets the auth gate** on a new reveal/copy/edit/export handler. Fix: `requireAuth` first, every time. Unlocked is not the same as authorized.
3. **Edits one of the four IPC files.** Typecheck may still pass and the call fails at runtime with "No handler registered". Fix: do all four, then call it from the running app.
4. **Imports a main type into `api-types.ts` or the renderer.** Breaks the web tsconfig or drags Node into the browser bundle. Fix: copy the type.
5. **Adds a vault field without the backfill**, so every existing vault crashes on `undefined.filter`. Fix: default it in `unlock()` and `unlockWithKey()`.
6. **Mutates data and skips `persist()`,** or calls `writeFile` on the vault directly. The change vanishes on lock. Fix: `await this.persist()`.
7. **Hard-deletes.** Fix: set `deletedAt`; wire restore and the Undo toast.
8. **"Improves" the crypto**: new KDF parameters, a different cipher, a new file format. Every existing vault becomes unreadable. Fix: do not touch `crypto.ts` without an explicit request and a migration plan.
9. **Clears the Keychain key on lock.** Touch ID unlock stops working. The comment in `vault:lock` explains why it stays.
10. **Sends vault data off the machine**: analytics, an error reporter, a favicon service, a remote AI API. Fix: nothing leaves except the three disclosed paths (AI CLI gets `{id, service, url}` only; cloud sync gets ciphertext only; preview fetch gets the bookmark URL through the ephemeral session).
11. **Logs secrets** with `console.log` while debugging and leaves it in. Fix: never log a password, key, token, TOTP code or full bookmark URL.
12. **Uses Node or Electron APIs in the renderer,** or flips `nodeIntegration`/`contextIsolation`. Fix: add an IPC call.
13. **Writes TypeScript or an import from npm in `extension/`.** Nothing compiles it. Fix: plain JS.
14. **References outer variables inside an injected function.** Works in the file, is `undefined` in the page. Fix: pass values through `args`.
15. **Adds a bridge route but not the native-host case.** Works with a pasted token, fails for the normal Native Messaging path with `unknown_type`. Fix: all four bridge files.
16. **Loosens the bridge**: binds `0.0.0.0`, drops the Bearer check, lists passwords in `GET /v1/logins`. Fix: 127.0.0.1 only, token on everything except `/v1/ping`, passwords only from the gated unlock route.
17. **Invents styling**: new hex colours, `bg-gray-800`, a UI kit, a light theme, inline `style`. Fix: `vt-*` tokens and the class strings above.
18. **Builds a modal from scratch** and loses Escape handling and the drag-select guard. Fix: `ModalBackdrop` + `useEscapeKey`.
19. **Reaches for a dependency** (uuid, clsx, axios, date-fns, a CSV or TOTP library). Fix: `crypto.randomUUID`, template strings, the existing helpers. The repo hand-rolls these on purpose.
20. **Says "tests pass" or "should work".** There are no tests. Fix: report typecheck output and exactly what you ran in the app.
21. **Trusts the README** on sync or on the folder list. Fix: read the code.
22. **Runs `dist:mac` to "verify".** It overwrites the installed app. Fix: `npm run typecheck` and `npm run dev`; ask before packaging.
23. **Refactors on the way past**: splits `ipc-handlers.ts`, dedupes the two `unlock` bodies, renames things. Fix: leave it; mention it in the report.

## Before you say a task is done

- [ ] `npm run typecheck` exits 0, and you pasted or summarised its output.
- [ ] `git status` shows only files the task needed. No stray scratch files, no `out/` edits.
- [ ] New IPC call: all four files changed, channel string identical in handler and preload.
- [ ] New bridge operation: all four files changed.
- [ ] Any handler that exposes or changes a secret calls `requireAuth` and handles the declined case in the UI.
- [ ] No secret added to a `*Summary`, the Zustand store, `settings.json`, a log line or a toast.
- [ ] New `VaultData` field is defaulted in `EMPTY_VAULT`, `unlock()` and `unlockWithKey()`.
- [ ] Every mutation awaits `persist()`; every delete is soft and restorable.
- [ ] UI change: uses `vt-*` tokens and the shared components; empty, no-match and error states exist; Escape closes it.
- [ ] UI or extension change: you ran it and looked (`npm run dev`, or reloaded the extension and the page). If you could not, say "I did not run it".
- [ ] No new dependency, permission, network call or file format unless the task asked for it. If one was needed, it is named in the report.
- [ ] Report leads with the outcome, then: files changed, commands run with results, what was not verified, what the owner must do next (for example "reload the extension"), and anything noticed but not fixed, one line each.
