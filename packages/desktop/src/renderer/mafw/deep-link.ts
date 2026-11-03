// Deep link routing for the mafw:// protocol (registered in main, forwarded
// to the renderer via preload's onDeepLink). Pure parser so routing is
// testable without Electron.
const KNOWN_TABS = new Set(["chat", "goals", "workspace", "memory", "approvals", "triage", "automation"])

export type DeepLink =
  | { kind: "session"; id: string }
  | { kind: "tab"; id: string }

export function parseDeepLink(url: string): DeepLink | null {
  if (typeof url !== "string" || !url.startsWith("mafw://")) return null
  let rest = url.slice("mafw://".length)
  // strip query + trailing slash
  const qIdx = rest.indexOf("?")
  if (qIdx >= 0) rest = rest.slice(0, qIdx)
  rest = rest.replace(/\/+$/, "")
  const slash = rest.indexOf("/")
  if (slash <= 0) return null
  const kind = rest.slice(0, slash)
  const id = rest.slice(slash + 1)
  if (!id) return null
  if (kind === "session") return { kind: "session", id }
  // 2026-11-04：旧 workspace / goals deep link 统一落到 legacy `goals` 内部路由；
  // MafwShell 的 redirect effect 再打开右工作台「工作」。
  if (kind === "tab" && id === "workspace") return { kind: "tab", id: "goals" }
  if (kind === "tab" && KNOWN_TABS.has(id)) return { kind: "tab", id }
  return null
}
