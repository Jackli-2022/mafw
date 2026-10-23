import { describe, expect, test } from "bun:test"
import {
  BROWSER_PARTITION,
  guestAttachAllowed,
  isHttpUrl,
  mainWindowWebPreferences,
  navigationDecision,
  normalizeAddress,
  windowOpenDecision,
} from "../src/shared/browser-policy"

describe("isHttpUrl", () => {
  test("http/https 大小写与空白容忍", () => {
    expect(isHttpUrl("https://example.com")).toBe(true)
    expect(isHttpUrl("HTTP://example.com")).toBe(true)
    expect(isHttpUrl("  https://example.com  ")).toBe(true)
  })
  test("非 http(s) 一律 false", () => {
    expect(isHttpUrl("mailto:a@b.c")).toBe(false)
    expect(isHttpUrl("file:///C:/x")).toBe(false)
    expect(isHttpUrl("javascript:alert(1)")).toBe(false)
    expect(isHttpUrl("")).toBe(false)
    expect(isHttpUrl("not a url")).toBe(false)
  })
})

describe("navigationDecision（Review Focus 3：非 http(s) 不得在 webview 内跳转）", () => {
  test("http(s) 允许", () => {
    expect(navigationDecision("https://a.com/x")).toBe("allow")
    expect(navigationDecision("http://127.0.0.1:3000")).toBe("allow")
  })
  test("mailto/tel 外抛系统", () => {
    expect(navigationDecision("mailto:x@y.z")).toBe("external")
    expect(navigationDecision("tel:+123")).toBe("external")
  })
  test("javascript:/file:/data:/空 一律拒绝（绝不 openExternal）", () => {
    expect(navigationDecision("javascript:alert(1)")).toBe("deny")
    expect(navigationDecision("file:///C:/Windows")).toBe("deny")
    expect(navigationDecision("data:text/html,<b>x</b>")).toBe("deny")
    expect(navigationDecision("")).toBe("deny")
  })
})

describe("windowOpenDecision（target=_blank / window.open）", () => {
  test("http(s) → dock 内导航（用户已拍：链接 dock 内开）", () => {
    expect(windowOpenDecision("https://a.com")).toEqual({ action: "navigate", url: "https://a.com" })
  })
  test("mailto/tel → 外抛", () => {
    expect(windowOpenDecision("mailto:a@b.c")).toEqual({ action: "external", url: "mailto:a@b.c" })
  })
  test("javascript:/about:blank → 拒绝", () => {
    expect(windowOpenDecision("javascript:alert(1)")).toEqual({ action: "deny" })
    expect(windowOpenDecision("about:blank")).toEqual({ action: "deny" })
  })
})

describe("guestAttachAllowed（will-attach-webview 的 src 门）", () => {
  test("空白初始页放行（否则 webview 永远挂不上）", () => {
    expect(guestAttachAllowed("")).toBe(true)
    expect(guestAttachAllowed("about:blank")).toBe(true)
  })
  test("http(s) 放行；危险协议拒绝", () => {
    expect(guestAttachAllowed("https://a.com")).toBe(true)
    expect(guestAttachAllowed("javascript:alert(1)")).toBe(false)
    expect(guestAttachAllowed("file:///C:/x")).toBe(false)
    expect(guestAttachAllowed("data:text/html,x")).toBe(false)
  })
})

describe("normalizeAddress（地址栏输入）", () => {  test("裸域名补 https://", () => {
    expect(normalizeAddress("example.com")).toBe("https://example.com")
    expect(normalizeAddress("localhost:5173")).toBe("https://localhost:5173")
  })
  test("显式协议保留", () => {
    expect(normalizeAddress("http://a.com")).toBe("http://a.com")
    expect(normalizeAddress("mailto:a@b.c")).toBe("mailto:a@b.c")
  })
  test("空白 → null", () => {
    expect(normalizeAddress("   ")).toBeNull()
    expect(normalizeAddress("")).toBeNull()
  })
})

describe("mainWindowWebPreferences（Review Focus 6：多窗口统一 webviewTag）", () => {
  test("所有主窗口共享同一安全基线 + webviewTag", () => {
    const prefs = mainWindowWebPreferences("C:/app/preload.js")
    expect(prefs).toEqual({
      preload: "C:/app/preload.js",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    })
  })
  test("partition 常量固定", () => {
    expect(BROWSER_PARTITION).toBe("persist:workbench-browser")
  })
})
