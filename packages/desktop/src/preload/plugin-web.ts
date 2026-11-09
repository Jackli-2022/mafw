// packages/desktop/src/preload/plugin-web.ts
// Preload for sandboxed plugin web surfaces. electron-vite emits this entry as
// `out/preload/plugin-web.js`; `main/plugin-web-session.ts` force-installs it on
// every `<webview>` that uses a `persist:mafw-plugin-*` partition.
//
// The `window.mafwPlugin` bridge (context/invoke/onEvent/setBadge/…) arrives in
// the surface-host task; until then this file only exists so the preload build
// entry is real and the packaged app ships the expected layout.
export {}
