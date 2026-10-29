import type { DesktopMenuAction } from "../types/desktop-menu"
import type { WslServersPlatform } from "../types/wsl-types"
import type { UpdaterState } from "../types/updater"
export type {
  WslDistroProbe,
  WslInstalledDistro,
  WslJob,
  WslOnlineDistro,
  WslOpencodeCheck,
  WslRuntimeCheck,
  WslServerConfig,
  WslServerItem,
  WslServerRuntime,
  WslServersEvent,
  WslServersState,
} from "../types/wsl-types"

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
}

export type WslServersAPI = WslServersPlatform

/** fs 原语 DTO（与 src/main/fs-workspace.ts 形状一致；preload 不 import main）。 */
export type FsEntryDTO = { name: string; kind: "file" | "dir" }
export type FsReadResult =
  | { ok: true; content: string; mtimeMs: number; eol: "\n" | "\r\n" }
  | { ok: false; reason: "too-large" | "binary" | "encoding" | "not-found" | "io" }
export type FsWriteResult =
  | { ok: true }
  | { ok: false; reason: "jail" | "not-found" | "conflict" | "io" }
/** 图片预览元数据（只 stat，不读二进制）。 */
export type FsStatResult =
  | { ok: true; size: number; mtimeMs: number }
  | { ok: false; reason: "jail" | "not-found" | "io" }
export type FsAPI = {
  listDir(root: string, rel: string): Promise<FsEntryDTO[] | null>
  readFile(root: string, rel: string): Promise<FsReadResult>
  statFile(root: string, rel: string): Promise<FsStatResult>
  writeFile(root: string, rel: string, content: string, opts?: { ifMtimeMs?: number; eol?: "\n" | "\r\n" }): Promise<FsWriteResult>
  /** 为 mafw-file:// 预览协议注册会话根（幂等）；返回不透明 token，失败 null。 */
  registerRoot(absDir: string): Promise<string | null>
  watch(root: string, rel: string): Promise<void>
  unwatch(root: string, rel: string): Promise<void>
  onChanged(cb: (e: { root: string; rel: string }) => void): () => void
  openExternal(root: string, rel: string): Promise<{ ok: boolean }>
}
export type BrowserOpenRequest = { url: string; newTab: boolean }

export type BrowserContextMenuPayload = {
  url: string
  linkURL?: string
  selectionText?: string
  imageURL?: string
  isEditable: boolean
  x: number
  y: number
  canGoBack: boolean
  canGoForward: boolean
  webContentsId: number
}

/** 内嵌浏览器（main 侧策略在 browser-session.ts；MafwShell 订阅后转 dock 新 tab）。 */
export type BrowserAPI = {
  onOpenUrl(cb: (req: BrowserOpenRequest) => void): () => void
  onContextMenu(cb: (payload: BrowserContextMenuPayload) => void): () => void
  openExternal(url: string): Promise<{ ok: boolean }>
}
/** 批注草稿（main 侧 electron-store JSON；形状与 shared/annotation-types.ts 一致）。 */
export type AnnotationsAPI = {
  list(sessionID: string): Promise<import("../shared/annotation-types").Annotation[]>
  add(a: import("../shared/annotation-types").Annotation): Promise<unknown>
  remove(sessionID: string, id: string): Promise<unknown>
  clear(sessionID: string): Promise<unknown>
}
/** G1 截屏：整屏捕获（裁剪在 renderer 浮层）；G2 元素截图经 main 截屏裁剪（窗口内容区矩形）。 */
export type CaptureAPI = {
  start(): Promise<{ dataUrl: string; width: number; height: number } | null>
  windowRegion(rect: { x: number; y: number; width: number; height: number }): Promise<{ dataUrl: string; width: number; height: number } | null>
}
export type UpdaterAPI = {
  subscribe: (cb: (state: UpdaterState) => void) => Promise<() => void>
  check: () => Promise<UpdaterState>
  install: () => Promise<void>
}

export type LinuxDisplayBackend = "wayland" | "auto"
export type TrayPrefs = {
  trayIcon: boolean
  closeToTray: boolean
}
export type TitlebarTheme = {
  mode: "light" | "dark"
  scheme?: "system" | "light" | "dark"
}
export type FatalRendererError = {
  error: string
  url: string
  version?: string
  platform: string
  os?: string
}

import type { MafwAPI } from "./mafw-types"

export type { MafwAPI }

export type ElectronAPI = {
  killSidecar: () => Promise<void>
  installCli: () => Promise<string>
  awaitInitialization: () => Promise<ServerReadyData>
  wslServers: WslServersAPI
  updater: UpdaterAPI
  fs: FsAPI
  browser: BrowserAPI
  annotations: AnnotationsAPI
  capture: CaptureAPI
  consumeInitialDeepLinks: () => Promise<string[]>
  getDefaultServerUrl: () => Promise<string | null>
  setDefaultServerUrl: (url: string | null) => Promise<void>
  isFirstLaunchOnboardingPending: () => Promise<boolean>
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null>
  isOldLayoutEligible: () => Promise<boolean>
  getDisplayBackend: () => Promise<LinuxDisplayBackend | null>
  setDisplayBackend: (backend: LinuxDisplayBackend | null) => Promise<void>
  parseMarkdownCommand: (markdown: string) => Promise<string>
  checkAppExists: (appName: string) => Promise<boolean>
  resolveAppPath: (appName: string) => Promise<string | null>
  storeGet: (name: string, key: string) => Promise<string | null>
  storeSet: (name: string, key: string, value: string) => Promise<void>
  storeDelete: (name: string, key: string) => Promise<void>
  storeClear: (name: string) => Promise<void>
  storeKeys: (name: string) => Promise<string[]>
  storeLength: (name: string) => Promise<number>

  getWindowCount: () => Promise<number>
  getWindowID: () => Promise<string>
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void
  onQuickEntry: (cb: () => void) => () => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    extensions?: string[]
  }) => Promise<{ token: string; files: { path: string; name: string; size: number }[] } | null>
  readPickedFile: (token: string, path: string) => Promise<ArrayBuffer>
  releasePickedFiles: (token: string) => Promise<void>
  getPathForFile: (file: File) => string
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openLink: (url: string) => void
  openPath: (path: string, app?: string) => Promise<void>
  revealPath: (path: string) => Promise<boolean>
  edit: {
    cut: () => Promise<void>
    copy: () => Promise<void>
    paste: () => Promise<void>
    selectAll: () => Promise<void>
    copyImageAt: (x: number, y: number) => Promise<void>
  }
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification: (title: string, body?: string) => void
  getWindowFocused: () => Promise<boolean>
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  getPinchZoomEnabled: () => Promise<boolean>
  setPinchZoomEnabled: (enabled: boolean) => Promise<void>
  getTrayPrefs: () => Promise<TrayPrefs>
  setTrayPrefs: (prefs: Partial<TrayPrefs>) => Promise<void>
  onPinchZoomEnabledChanged: (cb: (enabled: boolean) => void) => () => void
  onZoomFactorChanged: (cb: (factor: number) => void) => () => void
  platform: string
  windowControls: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (cb: (maximized: boolean) => void) => () => void
    isExpanded: () => Promise<boolean>
    onExpandedChange: (cb: (expanded: boolean) => void) => () => void
  }
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  runDesktopMenuAction: (action: DesktopMenuAction) => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void>
  mafw: MafwAPI
  onNavigateMafw: (cb: () => void) => () => void
}
