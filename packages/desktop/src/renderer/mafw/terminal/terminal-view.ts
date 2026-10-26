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

export function viewFor(
  kind: TerminalViewKind,
  opts: { hasDirectory?: boolean; error?: string | null } = {},
): TerminalView {
  switch (kind) {
    case "probing":
      return { kind, busy: true, banner: "正在连接终端…" }
    case "live":
      return { kind, busy: false }
    case "closed":
      return opts.error
        ? { kind, busy: false, banner: "终端服务不可用，请检查 gateway 或重启应用", action: "reconnect" }
        : { kind, busy: false, banner: "终端已断开", action: "reconnect" }
    case "gone":
      return { kind, busy: false, banner: "终端已随服务重启关闭", action: "reopen" }
    case "unavailable":
      return { kind, busy: false, banner: "当前环境不支持内嵌终端", action: "external" }
    case "idle":
    default:
      return opts.hasDirectory
        ? { kind: "idle", busy: false, banner: "终端已关闭，可重新打开", action: "open" }
        : { kind: "idle", busy: false, banner: "打开一个会话后此处可用终端" }
  }
}

export type TerminalTheme = {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  fontFamily: string
}

/** 从 mafw CSS token 读 xterm 主题（空值回退默认；selection 用 --selection）。 */
export function buildTerminalTheme(read: (name: string) => string): TerminalTheme {
  const pick = (name: string, fb: string) => read(name).trim() || fb
  return {
    background: pick("--bg-inset", "#0d1117"),
    foreground: pick("--text-1", "#e6edf3"),
    cursor: pick("--accent", "#7aa2f7"),
    cursorAccent: pick("--bg-inset", "#0d1117"),
    selectionBackground: pick("--selection", "#264f78"),
    fontFamily: pick("--font-data", "ui-monospace, monospace"),
  }
}

/** 尾部防抖：拖 dock 宽度时只在停顿后 fit + resize 一次。 */
export function createResizeScheduler(
  intervalMs: number,
  run: () => void,
  timers: { set: (fn: () => void, ms: number) => any; clear: (h: any) => void } = {
    set: setTimeout as any,
    clear: clearTimeout as any,
  },
) {
  let handle: any = null
  const cancel = () => {
    if (handle !== null) {
      timers.clear(handle)
      handle = null
    }
  }
  return {
    schedule() {
      cancel()
      handle = timers.set(() => {
        handle = null
        run()
      }, intervalMs)
    },
    flush() {
      cancel()
      run()
    },
    cancel,
  }
}
