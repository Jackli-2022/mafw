// 内嵌浏览器策略（纯函数，main 侧单测钉扎；Electron 耦合在 browser-session.ts）。
// 设计：http(s) 是唯一放行面；mailto/tel 外抛系统；其余一律拒绝（javascript:/file:/data:
// 绝不 openExternal——openExternal 对危险协议等于把攻击面交给 OS）。

export const BROWSER_PARTITION = "persist:workbench-browser"

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
  if (EXTERNAL_PROTOCOLS.has(url.protocol)) return "external"
  return "deny"
}

export type WindowOpenDecision =
  | { action: "navigate"; url: string }
  | { action: "external"; url: string }
  | { action: "deny" }

/** target=_blank / window.open 决策：http(s) 转 dock 内导航（用户拍板：链接 dock 内开）。 */
export function windowOpenDecision(raw: string): WindowOpenDecision {
  const value = raw.trim()
  const url = parse(value)
  if (!url) return { action: "deny" }
  if (url.protocol === "https:" || url.protocol === "http:") return { action: "navigate", url: value }
  if (EXTERNAL_PROTOCOLS.has(url.protocol)) return { action: "external", url: value }
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
