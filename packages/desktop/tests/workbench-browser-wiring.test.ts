import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// 浏览器 tab 接线契约（source-level，与 workbench-wiring 同风格）。
const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("浏览器 tab 接线（2026-10-26 工作台合并后）", () => {
  test("浏览器是 Workbench 主区 tab（不再是 dock tab）", () => {
    const tabs = read("src/renderer/mafw/components/dock-tab.ts")
    expect(tabs).not.toContain('"browser"')
    const wb = read("src/renderer/mafw/components/Workbench.tsx")
    expect(wb).toContain("BrowserDock")
    expect(wb).toContain("浏览器")
  })
  test("MafwShell 经 Workbench 渲染 BrowserDock", () => {
    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toContain("<Workbench")
    const wb = read("src/renderer/mafw/components/Workbench.tsx")
    expect(wb).toContain("BrowserDock")
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
