# Vaultic Chrome extension

Local-first browser companion for the Vaultic desktop app — fill logins on websites and save new ones back into your encrypted vault (similar to 1Password’s browser extension, without cloud sync).

## Requirements

- Vaultic desktop app running on macOS
- Google Chrome
- Node.js on your PATH (for the Native Messaging host)

## Install

1. **Start Vaultic** and unlock your vault.
2. **Load the extension**
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - **Load unpacked** → select this `extension/` folder  
   - Extension ID should be `lpeabbfkhjldbhilgbjoieaiofamefgf` (pinned via the manifest `key`)
3. **Connect to Vaultic** (pick one)
   - **Recommended:** Vaultic → Settings → Browser extension → **Install browser bridge**  
     (registers Chrome Native Messaging; no token paste needed after that)
   - **Fallback:** copy the bridge token from Settings and paste it into the extension **Options** page

## Use

| Action | How |
|--------|-----|
| Fill a login | Click the teal **V** on a password field, or open the toolbar popup and pick a login |
| Save a login | Submit a login form — Vaultic offers **Save to Vaultic?** |
| TOTP | If the login has a TOTP secret, the code is copied when you fill |

Filling and saving are gated by Touch ID when available (same as the desktop app). The vault must be **unlocked**.

## How it talks to Vaultic

```
Chrome extension
   ├─ Native Messaging → native-host (token + localhost proxy)
   └─ or HTTPS-less http://127.0.0.1:17843 with Bearer token
              ↓
     Vaultic Electron main process (browser bridge)
```

The bridge only listens on `127.0.0.1`. Passwords are never listed over the wire until you explicitly unlock a login (biometric-gated).

## Dev notes

- Manifest `key` keeps a stable extension ID so Native Messaging `allowed_origins` stays valid.
- Re-run **Install browser bridge** after regenerating the bridge token or moving the app.
