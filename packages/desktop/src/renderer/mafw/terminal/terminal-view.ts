// 终端 view model（无 Solid / 无 xterm 依赖，可单测）。
// spec `2026-10-29-terminal-surface-ssh-design.md`：会话状态 → banner/action。
import type { TerminalSessionInfo } from "../../../shared/terminal-session"

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

/** v2 session surface status mapping (SSH + local). */
export function sessionView(session: TerminalSessionInfo): TerminalView {
  switch (session.status) {
    case "connecting":
      return { kind: "probing", busy: true, banner: "正在连接…" }
    case "connected":
      return { kind: "live", busy: false }
    case "reconnecting": {
      const seconds = Math.max(1, Math.ceil((session.reconnectInMs ?? 0) / 1000))
      const attempt = session.reconnectAttempt ? `（${session.reconnectAttempt}/5）` : ""
      return {
        kind: "closed",
        busy: false,
        banner: `连接已断开，${seconds} 秒后重试${attempt}`,
        action: "reconnect",
      }
    }
    case "disconnected":
      return {
        kind: "closed",
        busy: false,
        banner: session.error ?? "连接已断开",
        action: "reconnect",
      }
    case "error":
      return {
        kind: "closed",
        busy: false,
        banner: session.error ?? "连接失败",
        action:
          session.kind === "local" && /不支持|不可用/.test(session.error ?? "")
            ? "external"
            : "reconnect",
      }
    case "closed":
    default:
      return { kind: "idle", busy: false, banner: "终端已关闭", action: "open" }
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
    // 不能把 setTimeout/clearTimeout 裸引用塞进对象：调用时 this 会变成 timers，
    // Chromium 抛 "Illegal invocation"（ResizeObserver → schedule 实测）。
    set: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clear: (h: any) => globalThis.clearTimeout(h),
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
