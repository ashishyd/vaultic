# Design gap report: Vaultic redesign canvas (all 12 artboards)
Mock: https://claude.ai/artifact/X3hus3ZJJVtSyM4uhPbgcM (Main, Logins, CommandPalette, QuickAccess, Sidebar, ApiKeys, RecoveryCodes, SecureNotes, Bookmarks, PasswordHealth, Trash, Settings) | Build: Electron renderer, `src/renderer/src` | Date: 2026-11-25
Evidence: code only (app starts locked; no real master password may be typed; `npm run dev` opens the real vault). All visual rows are `unverified`.   Mock precision: exact (HTML) but not measured in a browser
Run: `npm run dev` (opens the REAL vault, ask first) | Login: none (no seed vault)
Design system: `tailwind.config.js` vt-* tokens
Conventions: Tailwind classes only, copy sibling class strings, 2 spaces, no semicolons, explicit return types, `npm run typecheck` is the only check
Score: 9/40 inventory items match (code only). P0 3 · P1 6 · P2 3 · P3 0 · Questions 5

## Questions for a human (do not build until answered)
- Q1 Recovery-code used/left meter and "Copy next code" (S6.2, S6.3): needs a per-code `used` flag in `VaultData`. Vault format change. Option A: store `usedIndexes: number[]` per entry, backfilled in `unlock()` and `unlockWithKey()`. Option B: drop the meter and keep the count. I would pick A.
- Q2 API key prefix preview `sk_live_••••` (S7.4): needs a new field on `ApiKeySummary`. CLAUDE.md says summaries never carry secrets. Option A: add `prefix` (first 8 chars). Option B: dots only. I would pick A.
- Q3 "Ask Touch ID before every copy" setting (S12.3): changes auth gating. Option A: new `settings.json` boolean read in `requireAuth`. Option B: leave as is. I would pick B for now.
- Q4 Clipboard "clears in 24s" pill (S2.2): needs main to push a clear-deadline event to the renderer (new IPC event). Option A: add `vault:clipboardCleared` push event with a deadline. Option B: skip. I would pick A.
- Q5 Quick access panel (S4): today the tray is only a context menu. A real panel means a second BrowserWindow with its own renderer entry, preload and secret-handling path. Option A: build it. Option B: keep the menu. I would pick B until Q1 to Q4 are done.

## Gaps
- [x] G01 [MISSING-FEATURE] [P0] ⌘K palette: grouped results, action pane, prefixes   (inventory S3)
  Done: src/renderer/src/components/CommandPalette.tsx | Verified: npm run typecheck exit 0; read code: > actions only, / section-nav only, # labels (Enter opens Logins), heading per kind, flat list sorted by group so activeIndex matches display. Not run in app.
  Mock: results grouped Logins / API keys / Actions with match highlighting, side pane of per-item shortcuts, prefixes `>` actions, `#` labels, `/` sections.
  Build: single flat list, placeholder "Search everything… (Enter to copy / run)"; no prefixes, no groups (unverified, read from code).
  Where: `src/renderer/src/components/CommandPalette.tsx:223`
  Do: group the existing result list by kind with a small `text-xs text-vt-muted` heading per group; add prefix parsing for `>`, `#`, `/` on the query string. Reuse `fuzzyScore` from `lib/fuzzy.ts`.
  Accept: at 1280 wide, typing `>` lists only actions; `/` lists sections; results show three group headings when the query matches all three kinds.
  Depends: none
  Size: M
- [x] G02 [MISSING-FEATURE] [P0] Logins: "Open and fill" and "Copy password ↵" primary actions   (S2.5) (copy part only; Open and fill not built)
  Done: src/renderer/src/components/LoginList.tsx | Verified: code reading + npm run typecheck exit 0; not run in app
  Mock: inspector top row has Copy password (Enter) and Open and fill.
  Build: copy is an icon button; there is no open-and-fill; Enter does nothing (unverified).
  Where: `src/renderer/src/components/LoginList.tsx` detail pane (Password row)
  Do: add a primary-button class string from CLAUDE.md "Copy password" calling `handleCopyPassword(sel.id)`; bind Enter on the list when focus is not in an input. Open-and-fill depends on Q5-style bridge work: leave as a separate gap.
  Accept: with a login selected and focus on the list, Enter copies the password and shows "Copied to clipboard".
  Depends: none
  Size: S
- [ ] G03 [MISSING-FEATURE] [P0] Live TOTP code with countdown ring in the inspector   (S2.6)
  Mock: 6-digit code with a countdown ring, shown after reveal.
  Build: text "Copy to generate a fresh code" only (`LoginList.tsx`, hasTotp row).
  Where: `src/renderer/src/components/LoginList.tsx` (grep "Copy to generate")
  Do: needs a gated reveal call returning the current code. `copyTotpCode` exists; `revealTotpSecret` exists. Add a gated `revealTotpCode` (four IPC edits) that returns `{code, secondsLeft}`; render it with a `font-mono` code and a 1 s interval. Auth gate required.
  Accept: after Touch ID, a 6-digit code shows and changes when the 30 s window rolls over; code is gone after selecting another login.
  Depends: none (new IPC call, owner should approve: it exposes a secret)
  Size: M
