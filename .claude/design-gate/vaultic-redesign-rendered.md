# Design match, rendered pass: Vaultic redesign
Mock: https://claude.ai/artifact/X3hus3ZJJVtSyM4uhPbgcM | Build: `npm run dev` Electron window 1080x720, real vault (read-only navigation) | Date: 2026-11-25
Evidence: rendered (screenshots of the dev window; slightly tilted capture, so sizes below come from the accessibility tree where given). Supersedes the "code only" evidence in vaultic-redesign.md for the screens listed.
Not exercised: ⌘K palette, Enter-to-copy, Restore all / Undo, Settings nav scrolling, Logins reuse/age line (needs a login with an issue selected), Trash groups (trash is empty), Secure Notes list (vault has 0 notes). I did not create, delete or restore anything to reach them.

## Matches (rendered)
- Sidebar: Vault / Care groups, Logins first, counts, red badge on Password Health (441, equals the health page's "441 logins need attention"), Recently Deleted count. Nav buttons 211 px wide inside a 232 px sidebar.
- Logins: list + details split, "Copy password ↵" primary button beside Edit, Weak badge.
- API Keys: stat strip (Keys 894 / Expiring in 30 days 0 / Unused for 90 days 0), per-row last-used text ("Never used"), project groups with env sub-groups.
- Bookmarks: Grid/List toggle, folder chips, blurred sensitive thumbnails with "Sensitive · click to reveal", Open / private window / copy / edit / delete row.
- Password Health: score ring (44, red because under 70), breakdown bars (Weak 115, Reused 424, Older than a year 0, Strong and unique 225), stat cards, issue list.
- Settings: opens as a page; left nav (Security, Browser extension, Backup and sync, Storage and about); groups render after load.
- Empty states: Recently Deleted ("Trash is empty."), Secure Notes ("No secure notes yet.").

## New gaps found by rendering
- [ ] R1 [DIFFERS] [P1] macOS traffic lights overlap the sidebar logo
  Mock: window buttons sit above the brand row (Sidebar artboard).
  Build: the red/yellow/green buttons are drawn on top of the Vaultic logo mark at the top-left; the brand row has no top inset.
  Where: `src/renderer/src/components/Sidebar.tsx` (brand row, `mb-2 flex items-center gap-2.5 px-4 pb-4`) and the BrowserWindow titlebar style in `src/main/index.ts`.
  Do: add top padding to the sidebar (about 28 px) so the brand row clears the buttons; keep the draggable region if one exists.
  Accept: at 1080x720 the logo and wordmark sit fully below the traffic lights with no overlap.
  Depends: none | Size: S
- [ ] R2 [DIFFERS] [P2] Recovery Codes: "Reveal with Touch ID" and the dotted placeholder wrap onto two lines
  Mock: one-line reveal row.
  Build: at 1080 wide the button text wraps to two lines and the dots wrap too.
  Where: `src/renderer/src/components/RecoveryCodesView.tsx` (reveal row, `'•••• '.repeat(...)` and the Reveal button)
  Do: add `whitespace-nowrap` to the button and `truncate`/`min-w-0` to the dots span.
  Accept: both stay on one line at 1080 wide.
  Depends: none | Size: S
- [ ] R3 [EXTRA / QUESTION] [P1] Settings shows the bridge token in plain text on screen
  Mock: no token shown.
  Build: "Bridge token" row displays the full token in teal monospace next to a Copy button. This existed before the redesign.
  Where: `src/renderer/src/components/SettingsView.tsx` (Bridge token row)
  Question: mask it by default with a Reveal toggle? I would mask it. Owner decision (auth surface).
  Depends: Q6
- [ ] R4 [DIFFERS] [P2] Password Health score ring is red at 44 while the card says "441 logins need attention"; mock ring is teal at 78
  Not a defect in colour logic (threshold is 70); noting that the score formula (share of logins with no issue) differs from the mock's weighted score. Product decision, see Q-health in the first report.

## Still open from the first report
G03, G05 (held for owner approval), the P2 items G10–G12, Q1–Q5, extras E01–E05 (all still present in the build).

## Security note
Screenshots of the dev window show real vault data (login names, API key names, bookmark titles, the bridge token). None of it is quoted here or stored; the screenshots live only in the session's tool-results folder.

Next: run close-gaps on R1 and R2 (both S). R3 needs your answer first.
