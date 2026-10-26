// 终端 dock 的纯 view model（无 Solid / 无 xterm 依赖，可单测）。
// spec `2026-10-26-terminal-dock-design.md` §3/§8：closed=重连、gone=重开、
// unavailable=外部终端出口、idle=空态。
export type TerminalViewKind = "idle" | "probing" | "live" | "closed" | "gone" | "unavailable"
export type TerminalAction = "open" | "reconnect" | "reopen" | "external"

export type TerminalView = {
  kind: TerminalViewKind
  busy: boolean
  banner?: string
  action?: TerminalAction
}

/** 是否在可见时启动 attach：不可见不建 PTY；in-flight 中切目录排队（最新目录胜）。 */
export type AttachPlan = "start" | "queue" | "ignore"

export function planAttach(input: {
  active: boolean
  attaching: boolean
  requestedDir: string | null
  currentDir: string | null
}): AttachPlan {
  if (!input.active || !input.requestedDir) return "ignore"
  if (input.requestedDir === input.currentDir) return "ignore"
  return input.attaching ? "queue" : "start"
}

export function viewFor(kind: TerminalViewKind): TerminalView {
  switch (kind) {
    case "probing":
      return { kind, busy: true, banner: "正在连接终端…" }
    case "live":
      return { kind, busy: false }
    case "closed":
      return { kind, busy: false, banner: "终端已断开", action: "reconnect" }
    case "gone":
      return { kind, busy: false, banner: "终端已随服务重启关闭", action: "reopen" }
    case "unavailable":
      return { kind, busy: false, banner: "当前环境不支持内嵌终端", action: "external" }
    case "idle":
    default:
      return { kind: "idle", busy: false, banner: "打开一个会话后此处可用终端", action: "open" }
  }
}