- [x] G04 [DIFFERS] [P1] Logins: age/reuse warning and "Fix" link   (S2.7)
  Done: src/renderer/src/components/LoginList.tsx | Verified: code reading + npm run typecheck exit 0; not run in app
  Mock: "412 days old, reused on 2 sites" banner with Fix.
  Build: only a "Weak" badge; `analyzePasswords` already returns `reused` and `stale`.
  Where: `LoginList.tsx` (`weakIds` state, detail pane)
  Do: keep a `Map<id, PasswordAnalysis>` instead of a weak-id set; show a `text-xs text-vt-danger` line under the password row with a link that calls `setSection('analysis')`.
  Accept: a login with a reused password shows "Reused on N sites" in its detail pane; clicking Fix opens Password Health.
  Depends: none
  Size: S
- [ ] G05 [MISSING] [P1] Sidebar: auto-lock ring and Chrome connected status   (S5.3)
  Mock: ring "Locks in 4:12" and a "Chrome connected" line above Settings.
  Build: neither exists.
  Where: `src/renderer/src/components/Sidebar.tsx`
  Do: needs main to expose the lock deadline and bridge status (new IPC). Owner decision on exposing last-bridge-request time.
  Accept: ring counts down and resets on activity; line shows connected when the bridge saw a request in the last 5 minutes.
  Depends: none
  Size: L
- [x] G06 [MISSING] [P1] Settings: left section nav   (S12.1)
  Mock: sticky nav Security / Browser extension / Backup and sync / AI assistant / About, active item `bg-vt-surface2`.
  Build: one column of four groups.
  Where: `src/renderer/src/components/SettingsView.tsx` (page wrapper near the top of `return`)
  Do: add a left `nav` of buttons that call `document.getElementById(...).scrollIntoView()`; give each `SettingGroup` an `id`.
  Accept: clicking "Backup and sync" scrolls that group into view.
  Depends: none
  Size: S
  Done: SettingsView.tsx | Verified: code reading, npm run typecheck exit 0; nav lists the 4 existing groups, ids derived from titles, click calls scrollIntoView
- [x] G07 [MISSING] [P1] Recently Deleted: Restore all, and Undo after Restore   (S11.2, S11.4)
  Done: src/renderer/src/components/TrashView.tsx | Verified: code reading + npm run typecheck exit 0 (not run in app)
  Mock: header buttons Restore all and Empty now…; toast "Restored 'X'" with Undo.
  Build: only "Empty Trash"; restore toast has no Undo.
  Where: `src/renderer/src/components/TrashView.tsx`
  Do: Restore all loops `restoreTrashItem` then `refresh()`; header label "Empty now…". Undo needs a re-delete of any kind: use the per-kind `delete*` calls already in the preload.
  Accept: Restore all empties the list; a success toast follows.
  Depends: none
  Size: M
- [x] G08 [MISSING] [P1] Trash day groups use fixed buckets, not "Last month"   (S11.1)
  Done: src/renderer/src/components/TrashView.tsx | Verified: code reading + npm run typecheck exit 0 (not run in app)
  Mock: Today / Last week / Last month.
  Build: Today / This week / Last week / Earlier.
  Where: `TrashView.tsx` `groupByDay`
  Do: align bucket names with the mock or confirm the app's names win.
  Accept: item deleted 20 days ago sits under the mock's third heading.
  Depends: none
  Size: S
- [x] G09 [MISSING] [P1] Password Health: breakdown bars and "Fix next" queue   (S10.2, S10.3)
  Mock: four bars (weak, reused groups, older than a year, strong and unique) and a ranked fix list with +points and action buttons.
  Build: score ring (not weighted), four stat cards, and the issue table.
  Where: `PasswordHealthView.tsx`
  Do: bars from `stats`; the ranked queue is a Q-level product call (scoring weights).
  Accept: four labelled bars render and sum to the login count.
  Depends: none
  Size: M
  Done: PasswordHealthView.tsx (bars only; Fix next queue not built) | Verified: code reading, npm run typecheck exit 0; fill width = count/total clamped 0-100, card hidden when total is 0
- [ ] G10 [MISSING-FEATURE] [P2] API Keys: "Copy as .env" and "Write to file…" per project   (S7.3)
  Mock: both buttons on each project group.
  Build: neither.
  Where: `ApiKeyList.tsx` project header (`FolderIcon` row)
  Do: four-edit IPC call `copyProjectAsEnv(project)`; gated by `requireAuth('copy these keys')`, copy via `copyWithAutoClear`. "Write to file" writes plaintext secrets to disk: owner decision.
  Accept: clicking Copy as .env puts `NAME=value` lines on the clipboard and clears after 30 s.
  Depends: none
  Size: M
- [ ] G11 [MISSING] [P2] API Keys: "Last leak scan" tile   (S7.2)
  Mock: third tile shows the last scan date.
  Build: tile removed; the app does not record a scan time.
  Where: `LeakScanModal.tsx`, `settings.ts`
  Do: store `lastLeakScanAt` in `settings.json` (a timestamp is not a secret).
  Accept: after a scan the tile shows today's date.
  Depends: none
  Size: S
