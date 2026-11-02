// MAFW terminal 协议（mafw-terminal/1）—— desktop 侧编解码。
//
// 桌面只实现本协议：原生 PTY URL / 原生票据 / 原生帧（opencode 的 0x00 meta）
// 全部留在 gateway adapter，不越过边界。帧词汇与 gateway `terminal-protocol.ts`
// 对称（v1）：
//   client → gateway：input / resize / close
//   gateway → client：output / meta / close
// 非法/版本不符一律解失败（fail-closed），由调用方关闭会话。

export const MAFW_TERMINAL_PROTOCOL = "mafw-terminal/1"
export const MAFW_TERMINAL_VERSION = 1 as const

export interface TerminalInputFrame {
  v: 1
  type: "input"
  data: string
}

export interface TerminalResizeFrame {
  v: 1
  type: "resize"
  cols: number
  rows: number
}

export interface TerminalCloseFrame {
  v: 1
  type: "close"
  code: number
  reason?: string
}

export interface TerminalOutputFrame {
  v: 1
  type: "output"
  data: string
}

export interface TerminalMetaFrame {
  v: 1
  type: "meta"
  event: string
  payload?: unknown
}

export type TerminalFrame =
  | TerminalInputFrame
  | TerminalResizeFrame
  | TerminalCloseFrame
  | TerminalOutputFrame
  | TerminalMetaFrame

export function encodeTerminalFrame(frame: TerminalFrame): string {
  return JSON.stringify(frame)
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function bytesToText(raw: unknown): string | null {
  if (typeof raw === "string") return raw
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw)
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(raw))
  // Node Buffer 在 renderer/main 都可能出现（Buffer 是 Uint8Array 子类，上面的分支已覆盖）。
  return null
}

function parseFrame(value: any): TerminalFrame | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  if (value.v !== MAFW_TERMINAL_VERSION) return null
  switch (value.type) {
    case "input":
      return typeof value.data === "string" ? { v: 1, type: "input", data: value.data } : null
    case "output":
      return typeof value.data === "string" ? { v: 1, type: "output", data: value.data } : null
    case "resize":
      return isPositiveInt(value.cols) && isPositiveInt(value.rows)
        ? { v: 1, type: "resize", cols: value.cols, rows: value.rows }
        : null
    case "meta":
      if (typeof value.event !== "string" || !value.event) return null
      return {
        v: 1,
        type: "meta",
        event: value.event,
        ...(value.payload !== undefined ? { payload: value.payload } : {}),
      }
    case "close":
      if (value.code !== undefined && !isPositiveInt(value.code)) return null
      if (value.reason !== undefined && typeof value.reason !== "string") return null
      return {
        v: 1,
        type: "close",
        code: value.code ?? 1000,
        ...(typeof value.reason === "string" ? { reason: value.reason } : {}),
      }
    default:
      return null
  }
}

export function decodeTerminalFrame(raw: unknown): TerminalFrame | null {
  const text = bytesToText(raw)
  if (text === null) return null
  try {
    return parseFrame(JSON.parse(text))
  } catch {
    return null
  }
}
