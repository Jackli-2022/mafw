import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import * as http from "node:http"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import type { Event } from "electron"
import { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, net, Notification, screen, session } from "electron"

import { Deferred, Effect } from "effect"

import type { ServerReadyData } from "../preload/types"
import type { NotificationTarget } from "../shared/notifications"
import { checkAppExists, resolveAppPath } from "./apps"
import { CHANNEL } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand } from "./ipc"
import { getStore } from "./store"
import { NotificationHub } from "./notification-hub"
import { registerNotificationIpc, sanitizeNotificationInput } from "./notification-ipc"
import { publishPresenceNotifications } from "./presence-notifications"
import { readNotificationPrefs } from "./notification-prefs"
import { createNotificationWindowController, type FloatingWindowLike } from "./notification-window"

import { exportDebugLogs, initCrashReporter, initLogging, startNetLog, write as writeLog } from "./logging"
import { startMafwGw } from "./mafw-bootstrap"
import { configureManagedGatewayRoot, stopGateway } from "./mafw-sidecar"
import { createQuitCoordinator } from "./quit-coordinator"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import { registerMafwFileProtocol, mafwFileRoots } from "./mafw-file-protocol"
import { BROWSER_PARTITION } from "../shared/browser-policy"
import {
  finishFirstLaunchOnboarding,
  initializeOldLayoutEligibility,
  isFirstLaunchOnboardingPending,
  isOldLayoutEligible,
} from "./onboarding"
import {
  getDefaultServerUrl,
  preferAppEnv,
  setDefaultServerUrl,
} from "./server"
import { setupAutoUpdater, showUpdaterDialog } from "./updater"
import {
  createMainWindow,
  getLastFocusedWindow,
  getNavigationWindow,
  loadWindow,
  markAuxiliaryWindow,
  registerRendererProtocol,
  setRelaunchHandler,
  setAppQuitting,
  setBackgroundColor,
  setDockIcon,
  restoreMainWindows,
} from "./windows"
import { createTray, updateTrayPending, updateTrayPresence, setTrayNavigateHandler } from "./tray"
import { startTrayStatusPolling } from "./tray-status"
import { podPresence } from "./presence-model"
import { startPresencePolling } from "./presence-poller"
import type { NavigateGoalTarget } from "../shared/navigate-goal"
import { createWslServersController } from "./wsl/servers"
import { registerWslIpcHandlers } from "./wsl/ipc"
import { spawnWslSidecar } from "./wsl/sidecar"
import { migrate } from "./migrate"
import { cleanupStoreFiles } from "./store-cleanup"
import { startAutomationServer } from "./automation-server"

nativeTheme.themeSource = "system"

const APP_NAMES: Record<string, string> = {
  dev: "MAFW Dev",
  beta: "MAFW Beta",
  prod: "MAFW",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.mafw.desktop.dev",
  beta: "ai.mafw.desktop.beta",
  prod: "ai.mafw.desktop",
}
const TEST_ONBOARDING = process.env.OPENCODE_TEST_ONBOARDING === "1"
const jsCallStackFeature = "DocumentPolicyIncludeJSCallStacksInCrashReports"

// Every context menu is renderer-drawn. Suppress the native one at the
// webContents level too, so blank areas without a custom handler stay silent.
app.on("web-contents-created", (_event, contents) => {
  contents.on("context-menu", (event) => {
    event.preventDefault()
  })
})

let logger: ReturnType<typeof initLogging>

const pendingDeepLinks: string[] = []

