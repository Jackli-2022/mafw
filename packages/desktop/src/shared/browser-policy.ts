// 内嵌浏览器策略（纯函数，main 侧单测钉扎；Electron 耦合在 browser-session.ts）。
// 设计：http(s) + mafw-file（本地文件预览，我们自己产出的 URL）是放行面；mailto/tel 外抛系统；
// 其余一律拒绝（javascript:/file:/data: 绝不 openExternal——openExternal 对危险协议等于把攻击面交给 OS）。
import { MAFW_FILE_SCHEME } from "./mafw-file"

export const BROWSER_PARTITION = "persist:workbench-browser"

const MAFW_FILE_PROTOCOL = `${MAFW_FILE_SCHEME}:`
const EXTERNAL_PROTOCOLS = new Set(["mailto:", "tel:"])

/** 主窗口 webPreferences 单一来源（所有窗口统一：webviewTag 开、guest 侧仍由加固面锁死）。 */
export function mainWindowWebPreferences(preload: string) {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: true,
  }
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw.trim())
  } catch {
    return null
  }
}

export function isHttpUrl(raw: string): boolean {
  const url = parse(raw)
  return !!url && (url.protocol === "https:" || url.protocol === "http:")
}

export type NavigationDecision = "allow" | "external" | "deny"

/** 导航决策：webview 内跳转（allow）/ 交给系统（external）/ 拦截（deny）。 */
export function navigationDecision(raw: string): NavigationDecision {
  const url = parse(raw)
  if (!url) return "deny"
  if (url.protocol === "https:" || url.protocol === "http:") return "allow"
  if (url.protocol === MAFW_FILE_PROTOCOL) return "allow"
  if (EXTERNAL_PROTOCOLS.has(url.protocol)) return "external"
  return "deny"
}

export type WindowOpenDecision =
  | { action: "navigate"; url: string }
  | { action: "external"; url: string }
  | { action: "deny" }

/** guest 挂载允许的 src：空白初始页放行；其余必须 http(s)/mafw-file（javascript:/file:/data: 一律拒绝）。 */
export function guestAttachAllowed(raw: string): boolean {
  const value = raw.trim()
  if (!value || value === "about:blank") return true
  return navigationDecision(value) === "allow"
}

/** target=_blank / window.open 决策：http(s)/mafw-file 转 dock 内导航（用户拍板：链接 dock 内开）。 */
export function windowOpenDecision(raw: string): WindowOpenDecision {
  const value = raw.trim()
  const url = parse(value)
  if (!url) return { action: "deny" }
  if (url.protocol === "https:" || url.protocol === "http:") return { action: "navigate", url: value }
  if (url.protocol === MAFW_FILE_PROTOCOL) return { action: "navigate", url: value }
  if (EXTERNAL_PROTOCOLS.has(url.protocol)) return { action: "external", url: value }
  return { action: "deny" }
}

export type BrowserLinkAction =
  | { action: "allow" }
  | { action: "dock"; url: string }
  | { action: "external"; url: string }
  | { action: "deny" }

/** Main-window link routing: app-internal navigation stays, everything else uses policy. */
export function browserLinkAction(raw: string, currentUrl: string): BrowserLinkAction {
  const target = parse(raw)
  if (!target) return { action: "deny" }
  if (target.protocol === "oc:") return { action: "allow" }
  const current = parse(currentUrl)
  if (current && target.origin !== "null" && target.origin === current.origin) return { action: "allow" }
  const decision = windowOpenDecision(raw)
  if (decision.action === "navigate") return { action: "dock", url: decision.url }
  if (decision.action === "external") return { action: "external", url: decision.url }
  return { action: "deny" }
}

/** 地址栏输入归一化：空白 → null；无协议补 https://；显式协议原样。 */
export function normalizeAddress(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  // "://" 形式（http/https/custom）或非层级 scheme（mailto:/tel:/...）视为显式协议；
  // "localhost:5173" 这类 host:port 不是 scheme，补 https://。
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value
  if (/^(mailto|tel|data|javascript|file|about|chrome):/i.test(value)) return value
  return `https://${value}`
}
