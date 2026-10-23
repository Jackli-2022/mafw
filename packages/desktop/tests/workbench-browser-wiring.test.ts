import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 浏览器 tab 接线契约（source-level，与 workbench-wiring 同风格）。
const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("浏览器 tab 接线", () => {
  test("DockTab 含 browser，RightDock 有入口", () => {
    const tabs = read("src/renderer/mafw/components/dock-tab.ts")
    expect(tabs).toContain('"browser"')
    const dock = read("src/renderer/mafw/components/RightDock.tsx")
    expect(dock).toContain('value="browser"')
    expect(dock).toContain("🌐 浏览")
  })
  test("MafwShell 渲染 BrowserDock 分支", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toContain("BrowserDock")
    expect(shell).toContain('rightDockTab() === "browser"')
  })
  test("dock 宽度策略把 browser 当 workbench tab（可拉宽）", () => {
    const width = read("src/renderer/mafw/dock-width.ts")
    expect(width).toMatch(/WORKBENCH_TABS[\s\S]*"browser"/)
  })
  test("BrowserDock 使用独立 partition 且无 preload/allowpopups", () => {
    const dock = read("src/renderer/mafw/components/BrowserDock.tsx")
    expect(dock).toContain("BROWSER_PARTITION")
    expect(dock).not.toContain("allowpopups")
    expect(dock).not.toContain("webpreferences=")
  })
  test("main 侧策略：权限全拒 + guest window-open 转 dock 内导航 + webview 加固", () => {
    const main = read("src/main/browser-session.ts")
    expect(main).toContain("setPermissionRequestHandler")
    expect(main).toContain("setPermissionCheckHandler")
    expect(main).toContain("web-contents-created")
    expect(main).toContain("will-attach-webview")
    expect(main).toContain("setWindowOpenHandler")
    // 初始页 about:blank 必须放行（否则 webview 永远挂不上）
    expect(main).toContain("guestAttachAllowed")
  })
  test("preload 暴露 browser.onOpenUrl 事件", () => {
    const api = read("src/preload/index.ts")
    const types = read("src/preload/types.ts")
    expect(api).toContain("browser")
    expect(api).toContain("onOpenUrl")
    expect(types).toContain("onOpenUrl")
  })
})