- [ ] G12 [MISSING] [P2] Secure notes: "Opened with Touch ID" footer and character count   (S8.3)
  Mock: footer line with fingerprint icon and "412 chars".
  Build: footer has Modified/Created and Delete only.
  Where: `SecureNotesView.tsx:182`
  Do: add `contentLength` (already on `SecureNoteSummary`) as `font-mono` text on the right of the footer.
  Accept: footer shows "N chars" matching the note.
  Depends: none
  Size: S

## Extras (in build, not in mock)
- E01 Logins "Accounts / File passwords" tab, `LoginList.tsx`. Keep or remove? (needs a yes)
- E02 Logins "Select to export…" CSV export, `LoginList.tsx`. Keep or remove?
- E03 Logins "Manage labels…", `LoginList.tsx`. Keep or remove?
- E04 Bookmarks dead-link check and refetch, `BookmarksView.tsx`. Keep or remove?
- E05 Recovery Codes "Scan a folder…", `RecoveryCodesView.tsx`. Keep or remove?

## Matches
S1 Unlock screen: Touch ID card, master password form, recovery link (structure only; no tick ring or footer chips: see Not checked)
S2.1 Logins list + inspector split; S2.3 weak badge; S5.1 sidebar groups Vault/Care; S5.2 Logins first; S9 Bookmarks grid, folder chips, sensitive blur, private window, Grid/List toggle; S10.1 score ring; S11.3 days-left bars; S12 Settings is a page; S7.1 stat strip (two of three tiles)

## Not checked
- Every visual value (colours, sizes, spacing): app not rendered.
- Unlock screen details: dashed tick ring, footer chips "local only / AES-256-GCM · scrypt / last unlocked".
- Logins: filter chips "Matches the Chrome tab" hint; clipboard pill (Q4).
- Responsive widths, empty and error states.

## Designer questions
```
Questions on Vaultic redesign (https://claude.ai/artifact/X3hus3ZJJVtSyM4uhPbgcM):
Recovery Codes:
1. Used/left meter needs a "used" flag per code. OK to store it? (Q1)
API Keys:
2. Show the first 8 characters of each key in lists? (Q2)
Settings:
3. "Ask Touch ID before every copy": ship it? (Q3)
Quick access:
4. Build the ⌘⇧V panel as a separate window, or keep the tray menu? (Q5)
```

## Inventory
<!-- the mock as read on 2026-11-25 -->
| ID | Screen | Element | Figma node | Key values |
|---|---|---|---|---|
| S1 | Main | Unlock: Touch ID ring, password form, footer chips | n/a | dashed tick ring, chips |
| S2.1 | Logins | list + inspector | n/a | three-pane 1280x800 |
| S2.2 | Logins | clipboard pill | n/a | "clears in 24s" |
| S2.3 | Logins | Weak / 2FA badges | n/a | |
| S2.4 | Logins | filter chips + Chrome-tab hint | n/a | |
| S2.5 | Logins | Copy password ↵, Open and fill | n/a | |
| S2.6 | Logins | TOTP code + ring | n/a | |
| S2.7 | Logins | age/reuse warning + Fix | n/a | |
| S3 | CommandPalette | grouped results, action pane, prefixes | n/a | |
| S4 | QuickAccess | tray panel, generator, recents | n/a | |
| S5.1 | Sidebar | Vault / Care groups | n/a | width 232 |
| S5.2 | Sidebar | order, badges | n/a | |
| S5.3 | Sidebar | auto-lock ring, Chrome status | n/a | |
| S6.1 | RecoveryCodes | card grid | n/a | |
| S6.2 | RecoveryCodes | dot meter | n/a | red at <=2 |
| S6.3 | RecoveryCodes | Copy next code | n/a | |
| S7.1 | ApiKeys | stat tiles | n/a | 3 tiles |
| S7.2 | ApiKeys | last leak scan tile | n/a | |
| S7.3 | ApiKeys | per-project .env actions | n/a | |
| S7.4 | ApiKeys | prefix preview | n/a | |
| S8.1 | SecureNotes | list + reading pane | n/a | |
| S8.3 | SecureNotes | footer + char count | n/a | |
| S9 | Bookmarks | grid, chips, blur, Grid/List | n/a | |
| S10.1 | PasswordHealth | score ring | n/a | 78/100 |
| S10.2 | PasswordHealth | breakdown bars | n/a | |
| S10.3 | PasswordHealth | Fix next queue | n/a | |
| S11.1 | Trash | day groups | n/a | |
| S11.2 | Trash | Restore all / Empty now… | n/a | |
| S11.3 | Trash | days-left bar | n/a | red <=3 |
| S11.4 | Trash | Undo toast | n/a | |
| S12.1 | Settings | section nav | n/a | |
| S12.2 | Settings | page, groups | n/a | |
| S12.3 | Settings | Touch ID before every copy | n/a | |
