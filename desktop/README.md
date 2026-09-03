# Vantrix Desktop

Thin Tauri shell that wraps the deployed Vantrix web app (vantrix.app) into a
native, downloadable desktop app for macOS, Windows, and Linux — reusing the
same PWA manifest/service worker, no separate frontend to maintain.

## Why Tauri (not Electron)
- Ships a ~5–10MB installer (uses the OS's native webview) vs Electron's ~150MB+.
- No Node/Chromium bundled — lower memory, faster startup.
- Still produces real installers: `.dmg`/`.app` (macOS), `.msi`/`.exe` (Windows), `.AppImage`/`.deb` (Linux).

## Setup
```bash
cd desktop
npm install
# Rust toolchain required: https://www.rust-lang.org/tools/install
npm run tauri build
```

Installers land in `desktop/src-tauri/target/release/bundle/`.

## Config
`src-tauri/tauri.conf.json` points `build.devPath`/`distDir` at the production
URL (`VANTRIX_URL`, defaults to https://vantrix.app). Update it once the
production domain is finalized. Auth, push notifications, and the service
worker all work as-is since this is just a native window around the same
deployed site — no code duplication with `src/app`.

## Icons
Drop 32x32 / 128x128 / 128x128@2x / icon.icns / icon.ico into
`src-tauri/icons/` (reuse the existing `public/icons/icon-512.png` as the
source, run `npm run tauri icon public/icons/icon-512.png` to generate the
full set automatically).
