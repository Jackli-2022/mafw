import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { ElectronAPI, WslServersEvent, BrowserOpenRequest } from "./types"
import type { UpdaterState } from "../types/updater"

const updaterCallbacks = new Set<(state: UpdaterState) => void>()
let updaterState: UpdaterState | undefined
let updaterSubscription: Promise<void> | undefined
const updaterHandler = (_: unknown, state: UpdaterState) => {
  updaterState = state
  updaterCallbacks.forEach((callback) => callback(state))
}

import { createMafwApi } from "./mafw-api"

const mafwApi = createMafwApi()

const api: ElectronAPI = {
  killSidecar: () => ipcRenderer.invoke("kill-sidecar"),
  installCli: () => ipcRenderer.invoke("install-cli"),
  awaitInitialization: () => ipcRenderer.invoke("await-initialization"),
  wslServers: {
    getState: () => ipcRenderer.invoke("wsl-servers-get-state"),
    subscribe: (cb) => {
      const handler = (_: unknown, event: WslServersEvent) => cb(event)
      ipcRenderer.on("wsl-servers-event", handler)
      void ipcRenderer.invoke("wsl-servers-subscribe")
      return () => {
        ipcRenderer.removeListener("wsl-servers-event", handler)
        void ipcRenderer.invoke("wsl-servers-unsubscribe")
      }
    },
    probeRuntime: () => ipcRenderer.invoke("wsl-servers-probe-runtime"),
    refreshDistros: () => ipcRenderer.invoke("wsl-servers-refresh-distros"),
    installWsl: () => ipcRenderer.invoke("wsl-servers-install-wsl"),
    installDistro: (name) => ipcRenderer.invoke("wsl-servers-install-distro", name),
    probeAddable: (distros) => ipcRenderer.invoke("wsl-servers-probe-addable", distros),
    installOpencode: (name) => ipcRenderer.invoke("wsl-servers-install-opencode", name),
    openTerminal: (name) => ipcRenderer.invoke("wsl-servers-open-terminal", name),
    addServer: (distro) => ipcRenderer.invoke("wsl-servers-add", distro),
    removeServer: (id) => ipcRenderer.invoke("wsl-servers-remove", id),
    startServer: (id) => ipcRenderer.invoke("wsl-servers-start", id),
  },
  updater: {
    subscribe: async (cb) => {
      updaterCallbacks.add(cb)
      if (updaterState) cb(updaterState)
      if (!updaterSubscription) {
        ipcRenderer.on("updater-state", updaterHandler)
        updaterSubscription = ipcRenderer.invoke("updater-subscribe")
      }
      await updaterSubscription
      return () => {
        updaterCallbacks.delete(cb)
        if (updaterCallbacks.size > 0) return
        ipcRenderer.removeListener("updater-state", updaterHandler)
        updaterSubscription = undefined
        void ipcRenderer.invoke("updater-unsubscribe")
      }
    },
    check: () => ipcRenderer.invoke("updater-check"),
    install: () => ipcRenderer.invoke("updater-install"),
  },
  consumeInitialDeepLinks: () => ipcRenderer.invoke("consume-initial-deep-links"),
  getDefaultServerUrl: () => ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => ipcRenderer.invoke("set-default-server-url", url),
  isFirstLaunchOnboardingPending: () => ipcRenderer.invoke("is-first-launch-onboarding-pending"),
  finishFirstLaunchOnboarding: (createDefaultProject) =>
    ipcRenderer.invoke("finish-first-launch-onboarding", createDefaultProject),
  isOldLayoutEligible: () => ipcRenderer.invoke("is-old-layout-eligible"),
  getDisplayBackend: () => ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => ipcRenderer.invoke("set-display-backend", backend),
  parseMarkdownCommand: (markdown) => ipcRenderer.invoke("parse-markdown", markdown),
  checkAppExists: (appName) => ipcRenderer.invoke("check-app-exists", appName),
  resolveAppPath: (appName) => ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),

  getWindowCount: () => ipcRenderer.invoke("get-window-count"),
  getWindowID: () => ipcRenderer.invoke("get-window-id"),
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },
  onQuickEntry: (cb) => {
    const handler = () => cb()
    ipcRenderer.on("mafw-quick-entry", handler)
    return () => ipcRenderer.removeListener("mafw-quick-entry", handler)
  },

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  readPickedFile: (token, path) => ipcRenderer.invoke("read-picked-file", token, path),
  releasePickedFiles: (token) => ipcRenderer.invoke("release-picked-files", token),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  openLink: (url) => ipcRenderer.send("open-link", url),
  openPath: (path, app) => ipcRenderer.invoke("open-path", path, app),
  revealPath: (path) => ipcRenderer.invoke("reveal-path", path),
  edit: {
    cut: () => ipcRenderer.invoke("edit-cut"),
    copy: () => ipcRenderer.invoke("edit-copy"),
    paste: () => ipcRenderer.invoke("edit-paste"),
    selectAll: () => ipcRenderer.invoke("edit-select-all"),
    copyImageAt: (x: number, y: number) => ipcRenderer.invoke("edit-copy-image-at", x, y),
  },
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  showNotification: (title, body) => ipcRenderer.send("show-notification", title, body),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  getPinchZoomEnabled: () => ipcRenderer.invoke("get-pinch-zoom-enabled"),
  setPinchZoomEnabled: (enabled) => ipcRenderer.invoke("set-pinch-zoom-enabled", enabled),
  getTrayPrefs: () => ipcRenderer.invoke("get-tray-prefs"),
  setTrayPrefs: (prefs) => ipcRenderer.invoke("set-tray-prefs", prefs),
  onPinchZoomEnabledChanged: (cb) => {
    const handler = (_: unknown, enabled: boolean) => cb(enabled)
    ipcRenderer.on("pinch-zoom-enabled-changed", handler)
    return () => ipcRenderer.removeListener("pinch-zoom-enabled-changed", handler)
  },
  onZoomFactorChanged: (cb) => {
    const handler = (_: unknown, factor: number) => cb(factor)
    ipcRenderer.on("zoom-factor-changed", handler)
    return () => ipcRenderer.removeListener("zoom-factor-changed", handler)
  },
  platform: process.platform,
  windowControls: {
    minimize: () => ipcRenderer.invoke("window-minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window-toggle-maximize"),
    close: () => ipcRenderer.invoke("window-close"),
    isMaximized: () => ipcRenderer.invoke("window-is-maximized"),
    onMaximizedChange: (cb) => {
      const handler = (_: unknown, maximized: boolean) => cb(maximized)
      ipcRenderer.on("window-maximized-changed", handler)
      return () => ipcRenderer.removeListener("window-maximized-changed", handler)
    },
    isExpanded: () => ipcRenderer.invoke("window-is-expanded"),
    onExpandedChange: (cb) => {
      const handler = (_: unknown, expanded: boolean) => cb(expanded)
      ipcRenderer.on("window-expanded-changed", handler)
      return () => ipcRenderer.removeListener("window-expanded-changed", handler)
    },
  },
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  runDesktopMenuAction: (action) => ipcRenderer.invoke("run-desktop-menu-action", action),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
  exportDebugLogs: () => ipcRenderer.invoke("export-debug-logs"),
  recordFatalRendererError: (error) => ipcRenderer.invoke("record-fatal-renderer-error", error),

  mafw: mafwApi,

  // 文件原语（agent workbench；main 侧 jail + 原语，见 fs-workspace.ts）
  fs: {
    listDir: (root, rel) => ipcRenderer.invoke("fs-list-dir", root, rel),
    readFile: (root, rel) => ipcRenderer.invoke("fs-read-file", root, rel),
    statFile: (root, rel) => ipcRenderer.invoke("fs-stat-file", root, rel),
    writeFile: (root, rel, content, opts) => ipcRenderer.invoke("fs-write-file", root, rel, content, opts),
    registerRoot: (absDir) => ipcRenderer.invoke("fs-register-root", absDir),
    watch: (root, rel) => ipcRenderer.invoke("fs-watch", root, rel),
    unwatch: (root, rel) => ipcRenderer.invoke("fs-unwatch", root, rel),
    onChanged: (cb) => {
      const handler = (_: unknown, e: { root: string; rel: string }) => cb(e)
      ipcRenderer.on("fs-file-changed", handler)
      return () => ipcRenderer.removeListener("fs-file-changed", handler)
    },
    watchDir: (root, rel) => ipcRenderer.invoke("fs-watch-dir", root, rel),
    unwatchDir: (root, rel) => ipcRenderer.invoke("fs-unwatch-dir", root, rel),
    onDirChanged: (cb) => {
      const handler = (_: unknown, e: { root: string; rel: string }) => cb(e)
      ipcRenderer.on("fs-dir-changed", handler)
      return () => ipcRenderer.removeListener("fs-dir-changed", handler)
    },
    openExternal: (root, rel) => ipcRenderer.invoke("fs-open-external", root, rel),
  },

  // 内嵌浏览器：window.open / target=_blank 被 main 拦截后转 dock 内导航
  browser: {
    onOpenUrl: (cb: (req: BrowserOpenRequest) => void) => {
      const handler = (_: unknown, payload: string | BrowserOpenRequest) => {
        if (typeof payload === "string") cb({ url: payload, newTab: true })
        else if (payload && typeof payload.url === "string") cb({ url: payload.url, newTab: payload.newTab !== false })
      }
      ipcRenderer.on("browser-open-url", handler)
      return () => ipcRenderer.removeListener("browser-open-url", handler)
    },
    onContextMenu: (cb: (payload: import("./types").BrowserContextMenuPayload) => void) => {
      const handler = (_: unknown, payload: import("./types").BrowserContextMenuPayload) => cb(payload)
      ipcRenderer.on("browser-context-menu", handler)
      return () => ipcRenderer.removeListener("browser-context-menu", handler)
    },
    openExternal: (url) => ipcRenderer.invoke("browser-open-external", url),
  },

  // G1 截屏：整屏捕获（裁剪在 renderer）；G2 元素截图：窗口内容区矩形 → main 截屏裁剪
  capture: {
    start: () => ipcRenderer.invoke("mafw-capture-start"),
    windowRegion: (rect: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke("mafw-capture-window-region", { rect }),
  },

  // 批注草稿（main 侧 electron-store）
  annotations: {
    list: (sessionID) => ipcRenderer.invoke("annotations-list", sessionID),
    add: (a) => ipcRenderer.invoke("annotations-add", a),
    remove: (sessionID, id) => ipcRenderer.invoke("annotations-remove", sessionID, id),
    clear: (sessionID) => ipcRenderer.invoke("annotations-clear", sessionID),
  },

  onNavigateMafw: (cb) => {
    const handler = () => cb()
    ipcRenderer.on("navigate-mafw", handler)
    return () => ipcRenderer.removeListener("navigate-mafw", handler)
  },
}

contextBridge.exposeInMainWorld("api", api)