function useEnvProxy() {
  try {
    // Electron 41.2 runs Node 24.14.1; latest @types/node@24 is 24.12.2.
    ;(http as any).setGlobalProxyFromEnv()
  } catch (error) {
    logger.warn("failed to load proxy environment", error)
  }
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  const win = getLastFocusedWindow()
  if (win) sendDeepLinks(win, urls)
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

const main = Effect.gen(function* () {
  // All context menus are renderer-drawn (context-menu/MenuHost); the
  // electron-context-menu default is intentionally not installed.

  // on macOS apps run in `/` which can cause issues with ripgrep
  try {
    process.chdir(homedir())
  } catch {}

  process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true"

  const appId = app.isPackaged ? APP_IDS[CHANNEL] : "ai.mafw.desktop.dev"
  const onboardingTestRoot = ((): string | undefined => {
    if (!TEST_ONBOARDING) return

    const root = join(tmpdir(), `opencode-onboarding-${randomUUID()}`)
    rmSync(root, { recursive: true, force: true })
    ;["data", "config", "cache", "state", "desktop", "session"].forEach((dir) =>
      mkdirSync(join(root, dir), { recursive: true }),
    )
    process.env.OPENCODE_DB = ":memory:"
    process.env.XDG_DATA_HOME = join(root, "data")
    process.env.XDG_CONFIG_HOME = join(root, "config")
    process.env.XDG_CACHE_HOME = join(root, "cache")
    process.env.XDG_STATE_HOME = join(root, "state")
    return root
  })()
  app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "MAFW Dev")
  app.setAppUserModelId(appId)
  app.setPath(
    "userData",
    onboardingTestRoot ? join(onboardingTestRoot, "desktop") : join(app.getPath("appData"), appId),
  )
  if (onboardingTestRoot) app.setPath("sessionData", join(onboardingTestRoot, "session"))
  configureManagedGatewayRoot(join(app.getPath("userData"), "gateway"))
  initializeOldLayoutEligibility(app.getPath("userData"))
  logger = initLogging()
  initCrashReporter()

  const wslServers = createWslServersController(
    app.getVersion(),
    async (distro) => {
      logger.log("spawning wsl sidecar", { distro })
      return spawnWslSidecar(distro, {
        onLine: (line) => logger.log("wsl sidecar", { distro, stream: line.stream, text: line.text }),
      })
    },
    {
      logger: {
        log: (message, meta) => logger.log(message, meta),
        error: (message, meta) => logger.error(message, meta),
      },
    },
  )
  // The MAFW gateway daemon is a standalone always-on service; quitting the
  // desktop keeps it running so automations and background recall continue.
  const stopSidecars = async () => {
    wslServers.stopAll()
  }
  let allowQuit = false
  let quitCoordinator: ReturnType<typeof createQuitCoordinator> | null = null
  const relaunch = () => {
    setAppQuitting()
    void Promise.allSettled([stopSidecars(), stopGateway()]).finally(() => {
      app.relaunch()
      app.exit(0)
    })
  }

  try {
    setDefaultCACertificates([...new Set([...getCACertificates("default"), ...getCACertificates("system")])])
  } catch (error) {
    logger.warn("failed to load system certificates", error)
  }

  logger.log("app starting", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    onboardingTest: Boolean(onboardingTestRoot),
  })

  ensureLoopbackNoProxy()
  useEnvProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
  const features = app.commandLine.getSwitchValue("enable-features")
  app.commandLine.appendSwitch("enable-features", features ? `${jsCallStackFeature},${features}` : jsCallStackFeature)
  if (!app.isPackaged) {
    // MAFW_DEBUG_PORT 可覆盖（多实例 dev 调试；默认 9222 可能被残留监听占用）
    app.commandLine.appendSwitch("remote-debugging-port", process.env.MAFW_DEBUG_PORT ?? "9222")
  }

  // Audio: 修复渲染进程 AudioContext 无声（out-of-process 音频服务在部分 Windows 上
  // 初始化失败导致 currentTime 推进但无物理输出）；autoplay-policy 双保险。
  app.commandLine.appendSwitch("disable-features", "AudioServiceOutOfProcess")
  app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required")

  // MAFW_ALLOW_MULTI_INSTANCE=1 旁路单实例锁（多实例 dev 调试用，配合 MAFW_DEBUG_PORT）
  if (!process.env.MAFW_ALLOW_MULTI_INSTANCE && !app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  preferAppEnv(app.getPath("userData"))

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("mafw://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    const win = getLastFocusedWindow()
    if (win) {
      win.show()
      win.focus()
    }
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", (event: Event) => {
    setAppQuitting()
    if (allowQuit) return
    event.preventDefault()
    if (quitCoordinator) {
      void quitCoordinator.requestQuit()
      return
    }
    void Promise.allSettled([stopSidecars(), stopGateway()]).finally(() => {
      allowQuit = true
      app.quit()
    })
  })

  app.on("will-quit", () => {
    setAppQuitting()
    void stopSidecars()
  })

  app.on("child-process-gone", (_event, details) => {
    writeLog("utility", "child process gone", { details }, "error")
  })

  app.on("render-process-gone", (_event, webContents, details) => {
    writeLog("window", "app render process gone", { url: webContents.getURL(), details }, "error")
  })

  setRelaunchHandler(() => {
    relaunch()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      setAppQuitting()
      void Promise.allSettled([stopSidecars(), stopGateway()]).finally(() => app.exit(0))
    })
  }

  const serverReady = Deferred.makeUnsafe<ServerReadyData, unknown>()

  yield* Effect.promise(() => app.whenReady())

  if (!TEST_ONBOARDING) migrate()
  yield* Effect.promise(() => cleanupStoreFiles(app.getPath("userData"))).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (result.deleted.length === 0) return
        logger.log("cleaned scoped store files", { count: result.deleted.length, scanned: result.scanned })
      }),
    ),
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to clean scoped store files", error)
      }),
    ),
  )
  app.setAsDefaultProtocolClient("mafw")
  registerRendererProtocol()
  // mafw-file://：文件预览（图片 <img> 走 defaultSession）+ 本地 HTML（webview 走浏览器 partition）。
  // Electron protocol 是 per-session，两边都要挂；scheme privileges 已在 windows.ts 模块加载期注册（ready 前）。
  registerMafwFileProtocol(
    [session.defaultSession, session.fromPartition(BROWSER_PARTITION)],
    mafwFileRoots,
    (url, opts) => net.fetch(url, opts),
  )
  setDockIcon()
  createTray()

  // Self-drawn notifications: main-process hub is the single source of truth.
  const notificationHub = new NotificationHub(getStore("mafw-notifications"))
  let notificationWindowRefresh: (() => void) | null = null
  // 悬浮窗主题跟主窗口上报的 effective theme；缺省回落系统外观。
  let notificationTheme: "light" | "dark" | null = null
  registerNotificationIpc({
    ipcMain,
    hub: notificationHub,
    store: getStore(),
    broadcast: (snapshot) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("mafw-notifications:changed", snapshot)
      }
    },
    onPrefsChanged: () => notificationWindowRefresh?.(),
    onThemeReported: (theme) => { notificationTheme = theme },
  })

  // Quick entry: global hotkey shows the window and focuses the composer.
  // Takes over the accelerator the dead mafw-menu once reserved.
  const QUICK_ENTRY_ACCELERATOR = "Ctrl+Shift+M"
  try {
    globalShortcut.register(QUICK_ENTRY_ACCELERATOR, () => {
      const win = getLastFocusedWindow()
      if (win) {
        win.show()
        win.focus()
        win.webContents.send("mafw-quick-entry")
      }
    })
  } catch (error) {
    logger.warn("failed to register quick entry hotkey", { error: String(error) })
  }
  app.on("will-quit", () => globalShortcut.unregister(QUICK_ENTRY_ACCELERATOR))
  const updater = setupAutoUpdater(stopGateway)
  const installUpdate = async () => {
    // quitAndInstall emits before-quit; let that pass only after the updater
    // has stopped the managed gateway through its own stop callback.
    allowQuit = true
    try {
      await updater.install()
    } catch (error) {
      allowQuit = false
      throw error
    }
  }
  const updaterApi = { ...updater, install: installUpdate }
  quitCoordinator = createQuitCoordinator({
    stopGateway,
    getUpdateReady: () => updater.getState().status === "ready",
    installUpdate,
    quit: () => {
      allowQuit = true
      app.quit()
    },
    onError: (error) => {
      allowQuit = false
      writeLog("utility", "desktop quit coordination failed", { error: String(error) }, "error")
    },
  })
  registerIpcHandlers({
    killSidecar: () => {},
    relaunch,
    awaitInitialization: Effect.fnUntraced(
      function* () {
        logger.log("awaiting server ready")
        const res = yield* Deferred.await(serverReady)
        logger.log("server ready", { url: res.url })
        return res
      },
      (e) => Effect.runPromise(e),
    ),
    consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
    getDefaultServerUrl: () => getDefaultServerUrl(),
    setDefaultServerUrl: (url) => setDefaultServerUrl(url),
    isFirstLaunchOnboardingPending,
    finishFirstLaunchOnboarding,
    isOldLayoutEligible,
    getDisplayBackend: async () => null,
    setDisplayBackend: async () => undefined,
    parseMarkdown: async (markdown) => parseMarkdown(markdown),
    checkAppExists: (appName) => checkAppExists(appName),
    resolveAppPath: async (appName) => resolveAppPath(appName),
    updater: updaterApi,
    showUpdater: () => showUpdaterDialog(updaterApi, true),
    setBackgroundColor: (color) => setBackgroundColor(color),
    exportDebugLogs: () => exportDebugLogs(),
    recordFatalRendererError: (error) => writeLog("renderer", "fatal renderer error", { ...error }, "error"),
    // 旧通道（show-notification / mafw-notify）也过 sanitize：非字符串/超长
    // title 不得进 hub，p3 一律拒绝。
    publishNotification: (input) => {
      const sanitized = sanitizeNotificationInput(input)
      return sanitized ? notificationHub.publish(sanitized) : null
    },
  })
  registerWslIpcHandlers(wslServers)
  void updater.start()
  const updateTimer = setInterval(() => void updater.check(), 10 * 60 * 1000)
  updateTimer.unref()
  app.once("will-quit", () => clearInterval(updateTimer))
  yield* Effect.promise(() => startNetLog()).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        logger.warn("failed to start net log", error)
      }),
    ),
  )

  if (process.platform === "win32") {
    void wslServers.initialize().catch((error) => logger.error("wsl server initialization failed", error))
  }

  // Start MAFW Gateway (gateway manages its own opencode server)
  const gwUrl = yield* Effect.promise(() => startMafwGw())
  if (gwUrl) {
    yield* Deferred.succeed(serverReady, {
      url: gwUrl,
      username: "opencode",
      password: null,
    })
    // Tray status: pending approvals/permissions → tooltip + menu status line.
    const stopTrayStatus = startTrayStatusPolling({
      getBaseUrl: () => gwUrl,
      onPending: (pending) => updateTrayPending(pending),
    })
    app.once("will-quit", stopTrayStatus)

    // Cross-project Goal presence → tray icon state + taskbar progress + hub.
    const presencePoll = startPresencePolling({
      getBaseUrl: () => gwUrl,
      onSnapshot: (payload) => {
        const view = podPresence(payload)
        updateTrayPresence(view)
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.isDestroyed()) continue
          win.setProgressBar(view.progress)
        }
        publishPresenceNotifications(notificationHub, payload)
      },
      log: (msg) => logger.warn(msg),
    })
    app.once("will-quit", () => presencePoll.stop())
    // `pod.event` 到达时 renderer 立刻催一次，完成通知不再等 15s 轮询。
    ipcMain.removeHandler("mafw-presence-refresh")
    ipcMain.handle("mafw-presence-refresh", () => { presencePoll.poll() })
    // 导航窗口选择：悬浮通知窗是 auxiliary（点击它不能把导航吞进自己）。
    const showNavigationWindow = (send: (win: BrowserWindow) => void): void => {
      const win = getNavigationWindow()
      if (!win) {
        const created = createMainWindow()
        created.webContents.once("did-finish-load", () => {
          if (!created.isDestroyed()) send(created)
        })
        return
      }
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      send(win)
    }
    function navigateToGoal(target: NavigateGoalTarget): void {
      if (!target?.goalId) return
      showNavigationWindow((win) => win.webContents.send("mafw-navigate-goal", target))
    }
    function navigateToNotificationTarget(target: NotificationTarget | undefined): void {
      if (!target) return
      showNavigationWindow((win) => win.webContents.send("mafw-notification-open", target))
    }
    setTrayNavigateHandler(navigateToGoal)

    // 自绘悬浮通知窗（只 p1/p2；不抢焦点；点击 → 聚焦主窗口 + target 路由）。
    let notificationWindow: BrowserWindow | null = null
    const notificationWindowController = createNotificationWindowController({
      hub: notificationHub,
      getPrefs: () => readNotificationPrefs(getStore()),
      getWorkArea: () => {
        const focused = getNavigationWindow()
        const display =
          focused && !focused.isDestroyed()
            ? screen.getDisplayMatching(focused.getBounds())
            : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
        return display.workArea
      },
      getTheme: () => notificationTheme ?? (nativeTheme.shouldUseDarkColors ? "dark" : "light"),
      mainWindowBackgrounded: () => {
        const win = getNavigationWindow()
        return !win || !win.isVisible() || win.isMinimized() || !win.isFocused()
      },
      ensureWindow: (handlers) => {
        const win = new BrowserWindow({
          width: 360,
          height: 92,
          show: false,
          frame: false,
          transparent: true,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          focusable: false,
          alwaysOnTop: true,
          hasShadow: false,
          webPreferences: {
            preload: join(__dirname, "../preload/notification.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
          },
        })
        win.setAlwaysOnTop(true, "screen-saver")
        markAuxiliaryWindow(win)
        notificationWindow = win
        const fromThisWindow = (event: { sender: unknown }) =>
          !win.isDestroyed() && event.sender === win.webContents
        type Listener = (event: { sender: unknown }, ...args: any[]) => void
        const listeners: Array<[string, Listener]> = []
        const addListener = (channel: string, listener: Listener) => {
          listeners.push([channel, listener])
          ipcMain.on(channel, listener as never)
        }
        addListener("notification:dismiss", (event, id) => {
          if (fromThisWindow(event) && typeof id === "string") handlers.dismiss(id)
        })
        addListener("notification:hover", (event, id, hovering) => {
          if (fromThisWindow(event) && typeof id === "string") handlers.hover(id, !!hovering)
        })
        addListener("notification:open", (event, id) => {
          if (fromThisWindow(event) && typeof id === "string") handlers.open(id)
        })
        win.on("closed", () => {
          // 窗口销毁即解绑：悬浮窗重建（reload/renderer 崩溃恢复）时旧监听
          // 不随 ipcMain 累积（M-4）。
          for (const [channel, listener] of listeners) {
            ipcMain.removeListener(channel, listener as never)
          }
          listeners.length = 0
          if (notificationWindow === win) notificationWindow = null
        })
        loadWindow(win, "notification/index.html")
        const floating: FloatingWindowLike = {
          webContents: win.webContents,
          setBounds: (bounds) => { if (!win.isDestroyed()) win.setBounds(bounds) },
          showInactive: () => { if (!win.isDestroyed()) win.showInactive() },
          hide: () => { if (!win.isDestroyed()) win.hide() },
          isDestroyed: () => win.isDestroyed(),
          onceReady: (cb) => {
            win.webContents.once("did-finish-load", () => { if (!win.isDestroyed()) cb() })
          },
        }
        return floating
      },
      navigate: navigateToNotificationTarget,
      nativeNotify: (item) => {
        if (!Notification.isSupported()) return
        try {
          const native = new Notification({ title: item.title, body: item.body ?? "" })
          native.on("click", () => {
            notificationHub.markRead([item.id])
            navigateToNotificationTarget(item.target)
          })
          native.show()
        } catch {
          // fail-open: the in-app center still has the item
        }
      },
    })
    notificationWindowRefresh = () => notificationWindowController.refreshPrefs()
    app.once("will-quit", () => {
      notificationWindowController.dispose()
      if (notificationWindow && !notificationWindow.isDestroyed()) notificationWindow.destroy()
    })
  } else {
    logger.error("MAFW Gateway failed to start")
    yield* Deferred.fail(serverReady, new Error("MAFW Gateway failed to start"))
  }

  const windows = restoreMainWindows()
  if (windows.length) {
    createMenu({
      trigger: (id) => {
        const win = getLastFocusedWindow()
        if (win) sendMenuCommand(win, id)
      },
      checkForUpdates: () => {
        void showUpdaterDialog(updaterApi, true)
      },
      relaunch: () => {
        relaunch()
      },
    })
  }

  // Start Automation Server for agent GUI control
  const screenshotsDir = join(homedir(), ".mafw", "screenshots")
  const configDir = join(homedir(), ".config", "mafw")
  startAutomationServer(screenshotsDir, () => getLastFocusedWindow(), (info) => {
    // Written from the listening callback: the port is only known once the
    // server has actually bound (see automation-server.ts).
    try {
      mkdirSync(configDir, { recursive: true })
      writeFileSync(
        join(configDir, "desktop-automation.json"),
        JSON.stringify(info, null, 2),
        "utf-8",
      )
      logger.log("automation server started", info)
    } catch (err) {
      logger.warn("failed to write desktop-automation.json", err)
    }
  })
})

Effect.runFork(main)
